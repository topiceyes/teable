/* eslint-disable @typescript-eslint/naming-convention -- Prisma compound selectors are generated names. */
import { createHash, randomBytes } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  HttpException,
  UnauthorizedException,
} from '@nestjs/common';
import { generateAccountId, generateUserId } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { DirectoryConnection, Prisma } from '@teable/db-main-prisma';
import { DINGTALK_CALLBACK, isAppSignupBlocked } from '@teable/openapi';
import cookie from 'cookie';
import type { Request } from 'express';
import { z } from 'zod';
import { CacheService } from '../../../cache/cache.service';
import { BaseConfig, IBaseConfig } from '../../../configs/base.config';
import type { ISessionData } from '../../../types/session';
import { AuditScope } from '../../audit/audit-scope';
import { DirectoryConnectionService } from '../../organization/directory/directory-connection.service';
import { pickUserMe, isValidRedirectPath } from '../utils';
import { DingtalkLoginClient } from './dingtalk-login.client';
import type { IDingtalkLoginIdentity } from './dingtalk-login.client';

export const DINGTALK_LOGIN_COOKIE = 'teable_dingtalk_login';
const ttl = 600;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const activeUser = { deletedTime: null, permanentDeletedTime: null, deactivatedTime: null };

@Injectable()
export class DingtalkLoginService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly connections: DirectoryConnectionService,
    private readonly client: DingtalkLoginClient,
    private readonly cache: CacheService,
    private readonly audit: AuditScope,
    @BaseConfig() private readonly config: IBaseConfig
  ) {}

  providers() {
    return this.prisma.directoryConnection
      .findMany({
        where: {
          provider: 'dingtalk',
          enabled: true,
          loginEnabled: true,
          appKey: { not: null },
          appSecret: { not: null },
        },
        select: { tenantId: true, name: true },
        orderBy: { createdTime: 'asc' },
      })
      .then((rows) => rows.map((row) => ({ corpId: row.tenantId, name: row.name })));
  }

  private async enabled(corpId: string) {
    const row = await this.prisma.directoryConnection.findUnique({
      where: { provider_tenantId: { provider: 'dingtalk', tenantId: corpId } },
    });
    if (!row?.enabled || !row.loginEnabled || !row.appKey || !row.appSecret)
      throw new ForbiddenException('DINGTALK_LOGIN_UNAVAILABLE');
    return row;
  }

  async start(req: Request, corpId: string, redirect?: string, actorId?: string) {
    const row = await this.enabled(corpId);
    const origin = new URL(this.config.publicOrigin || '');
    if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password)
      throw new ForbiddenException('DINGTALK_LOGIN_UNAVAILABLE');
    const sessionHash = hash(req.sessionID);
    if ((await this.cache.incr(`auth:dingtalk:rate:${hash(req.ip || req.sessionID)}`, ttl)) > 20)
      throw new HttpException('DINGTALK_LOGIN_RATE_LIMIT', 429);
    const state = randomBytes(32).toString('hex');
    const nonce = randomBytes(32).toString('hex');
    const destination = redirect && isValidRedirectPath(redirect) ? redirect : '/space';
    await this.cache.setDetail(
      `auth:dingtalk:state:${state}`,
      {
        corpId,
        version: row.configurationVersion,
        sessionHash,
        nonce,
        actorId,
        redirect: destination,
        expiresAt: Date.now() + ttl * 1000,
      },
      ttl
    );
    const url = new URL('https://login.dingtalk.com/oauth2/auth');
    url.search = new URLSearchParams({
      redirect_uri: new URL('/api' + DINGTALK_CALLBACK, origin).href,
      response_type: 'code',
      client_id: row.appKey!,
      scope: 'openid',
      state,
      prompt: 'consent',
    }).toString();
    return { url: url.href, nonce, secure: origin.protocol === 'https:' };
  }

  async callback(req: Request, state: string, code: string) {
    const key = `auth:dingtalk:state:${state}` as const;
    const saved = await this.cache.get(key);
    const session = req.session as Partial<ISessionData>;
    if (
      !saved ||
      saved.expiresAt <= Date.now() ||
      saved.nonce !== cookie.parse(req.headers.cookie ?? '')[DINGTALK_LOGIN_COOKIE] ||
      (saved.actorId && saved.sessionHash !== hash(req.sessionID)) ||
      (saved.actorId && saved.actorId !== session.passport?.user.id)
    )
      throw new UnauthorizedException('DINGTALK_STATE_INVALID');
    if (!(await this.cache.setnx(`auth:dingtalk:used:${state}`, true, ttl)))
      throw new UnauthorizedException('DINGTALK_STATE_INVALID');
    await this.cache.del(key);
    const row = await this.enabled(saved.corpId);
    if (row.configurationVersion !== saved.version)
      throw new ConflictException('DINGTALK_CONFIGURATION_CHANGED');
    const config = await this.connections.get(saved.corpId);
    if (config.configurationVersion !== saved.version)
      throw new ConflictException('DINGTALK_CONFIGURATION_CHANGED');
    const identity = await this.client.identity(config, code);
    const result = await this.resolveIdentity(
      row.id,
      saved.version,
      identity,
      saved.actorId,
      isAppSignupBlocked(saved.redirect)
    );
    await this.audit.emitAtomic({
      action: result.bound
        ? 'organization.directory.member.autoBind'
        : 'organization.directory.member.signin',
      resourceId: result.memberId,
      userId: result.user.id,
      params: { connectionId: row.id, userId: result.user.id, created: result.created },
    });
    return { user: pickUserMe(result.user), redirect: saved.redirect };
  }

  /** Enterprise-scoped advisory lock also serializes manual binding and directory sync. */
  async resolveIdentity(
    connectionId: string,
    version: number,
    identity: IDingtalkLoginIdentity,
    actorId?: string,
    signupBlocked = false
  ) {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const [lock] = await tx.$queryRaw<{ acquired: boolean }[]>`
          SELECT pg_try_advisory_xact_lock(hashtextextended(${connectionId}, 0)) AS acquired
        `;
          if (!lock?.acquired) throw new ConflictException('DIRECTORY_CONNECTION_BUSY');
          const connection = await tx.directoryConnection.findUnique({
            where: { id: connectionId },
          });
          if (
            !connection?.enabled ||
            !connection.loginEnabled ||
            connection.configurationVersion !== version
          )
            throw new ForbiddenException('DINGTALK_LOGIN_UNAVAILABLE');
          const member = await tx.directoryMember.findUnique({
            where: { connectionId_externalId: { connectionId, externalId: identity.externalId } },
          });
          if (
            !member ||
            member.inactiveTime ||
            (member.unionId && member.unionId !== identity.unionId)
          )
            throw new ForbiddenException('DINGTALK_EMPLOYEE_UNAVAILABLE');
          if (actorId && member.userId && member.userId !== actorId)
            throw new ConflictException('DINGTALK_BINDING_CONFLICT');
          const bound = !member.userId;
          const { userId, created } = member.userId
            ? { userId: member.userId, created: false }
            : await this.bindUnlinkedMember(
                tx,
                connection,
                member.id,
                identity,
                actorId,
                signupBlocked
              );
          const user = await this.activeAccount(tx, userId);
          await tx.account.upsert({
            where: {
              provider_providerId_connectionId: {
                provider: 'dingtalk',
                providerId: identity.unionId,
                connectionId,
              },
            },
            create: {
              id: generateAccountId(),
              type: 'oauth',
              provider: 'dingtalk',
              providerId: identity.unionId,
              connectionId,
              userId,
            },
            update: { userId },
          });
          // No collaborators, business roles or administrator privileges are created here.
          return { user, memberId: member.id, created, bound };
        },
        { timeout: 15000 }
      );
    } catch (error) {
      if ((error as { code?: string })?.code === 'P2002')
        throw new ConflictException('DINGTALK_BINDING_CONFLICT');
      throw error;
    }
  }

  private async bindUnlinkedMember(
    tx: Prisma.TransactionClient,
    connection: DirectoryConnection,
    memberId: string,
    identity: IDingtalkLoginIdentity,
    actorId: string | undefined,
    signupBlocked: boolean
  ) {
    let userId = actorId;
    let created = false;
    if (!userId) {
      if (!connection.autoProvision || signupBlocked)
        throw new ForbiddenException('DINGTALK_BIND_REQUIRED');
      const email = this.identityEmail(identity, connection.id);
      // An enterprise email is a discovery hint, never proof of an existing account.
      if (await tx.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } }))
        throw new ConflictException('DINGTALK_BIND_REQUIRED');
      const user = await tx.user.create({
        data: {
          id: generateUserId(),
          email,
          name: identity.name,
          isAdmin: false,
          notifyMeta: JSON.stringify({ email: !email.endsWith('@dingtalk.invalid') }),
        },
      });
      userId = user.id;
      created = true;
    }
    const other = await tx.directoryMember.findFirst({
      where: { connectionId: connection.id, userId, id: { not: memberId } },
    });
    if (other) throw new ConflictException('DINGTALK_BINDING_CONFLICT');
    const updated = await tx.directoryMember.updateMany({
      where: { id: memberId, connectionId: connection.id, userId: null, inactiveTime: null },
      data: { userId },
    });
    if (updated.count !== 1) throw new ConflictException('DINGTALK_BINDING_CONFLICT');
    return { userId, created };
  }

  private identityEmail(identity: IDingtalkLoginIdentity, connectionId: string) {
    const email = identity.email?.trim().toLowerCase();
    if (email && email.length <= 254 && z.string().email().safeParse(email).success) return email;
    return `dt-${hash(JSON.stringify([connectionId, identity.unionId])).slice(0, 40)}@dingtalk.invalid`;
  }

  private async activeAccount(tx: Prisma.TransactionClient, userId: string) {
    const user = await tx.user.findFirst({
      where: { id: userId, ...activeUser, OR: [{ isSystem: false }, { isSystem: null }] },
    });
    if (!user) throw new ForbiddenException('DINGTALK_ACCOUNT_UNAVAILABLE');
    return user;
  }
}

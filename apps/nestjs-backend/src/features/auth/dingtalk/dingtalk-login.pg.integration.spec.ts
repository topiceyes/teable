/* eslint-disable @typescript-eslint/naming-convention -- DingTalk wire headers and Prisma compound selectors. */
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@teable/db-main-prisma';
import type { Prisma, PrismaService } from '@teable/db-main-prisma';
import type { Request } from 'express';
import Keyv from 'keyv';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { CacheService } from '../../../cache/cache.service';
import type { IBaseConfig } from '../../../configs/base.config';
import type { AuditScope } from '../../audit/audit-scope';
import type { DirectoryConnectionService } from '../../organization/directory/directory-connection.service';
import type { DingtalkLoginClient } from './dingtalk-login.client';
import { DINGTALK_LOGIN_COOKIE, DingtalkLoginService } from './dingtalk-login.service';

// Explicit opt-in, fixed local development DB, no calls to the real DingTalk provider.
describe.runIf(process.env.TEABLE_DINGTALK_DB_ACCEPTANCE === '1')(
  'DingTalk real PostgreSQL / HTTP acceptance',
  () => {
    const db = new PrismaClient();
    const suffix = randomUUID();
    const corpId = 'dingtalk-login-acceptance-' + suffix;
    const userIds: string[] = [];
    let connectionId: string;
    let service: DingtalkLoginService;
    let baselineUsers: number;
    beforeAll(async () => {
      const url = new URL(process.env.PRISMA_DATABASE_URL!);
      if (
        !['127.0.0.1', 'localhost'].includes(url.hostname) ||
        url.pathname !== '/teable_dev_20261109'
      )
        throw new Error('Isolated local development database required');
      await db.$connect();
      baselineUsers = await db.user.count();
      const connection = await db.directoryConnection.create({
        data: {
          tenantId: corpId,
          provider: 'dingtalk',
          name: '扫码登录验收（临时）',
          appKey: 'acceptance-key',
          appSecret: 'not-a-real-secret',
          loginEnabled: true,
          autoProvision: true,
          configurationVersion: 1,
        },
      });
      connectionId = connection.id;
      for (const externalId of ['new', 'existing', 'failure', 'signed-in'])
        await db.directoryMember.create({
          data: {
            connectionId,
            externalId,
            name: 'Synthetic employee',
            unionId: 'union-' + externalId,
          },
        });
      const client = {
        identity: vi.fn(async () => ({
          externalId: 'new',
          unionId: 'union-new',
          name: 'Synthetic employee',
        })),
      };
      const connections = {
        get: vi.fn(async () => ({
          corpId,
          name: 'Acceptance',
          appKey: 'acceptance-key',
          appSecret: 'not-a-real-secret',
          configurationVersion: 1,
        })),
      };
      service = new DingtalkLoginService(
        db as unknown as PrismaService,
        connections as unknown as DirectoryConnectionService,
        client as unknown as DingtalkLoginClient,
        new CacheService(new Keyv()),
        { emitAtomic: vi.fn() } as unknown as AuditScope,
        { publicOrigin: 'http://localhost:3000' } as IBaseConfig
      );
    });
    afterAll(async () => {
      if (connectionId) await db.directoryConnection.delete({ where: { id: connectionId } });
      if (userIds.length) await db.user.deleteMany({ where: { id: { in: userIds } } });
      if (baselineUsers !== undefined) expect(await db.user.count()).toBe(baselineUsers);
      await db.$disconnect();
    });
    it('exposes only public labels and issues browser-bound QR authorization requests over HTTP', async () => {
      const providers = await fetch('http://localhost:3000/api/auth/dingtalk/providers');
      expect(providers.status).toBe(200);
      const data = await providers.json();
      expect(data).toContainEqual({ corpId, name: '扫码登录验收（临时）' });
      expect(JSON.stringify(data)).not.toContain('acceptance-key');
      const start = await fetch(
        'http://localhost:3000/api/auth/dingtalk/start?' +
          new URLSearchParams({ corpId, redirect: '//evil.test' }),
        { redirect: 'manual' }
      );
      expect(start.status).toBe(302);
      const target = new URL(start.headers.get('location')!);
      expect(target.origin).toBe('https://login.dingtalk.com');
      expect(target.searchParams.get('redirect_uri')).toBe(
        'http://localhost:3000/api/auth/dingtalk/callback'
      );
      const browserCookie = start.headers
        .getSetCookie()
        .find((value) => value.startsWith(DINGTALK_LOGIN_COOKIE + '='));
      expect(browserCookie).toContain('HttpOnly');
      expect(browserCookie).toContain('SameSite=Lax');
      const callback = await fetch(
        'http://localhost:3000/api/auth/dingtalk/callback?' +
          new URLSearchParams({
            state: target.searchParams.get('state')!,
            authCode: 'invalid-code',
          }),
        { redirect: 'manual' }
      );
      expect(callback.status).toBe(302);
      expect(callback.headers.get('location')).toBe('/auth/login?authError=DINGTALK_STATE_INVALID');
      const bind = await fetch('http://localhost:3000/api/auth/dingtalk/bind', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ corpId }),
      });
      expect(bind.status).toBe(401);
    }, 90000);
    it('commits creation, account issuer and employee binding atomically and reuses that account', async () => {
      const req = {
        sessionID: 'synthetic-session',
        headers: {},
        session: {},
        ip: '127.0.0.1',
      } as unknown as Request;
      const auth = await service.start(req, corpId);
      req.headers.cookie = DINGTALK_LOGIN_COOKIE + '=' + auth.nonce;
      const result = await service.callback(
        req,
        new URL(auth.url).searchParams.get('state')!,
        'synthetic-code'
      );
      userIds.push(result.user.id);
      expect(result.user.isAdmin).toBe(false);
      expect(
        await db.directoryMember.findUnique({
          where: { connectionId_externalId: { connectionId, externalId: 'new' } },
        })
      ).toMatchObject({ userId: result.user.id });
      expect(await db.account.findFirst({ where: { userId: result.user.id } })).toMatchObject({
        provider: 'dingtalk',
        connectionId,
        providerId: 'union-new',
      });
      const repeat = await service.resolveIdentity(connectionId, 1, {
        externalId: 'new',
        unionId: 'union-new',
        name: 'Synthetic employee',
      });
      expect(repeat.user.id).toBe(result.user.id);
      expect(repeat.created).toBe(false);
      expect(await db.collaborator.count({ where: { principalId: result.user.id } })).toBe(0);
    });
    it('does not merge an existing email; binds it only to the authenticated actor', async () => {
      const email = 'existing-' + suffix + '@example.invalid';
      const user = await db.user.create({
        data: { name: 'Synthetic existing', email, isAdmin: false },
      });
      userIds.push(user.id);
      const identity = {
        externalId: 'existing',
        unionId: 'union-existing',
        name: 'Synthetic existing',
        email,
      };
      await expect(service.resolveIdentity(connectionId, 1, identity)).rejects.toThrow(
        'DINGTALK_BIND_REQUIRED'
      );
      const bound = await service.resolveIdentity(connectionId, 1, identity, user.id);
      expect(bound.user.id).toBe(user.id);
      expect(bound.created).toBe(false);
      const repeat = await service.resolveIdentity(connectionId, 1, identity);
      expect(repeat.user.id).toBe(user.id);
    });
    it('rolls back account creation and employee binding together when account linkage fails', async () => {
      const failingPrisma = {
        $transaction: (operation: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
          db.$transaction((tx) =>
            operation(
              new Proxy(tx, {
                get(target, key) {
                  if (key === 'account')
                    return {
                      upsert: () => {
                        throw new Error('Injected identity write failure');
                      },
                    };
                  return Reflect.get(target, key);
                },
              })
            )
          ),
      };
      const failingService = new DingtalkLoginService(
        failingPrisma as unknown as PrismaService,
        {} as DirectoryConnectionService,
        {} as DingtalkLoginClient,
        new CacheService(new Keyv()),
        {} as AuditScope,
        {} as IBaseConfig
      );
      const count = await db.user.count();
      await expect(
        failingService.resolveIdentity(connectionId, 1, {
          externalId: 'failure',
          unionId: 'union-failure',
          name: 'Denied',
        })
      ).rejects.toThrow('Injected identity write failure');
      expect(await db.user.count()).toBe(count);
      expect(
        await db.directoryMember.findUnique({
          where: { connectionId_externalId: { connectionId, externalId: 'failure' } },
        })
      ).toMatchObject({ userId: null });
    });
    it('blocks a second employee from claiming the same local account', async () => {
      const user = await db.user.findFirstOrThrow({ where: { id: { in: userIds } } });
      await expect(
        service.resolveIdentity(
          connectionId,
          1,
          { externalId: 'signed-in', unionId: 'union-signed-in', name: 'Second' },
          user.id
        )
      ).rejects.toThrow('DINGTALK_BINDING_CONFLICT');
      expect(
        await db.directoryMember.findUnique({
          where: { connectionId_externalId: { connectionId, externalId: 'signed-in' } },
        })
      ).toMatchObject({ userId: null });
    });
  }
);

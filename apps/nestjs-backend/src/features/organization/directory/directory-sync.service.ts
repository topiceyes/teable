/* eslint-disable @typescript-eslint/naming-convention -- Prisma generates compound unique selector names. */
import { createHash, randomUUID } from 'node:crypto';
import {
  BadGatewayException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import type { Prisma } from '@teable/db-main-prisma';
import { DingtalkDirectoryClient, DingtalkDirectoryError } from './dingtalk-directory.client';
import { DirectoryConnectionService } from './directory-connection.service';
import type { IResolvedDirectoryConfig } from './directory-connection.service';
import type { IDirectorySnapshot } from './directory-snapshot';
import { createDirectorySyncPlan } from './directory-sync-plan';

@Injectable()
export class DirectorySyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: DirectoryConnectionService,
    private readonly client: DingtalkDirectoryClient
  ) {}

  listConnections() {
    return this.config.list();
  }

  private async connection(corpId: string) {
    const config = await this.config.get(corpId);
    const connection = await this.prisma.directoryConnection.upsert({
      where: { provider_tenantId: { provider: 'dingtalk', tenantId: corpId } },
      create: { provider: 'dingtalk', tenantId: corpId, name: config.name },
      update: config.configurationVersion === 0 ? { name: config.name } : {},
    });
    if (
      config.configurationVersion > 0 &&
      connection.configurationVersion !== config.configurationVersion
    ) {
      throw new ConflictException('Directory configuration changed; preview again');
    }
    return { connection, config };
  }

  private state(tx: Prisma.TransactionClient, connectionId: string) {
    return Promise.all([
      tx.directoryDepartment.findMany({ where: { connectionId } }),
      tx.directoryMember.findMany({
        where: { connectionId },
        include: {
          memberships: { include: { department: { select: { externalId: true } } } },
        },
      }),
    ]).then(([departments, members]) => ({ departments, members }));
  }

  private async snapshot(config: IResolvedDirectoryConfig) {
    try {
      return await this.client.fetchSnapshot(config);
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw new BadGatewayException(
        error instanceof DingtalkDirectoryError ? error.code : 'DINGTALK_SYNC_FAILED'
      );
    }
  }

  private plan(
    corpId: string,
    configurationVersion: number,
    snapshot: IDirectorySnapshot,
    state: Awaited<ReturnType<DirectorySyncService['state']>>
  ) {
    const plan = createDirectorySyncPlan(snapshot, state);
    return {
      ...plan,
      previewToken: createHash('sha256')
        .update(`${corpId}:${configurationVersion}:${plan.previewToken}`)
        .digest('hex'),
    };
  }

  async preview(corpId: string) {
    const { connection, config } = await this.connection(corpId);
    if (!connection.enabled) throw new ConflictException('Directory connection disabled');
    const snapshot = await this.snapshot(config);
    // A coherent DB snapshot prevents mixed membership states during concurrent syncs.
    const state = await this.prisma.$transaction((tx) => this.state(tx, connection.id), {
      isolationLevel: 'RepeatableRead',
    });
    return this.plan(corpId, config.configurationVersion, snapshot, state);
  }

  async sync(corpId: string, previewToken: string) {
    const { connection, config } = await this.connection(corpId);
    if (!connection.enabled) throw new ConflictException('Directory connection disabled');
    const run = await this.prisma.directorySyncRun.create({
      data: {
        connectionId: connection.id,
        status: 'running',
      },
    });
    try {
      const snapshot = await this.snapshot(config);
      return await this.prisma.$transaction(
        async (tx) => {
          // DB lock works across processes even when Redis is unavailable. A concurrent
          // apply fails rather than waiting with a stale remote snapshot.
          const [lock] = await tx.$queryRaw<{ acquired: boolean }[]>`
          SELECT pg_try_advisory_xact_lock(hashtextextended(${connection.id}, 0)) AS acquired
        `;
          if (!lock?.acquired) throw new ConflictException('Directory sync already running');
          const current = await tx.directoryConnection.findUniqueOrThrow({
            where: { id: connection.id },
          });
          if (!current.enabled) throw new ConflictException('Directory connection disabled');
          if (current.configurationVersion !== connection.configurationVersion) {
            throw new ConflictException('Directory configuration changed; preview again');
          }
          const state = await this.state(tx, connection.id);
          if (
            this.plan(corpId, config.configurationVersion, snapshot, state).previewToken !==
            previewToken
          ) {
            throw new ConflictException('Directory changed; preview again before syncing');
          }
          await this.reconcile(tx, connection.id, snapshot);
          return tx.directorySyncRun.update({
            where: { id: run.id },
            data: {
              status: 'succeeded',
              finishedTime: new Date(),
              departmentCount: snapshot.departments.length,
              memberCount: snapshot.members.length,
            },
          });
        },
        { timeout: 120000 }
      );
    } catch (error) {
      await this.prisma.directorySyncRun.update({
        where: { id: run.id },
        data: {
          status: 'failed',
          finishedTime: new Date(),
          errorCode:
            error instanceof ConflictException ? 'DIRECTORY_CONFLICT' : 'DIRECTORY_SYNC_FAILED',
        },
      });
      if (error instanceof ConflictException || error instanceof BadGatewayException) throw error;
      throw new BadGatewayException('DIRECTORY_SYNC_FAILED');
    }
  }

  private async reconcile(
    tx: Prisma.TransactionClient,
    connectionId: string,
    snapshot: IDirectorySnapshot
  ) {
    const now = new Date();
    const departmentIds = new Map<string, string>();
    for (const department of snapshot.departments) {
      const row = await tx.directoryDepartment.upsert({
        where: { connectionId_externalId: { connectionId, externalId: department.externalId } },
        create: { id: randomUUID(), connectionId, ...department },
        update: {
          name: department.name,
          parentExternalId: department.parentExternalId,
          inactiveTime: null,
        },
      });
      departmentIds.set(row.externalId, row.id);
    }
    for (const member of snapshot.members) {
      const { departmentExternalIds, unionId, email, active, ...attributes } = member;
      const data = {
        ...attributes,
        unionId: unionId || null,
        email: email || null,
        inactiveTime: active ? null : now,
      };
      const row = await tx.directoryMember.upsert({
        where: { connectionId_externalId: { connectionId, externalId: member.externalId } },
        create: { id: randomUUID(), connectionId, ...data },
        update: data,
      });
      await tx.directoryMembership.deleteMany({ where: { connectionId, memberId: row.id } });
      if (active && departmentExternalIds.length) {
        await tx.directoryMembership.createMany({
          data: departmentExternalIds.map((externalId) => ({
            connectionId,
            memberId: row.id,
            departmentId: departmentIds.get(externalId)!,
          })),
        });
      }
    }
    const missing = {
      connectionId,
      externalId: { notIn: snapshot.members.map((item) => item.externalId) },
    };
    const missingMembers = await tx.directoryMember.findMany({
      where: missing,
      select: { id: true },
    });
    await tx.directoryMembership.deleteMany({
      where: { connectionId, memberId: { in: missingMembers.map((item) => item.id) } },
    });
    await tx.directoryMember.updateMany({
      where: { ...missing, inactiveTime: null },
      data: { inactiveTime: now, externalRoleIds: [] },
    });
    await tx.directoryDepartment.updateMany({
      where: {
        connectionId,
        externalId: { notIn: snapshot.departments.map((item) => item.externalId) },
        inactiveTime: null,
      },
      data: { inactiveTime: now },
    });
  }

  async runs(corpId: string) {
    await this.config.get(corpId);
    const connection = await this.prisma.directoryConnection.findUnique({
      where: {
        provider_tenantId: { provider: 'dingtalk', tenantId: corpId },
      },
    });
    if (!connection) return [];
    return this.prisma.directorySyncRun.findMany({
      where: { connectionId: connection.id },
      orderBy: { startedTime: 'desc' },
      take: 50,
    });
  }
}

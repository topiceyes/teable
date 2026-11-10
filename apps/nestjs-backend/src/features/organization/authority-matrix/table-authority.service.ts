import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Action } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { Prisma } from '@teable/db-main-prisma';
import {
  tableAuthorityPolicySchema,
  type ITableAuthoritySaveRo,
  type ITableAuthorityVo,
} from '@teable/openapi';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../../types/cls';
import { AuditScope } from '../../audit/audit-scope';
import { DirectoryRoleService } from '../directory/directory-role.service';
import { evaluateTablePolicy } from './table-policy';

@Injectable()
export class TableAuthorityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService<IClsStore>,
    private readonly roles: DirectoryRoleService,
    private readonly audit: AuditScope
  ) {}

  private async requireBase(tx: Prisma.TransactionClient, baseId: string) {
    const base = await tx.base.findFirst({
      where: { id: baseId, deletedTime: null, space: { deletedTime: null } },
      select: { id: true },
    });
    if (!base) throw new NotFoundException('Active base not found');
  }

  async options(baseId: string) {
    await this.requireBase(this.prisma, baseId);
    const [connections, tables] = await Promise.all([
      this.prisma.directoryConnection.findMany({
        where: { enabled: true },
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          tenantId: true,
          businessRoles: {
            where: { enabled: true },
            orderBy: { name: 'asc' },
            select: { id: true, name: true },
          },
        },
      }),
      this.prisma.tableMeta.findMany({
        where: { baseId, deletedTime: null },
        orderBy: { order: 'asc' },
        select: {
          id: true,
          name: true,
          fields: {
            where: { deletedTime: null },
            select: { id: true, name: true, type: true, isPrimary: true },
            orderBy: { order: 'asc' },
          },
        },
      }),
    ]);
    return {
      connections: connections.map(({ businessRoles, tenantId, ...connection }) => ({
        ...connection,
        corpId: tenantId,
        roles: businessRoles,
      })),
      tables,
    };
  }

  async get(baseId: string): Promise<ITableAuthorityVo> {
    await this.requireBase(this.prisma, baseId);
    const row = await this.prisma.tableAuthorityPolicy.findUnique({ where: { baseId } });
    if (!row)
      return {
        baseId,
        connectionId: null,
        revision: 0,
        policy: { version: 1, enabled: false, rules: [] },
      };
    const policy = tableAuthorityPolicySchema.safeParse(row.policy);
    if (!policy.success) throw new ConflictException('Stored policy is invalid');
    return { baseId, connectionId: row.connectionId, revision: row.revision, policy: policy.data };
  }

  async save(ro: ITableAuthoritySaveRo) {
    const saved = await this.persist(ro);
    await this.audit.emitAtomic({
      action: 'base.authority-matrix.update',
      resourceId: ro.baseId,
      params: { revision: saved.revision, connectionId: ro.connectionId, policy: ro.policy },
    });
    return saved;
  }

  private async persist(ro: ITableAuthoritySaveRo): Promise<ITableAuthorityVo> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.requireBase(tx, ro.baseId);
        const [lock] = await tx.$queryRaw<{ acquired: boolean }[]>`
          SELECT pg_try_advisory_xact_lock(hashtextextended(${`matrix:${ro.baseId}`}, 0)) AS acquired
        `;
        if (!lock?.acquired) throw new ConflictException('Policy update already running');
        await this.validateReferences(tx, ro);
        const data = {
          connectionId: ro.connectionId,
          policy: ro.policy as Prisma.InputJsonValue,
          modifiedBy: this.cls.get('user.id'),
        };
        let revision: number;
        if (ro.expectedRevision === 0) {
          await tx.tableAuthorityPolicy.create({ data: { baseId: ro.baseId, ...data } });
          revision = 1;
        } else {
          const updated = await tx.tableAuthorityPolicy.updateMany({
            where: { baseId: ro.baseId, revision: ro.expectedRevision },
            data: { ...data, revision: { increment: 1 } },
          });
          if (updated.count !== 1)
            throw new ConflictException('Policy changed; reload before saving');
          revision = ro.expectedRevision + 1;
        }
        return { baseId: ro.baseId, connectionId: ro.connectionId, revision, policy: ro.policy };
      });
    } catch (error) {
      if ((error as { code?: string })?.code === 'P2002')
        throw new ConflictException('Policy changed; reload before saving');
      throw error;
    }
  }

  private async validateReferences(tx: Prisma.TransactionClient, ro: ITableAuthoritySaveRo) {
    // A disabled stale policy must remain disableable after roles or tables disappear.
    if (!ro.policy.enabled) return;
    const connection = await tx.directoryConnection.findFirst({
      where: { id: ro.connectionId, enabled: true },
      select: { id: true },
    });
    if (!connection) throw new NotFoundException('Enabled directory connection not found');
    const roleIds = [...new Set(ro.policy.rules.map((rule) => rule.roleId))];
    const tableIds = [
      ...new Set([
        ...ro.policy.rules.map((rule) => rule.tableId),
        ...(ro.policy.restrictions || []).map((rule) => rule.tableId),
      ]),
    ];
    const [roleCount, tableCount] = await Promise.all([
      tx.directoryBusinessRole.count({
        where: { id: { in: roleIds }, connectionId: ro.connectionId, enabled: true },
      }),
      tx.tableMeta.count({ where: { id: { in: tableIds }, baseId: ro.baseId, deletedTime: null } }),
    ]);
    if (roleCount !== roleIds.length || tableCount !== tableIds.length)
      throw new NotFoundException('Role or table is unavailable in this scope');
    for (const restriction of ro.policy.restrictions || []) {
      const fields = await tx.field.findMany({
        where: { tableId: restriction.tableId, deletedTime: null },
        select: { id: true, type: true, isPrimary: true },
      });
      const ids = new Set(fields.map((field) => field.id));
      if (
        [...restriction.hiddenFieldIds, ...restriction.readOnlyFieldIds].some((id) => !ids.has(id))
      )
        throw new NotFoundException('Restriction field is unavailable in this table');
      if (fields.some((field) => field.isPrimary && restriction.hiddenFieldIds.includes(field.id)))
        throw new ConflictException('Primary field cannot be hidden');
      if (restriction.rowScope !== 'all' && !fields.some((field) => field.type === 'createdBy'))
        throw new ConflictException('Row restrictions require a Created By field');
    }
  }

  async apply(baseId: string, tableId: string, existingActions: Action[]): Promise<Action[]> {
    // Never amplify shared links, internal app tokens, template access or anonymous users.
    if (
      this.cls.get('shareViewId') ||
      this.cls.get('baseShare') ||
      this.cls.get('template') ||
      this.cls.get('tempAuthBaseId')
    )
      return existingActions;
    const userId = this.cls.get('user.id');
    if (!userId) return existingActions;
    const row = await this.prisma.tableAuthorityPolicy.findUnique({ where: { baseId } });
    const parsed = tableAuthorityPolicySchema.safeParse(row?.policy);
    if (!row || !parsed.success || !parsed.data.enabled) return existingActions;
    const roles = await this.roles.resolveForUser(userId);
    return evaluateTablePolicy(parsed.data, {
      baseId,
      tableBaseId: baseId,
      tableId,
      hasBaseAccess: true,
      effectiveRoleIds: roles
        .filter((role) => role.connectionId === row.connectionId)
        .map((role) => role.roleId),
      existingActions,
      identityMode: 'user',
    });
  }
}

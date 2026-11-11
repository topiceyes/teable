import { randomUUID } from 'node:crypto';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import type { Prisma } from '@teable/db-main-prisma';
import {
  directoryRoleRulesSchema,
  type IDirectoryRoleVo,
  type IDirectoryRoleMembersRo,
  type IDirectorySaveRoleRo,
} from '@teable/openapi';
import { AuditScope } from '../../audit/audit-scope';
import { compileDirectoryRoleRules } from './directory-role-matcher';

const liveUser = {
  deletedTime: null,
  deactivatedTime: null,
  permanentDeletedTime: null,
  OR: [{ isSystem: false }, { isSystem: null }],
};
const departmentSelect = {
  id: true,
  externalId: true,
  name: true,
  parentExternalId: true,
} as const;
function roleVo(role: {
  id: string;
  name: string;
  enabled: boolean;
  version: number;
  rules: unknown;
}): IDirectoryRoleVo {
  const rules = directoryRoleRulesSchema.safeParse(role.rules);
  if (!rules.success) throw new ConflictException('Invalid stored role rules');
  return {
    id: role.id,
    name: role.name,
    enabled: role.enabled,
    version: role.version,
    rules: rules.data,
  };
}

@Injectable()
export class DirectoryRoleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditScope
  ) {}

  private async connection(tx: Prisma.TransactionClient, corpId: string) {
    const connection = await tx.directoryConnection.findFirst({
      where: { provider: 'dingtalk', tenantId: corpId },
    });
    if (!connection) throw new NotFoundException('Directory connection not found');
    return connection;
  }

  async list(corpId: string) {
    const connection = await this.connection(this.prisma, corpId);
    const roles = await this.prisma.directoryBusinessRole.findMany({
      where: { connectionId: connection.id },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    return roles.map(roleVo);
  }

  async save(ro: IDirectorySaveRoleRo) {
    const saved = await this.persist(ro);
    await this.audit.emitAtomic({
      action: 'organization.directory.role.save',
      resourceId: saved.id,
      params: {
        corpId: ro.corpId,
        version: saved.version,
        enabled: saved.enabled,
        rules: saved.rules,
      },
    });
    return saved;
  }

  private async persist(ro: IDirectorySaveRoleRo) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const connection = await this.connection(tx, ro.corpId);
        const [lock] = await tx.$queryRaw<{ acquired: boolean }[]>`
          SELECT pg_try_advisory_xact_lock(hashtextextended(${connection.id}, 0)) AS acquired
        `;
        if (!lock?.acquired) throw new ConflictException('Directory update already running');
        if (ro.enabled && !connection.enabled)
          throw new ConflictException('Directory connection disabled');
        await this.validateRules(tx, connection.id, ro);
        const data = {
          name: ro.name,
          nameKey: ro.name.normalize('NFKC').toLocaleLowerCase('en-US'),
          enabled: ro.enabled,
          rules: ro.rules as Prisma.InputJsonValue,
        };
        if (!ro.roleId) {
          return roleVo(
            await tx.directoryBusinessRole.create({
              data: { id: randomUUID(), connectionId: connection.id, ...data },
            })
          );
        }
        const updated = await tx.directoryBusinessRole.updateMany({
          where: {
            id: ro.roleId,
            connectionId: connection.id,
            version: ro.expectedVersion,
          },
          data: { ...data, version: { increment: 1 } },
        });
        if (updated.count !== 1)
          throw new ConflictException('Role changed or unavailable; refresh before editing');
        return roleVo(
          await tx.directoryBusinessRole.findFirstOrThrow({
            where: { id: ro.roleId, connectionId: connection.id },
          })
        );
      });
    } catch (error) {
      if ((error as { code?: string })?.code === 'P2002')
        throw new ConflictException('Role name already exists in this enterprise');
      throw error;
    }
  }

  private async validateRules(
    tx: Prisma.TransactionClient,
    connectionId: string,
    ro: IDirectorySaveRoleRo
  ) {
    if (!ro.enabled) return;
    const departmentIds = ro.rules.flatMap((rule) =>
      rule.type === 'department' ? [rule.departmentId] : []
    );
    const count = await tx.directoryDepartment.count({
      where: { connectionId, inactiveTime: null, id: { in: departmentIds } },
    });
    if (count !== departmentIds.length)
      throw new NotFoundException('Active department not found in this enterprise');
    const memberIds = ro.rules.flatMap((rule) => (rule.type === 'member' ? [rule.memberId] : []));
    if (memberIds.length) {
      const memberCount = await tx.directoryMember.count({
        where: { connectionId, inactiveTime: null, id: { in: memberIds } },
      });
      if (memberCount !== memberIds.length)
        throw new NotFoundException('Active employee not found in this enterprise');
    }
  }

  async members(ro: IDirectoryRoleMembersRo) {
    return this.prisma.$transaction(
      async (tx) => {
        const connection = await this.connection(tx, ro.corpId);
        const role = await tx.directoryBusinessRole.findFirst({
          where: { id: ro.roleId, connectionId: connection.id },
        });
        if (!role) throw new NotFoundException('Business role not found');
        if (!connection.enabled || !role.enabled) return { members: [], total: 0 };
        const departments = await tx.directoryDepartment.findMany({
          where: { connectionId: connection.id, inactiveTime: null },
          select: departmentSelect,
        });
        const match = compileDirectoryRoleRules(roleVo(role).rules, departments);
        const rows = await tx.directoryMember.findMany({
          where: {
            connectionId: connection.id,
            inactiveTime: null,
            userId: { not: null },
            user: liveUser,
          },
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
          include: {
            user: { select: { id: true, name: true, email: true } },
            memberships: {
              where: { department: { inactiveTime: null } },
              select: { departmentId: true },
            },
          },
        });
        const matched = rows.filter((row) =>
          match({
            memberId: row.id,
            departmentIds: row.memberships.map((item) => item.departmentId),
            externalRoleIds: row.externalRoleIds,
          })
        );
        return {
          total: matched.length,
          members: matched.slice(ro.skip, ro.skip + ro.take).map((row) => ({
            memberId: row.id,
            userId: row.user!.id,
            name: row.user!.name,
            email: row.user!.email,
          })),
        };
      },
      { isolationLevel: 'RepeatableRead' }
    );
  }

  /** Live identity resolver for the future matrix; does not grant or cache permissions. */
  async resolveForUser(userId: string) {
    return this.prisma.$transaction(
      async (tx) => {
        const members = await tx.directoryMember.findMany({
          where: { userId, inactiveTime: null, user: liveUser, connection: { enabled: true } },
          include: {
            memberships: {
              where: { department: { inactiveTime: null } },
              select: { departmentId: true },
            },
            connection: {
              include: {
                businessRoles: { where: { enabled: true } },
                departments: { where: { inactiveTime: null }, select: departmentSelect },
              },
            },
          },
        });
        return members.flatMap((member) =>
          member.connection.businessRoles.flatMap((role) => {
            const rules = directoryRoleRulesSchema.safeParse(role.rules);
            if (!rules.success) return [];
            const match = compileDirectoryRoleRules(rules.data, member.connection.departments);
            return match({
              memberId: member.id,
              departmentIds: member.memberships.map((item) => item.departmentId),
              externalRoleIds: member.externalRoleIds,
            })
              ? [{ roleId: role.id, connectionId: member.connectionId, name: role.name }]
              : [];
          })
        );
      },
      { isolationLevel: 'RepeatableRead' }
    );
  }
}

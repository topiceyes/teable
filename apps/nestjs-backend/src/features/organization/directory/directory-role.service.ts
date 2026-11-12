import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import type { Prisma } from '@teable/db-main-prisma';
import {
  directoryRoleRulesSchema,
  type IDirectoryRoleVo,
  type IDirectoryMemberRolesRo,
  type IDirectorySaveMemberRolesRo,
  type IDirectoryPreviewRoleRo,
  type IDirectoryPreviewRoleVo,
  type IDirectoryRoleMembersRo,
  type IDirectorySaveRoleRo,
} from '@teable/openapi';
import { AuditScope } from '../../audit/audit-scope';
import { DirectoryRoleHistoryService } from './directory-role-history.service';
import { compileDirectoryRoleRules } from './directory-role-matcher';

const liveUser = {
  deletedTime: null,
  deactivatedTime: null,
  permanentDeletedTime: null,
  OR: [{ isSystem: false }, { isSystem: null }],
};
const eligibilitySelect = {
  deletedTime: true,
  deactivatedTime: true,
  permanentDeletedTime: true,
  isSystem: true,
} as const;
type IPreviewEmployee = Prisma.DirectoryMemberGetPayload<{
  include: {
    user: { select: typeof eligibilitySelect };
    memberships: { select: { departmentId: true } };
  };
}>;
function membershipChange(was: boolean, will: boolean, directRemoved: boolean, pending: boolean) {
  if (!was && will) return 'added';
  if (was && !will) return 'removed';
  if (was && will && directRemoved) return 'retained';
  if (pending) return 'pending';
  return null;
}
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
    private readonly audit: AuditScope,
    private readonly history: DirectoryRoleHistoryService
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

  async save(ro: IDirectorySaveRoleRo, requiredActiveMemberIds?: string[]) {
    const saved = await this.persist(ro, requiredActiveMemberIds);
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

  private async persist(ro: IDirectorySaveRoleRo, requiredActiveMemberIds?: string[]) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const connection = await this.connection(tx, ro.corpId);
        const [lock] = await tx.$queryRaw<{ acquired: boolean }[]>`
          SELECT pg_try_advisory_xact_lock(hashtextextended(${connection.id}, 0)) AS acquired
        `;
        if (!lock?.acquired) throw new ConflictException('Directory update already running');
        if (ro.enabled && !connection.enabled)
          throw new ConflictException('Directory connection disabled');
        await this.validateAddedPeople(tx, connection, requiredActiveMemberIds);
        await this.validateRules(tx, connection.id, ro);
        const data = {
          name: ro.name,
          nameKey: ro.name.normalize('NFKC').toLocaleLowerCase('en-US'),
          enabled: ro.enabled,
          rules: ro.rules as Prisma.InputJsonValue,
        };
        if (!ro.roleId) {
          const created = roleVo(
            await tx.directoryBusinessRole.create({
              data: { id: randomUUID(), connectionId: connection.id, ...data },
            })
          );
          await this.history.record(tx, null, created);
          return created;
        }
        const previous = await tx.directoryBusinessRole.findFirst({
          where: { id: ro.roleId, connectionId: connection.id, version: ro.expectedVersion },
        });
        if (!previous)
          throw new ConflictException('Role changed or unavailable; refresh before editing');
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
        const saved = roleVo(
          await tx.directoryBusinessRole.findFirstOrThrow({
            where: { id: ro.roleId, connectionId: connection.id },
          })
        );
        await this.history.record(tx, roleVo(previous), saved);
        return saved;
      });
    } catch (error) {
      if ((error as { code?: string })?.code === 'P2002')
        throw new ConflictException('Role name already exists in this enterprise');
      throw error;
    }
  }

  private async validateAddedPeople(
    tx: Prisma.TransactionClient,
    connection: { id: string; enabled: boolean },
    memberIds?: string[]
  ) {
    if (!memberIds) return;
    if (!connection.enabled) throw new ConflictException('Directory connection disabled');
    const count = await tx.directoryMember.count({
      where: {
        connectionId: connection.id,
        inactiveTime: null,
        id: { in: memberIds },
      },
    });
    if (count !== memberIds.length)
      throw new NotFoundException('Active employee not found in this enterprise');
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

  private async roleContext(tx: Prisma.TransactionClient, corpId: string) {
    const connection = await this.connection(tx, corpId);
    const departments = await tx.directoryDepartment.findMany({
      where: { connectionId: connection.id, inactiveTime: null },
      select: departmentSelect,
    });
    return { connection, departments };
  }

  private async employee(tx: Prisma.TransactionClient, connectionId: string, memberId: string) {
    const member = await tx.directoryMember.findFirst({
      where: { id: memberId, connectionId },
      include: {
        user: { select: eligibilitySelect },
        memberships: {
          where: { department: { inactiveTime: null } },
          select: { departmentId: true },
        },
      },
    });
    if (!member) throw new NotFoundException('Employee not found in this enterprise');
    return member;
  }

  private eligible(member: {
    inactiveTime: Date | null;
    user: {
      deletedTime: Date | null;
      deactivatedTime: Date | null;
      permanentDeletedTime: Date | null;
      isSystem: boolean | null;
    } | null;
  }) {
    return (
      !member.inactiveTime &&
      !!member.user &&
      !member.user.deletedTime &&
      !member.user.deactivatedTime &&
      !member.user.permanentDeletedTime &&
      !member.user.isSystem
    );
  }

  async memberRoles(ro: IDirectoryMemberRolesRo) {
    return this.prisma.$transaction(
      async (tx) => {
        const { connection, departments } = await this.roleContext(tx, ro.corpId);
        const member = await this.employee(tx, connection.id, ro.memberId);
        const eligible = connection.enabled && this.eligible(member);
        const roles = await tx.directoryBusinessRole.findMany({
          where: { connectionId: connection.id },
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
        });
        const identity = {
          memberId: member.id,
          departmentIds: member.memberships.map((item) => item.departmentId),
          externalRoleIds: member.externalRoleIds,
        };
        return {
          eligible,
          roles: roles.map((stored) => {
            const role = roleVo(stored);
            const sources = (['member', 'department', 'externalRole'] as const).filter((type) =>
              compileDirectoryRoleRules(
                role.rules.filter((rule) => rule.type === type),
                departments
              )(identity)
            );
            return { ...role, sources, effective: eligible && role.enabled && sources.length > 0 };
          }),
        };
      },
      { isolationLevel: 'RepeatableRead' }
    );
  }

  private async planMemberAssignment(
    tx: Prisma.TransactionClient,
    connection: { id: string; enabled: boolean },
    member: { id: string; inactiveTime: Date | null },
    corpId: string,
    assignment: IDirectorySaveMemberRolesRo['assignments'][number]
  ) {
    const stored = await tx.directoryBusinessRole.findFirst({
      where: { id: assignment.roleId, connectionId: connection.id },
    });
    if (!stored || stored.version !== assignment.expectedVersion)
      throw new ConflictException('Role changed or unavailable; refresh before editing');
    const role = roleVo(stored);
    const assigned = role.rules.some(
      (rule) => rule.type === 'member' && rule.memberId === member.id
    );
    if (assigned === assignment.assigned) return null;
    if (assignment.assigned && member.inactiveTime)
      throw new NotFoundException('Active employee not found in this enterprise');
    if (assignment.assigned && !connection.enabled)
      throw new ConflictException('Directory connection disabled');
    const rules = role.rules.filter(
      (rule) => rule.type !== 'member' || rule.memberId !== member.id
    );
    if (assignment.assigned) rules.push({ type: 'member', memberId: member.id });
    const parsed = directoryRoleRulesSchema.safeParse(rules);
    if (!parsed.success) throw new BadRequestException('Role rule limit exceeded');
    await this.validateRules(tx, connection.id, {
      corpId,
      roleId: role.id,
      expectedVersion: role.version,
      name: role.name,
      enabled: role.enabled,
      rules,
    });
    return { role, rules };
  }

  async saveMemberRoles(ro: IDirectorySaveMemberRolesRo) {
    const saved = await this.prisma.$transaction(async (tx) => {
      const connection = await this.connection(tx, ro.corpId);
      const [lock] = await tx.$queryRaw<{ acquired: boolean }[]>`
        SELECT pg_try_advisory_xact_lock(hashtextextended(${connection.id}, 0)) AS acquired
      `;
      if (!lock?.acquired) throw new ConflictException('Directory update already running');
      const member = await this.employee(tx, connection.id, ro.memberId);
      const plans = [];
      // Validate every revision and reference before writing; the transaction also rolls back conflicts.
      for (const assignment of ro.assignments) {
        const plan = await this.planMemberAssignment(tx, connection, member, ro.corpId, assignment);
        if (plan) plans.push(plan);
      }
      const result: IDirectoryRoleVo[] = [];
      for (const { role, rules } of plans) {
        const updated = await tx.directoryBusinessRole.updateMany({
          where: { id: role.id, connectionId: connection.id, version: role.version },
          data: { rules: rules as Prisma.InputJsonValue, version: { increment: 1 } },
        });
        if (updated.count !== 1)
          throw new ConflictException('Role changed or unavailable; refresh before editing');
        const savedRole = { ...role, rules, version: role.version + 1 };
        await this.history.record(tx, role, savedRole);
        result.push(savedRole);
      }
      return result;
    });
    for (const role of saved) {
      await this.audit.emitAtomic({
        action: 'organization.directory.role.save',
        resourceId: role.id,
        params: {
          corpId: ro.corpId,
          memberId: ro.memberId,
          version: role.version,
          enabled: role.enabled,
          rules: role.rules,
        },
      });
    }
    return saved;
  }

  async preview(ro: IDirectoryPreviewRoleRo): Promise<IDirectoryPreviewRoleVo> {
    return this.prisma.$transaction(
      async (tx) => {
        const { connection, departments } = await this.roleContext(tx, ro.corpId);
        const stored = ro.roleId
          ? await tx.directoryBusinessRole.findFirst({
              where: { id: ro.roleId, connectionId: connection.id },
            })
          : null;
        if (ro.roleId && (!stored || stored.version !== ro.expectedVersion))
          throw new ConflictException('Role changed or unavailable; refresh before editing');
        if (ro.enabled && !connection.enabled)
          throw new ConflictException('Directory connection disabled');
        await this.validateRules(tx, connection.id, ro);
        const before = stored ? roleVo(stored) : null;
        const rows = await tx.directoryMember.findMany({
          where: { connectionId: connection.id },
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
          include: {
            user: { select: eligibilitySelect },
            memberships: {
              where: { department: { inactiveTime: null } },
              select: { departmentId: true },
            },
          },
        });
        return this.previewMembers(rows, connection.enabled, departments, before, ro);
      },
      { isolationLevel: 'RepeatableRead' }
    );
  }

  private previewMembers(
    rows: IPreviewEmployee[],
    connectionEnabled: boolean,
    departments: Parameters<typeof compileDirectoryRoleRules>[1],
    before: IDirectoryRoleVo | null,
    ro: IDirectoryPreviewRoleRo
  ): IDirectoryPreviewRoleVo {
    const oldMatch = compileDirectoryRoleRules(before?.rules ?? [], departments);
    const newMatch = compileDirectoryRoleRules(ro.rules, departments);
    const result: IDirectoryPreviewRoleVo = {
      before: 0,
      after: 0,
      counts: { added: 0, removed: 0, retained: 0, pending: 0 },
      total: 0,
      members: [],
    };
    const oldDirect = new Set(
      before?.rules.flatMap((rule) => (rule.type === 'member' ? [rule.memberId] : []))
    );
    const newDirect = new Set(
      ro.rules.flatMap((rule) => (rule.type === 'member' ? [rule.memberId] : []))
    );
    for (const row of rows) {
      const identity = {
        memberId: row.id,
        departmentIds: row.memberships.map((item) => item.departmentId),
        externalRoleIds: row.externalRoleIds,
      };
      const eligible = connectionEnabled && this.eligible(row);
      const was = eligible && !!before?.enabled && oldMatch(identity);
      const will = eligible && ro.enabled && newMatch(identity);
      if (was) result.before++;
      if (will) result.after++;
      const pending =
        !row.inactiveTime && !eligible && connectionEnabled && ro.enabled && newMatch(identity);
      const change = membershipChange(
        was,
        will,
        oldDirect.has(row.id) && !newDirect.has(row.id),
        pending
      );
      if (!change) continue;
      result.counts[change]++;
      result.members.push({
        memberId: row.id,
        name: row.name,
        externalId: row.externalId,
        change,
      });
    }
    result.total = result.members.length;
    result.members = result.members.slice(ro.skip, ro.skip + ro.take);
    return result;
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

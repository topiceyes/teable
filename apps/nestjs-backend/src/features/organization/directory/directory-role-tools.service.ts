import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import type { Prisma } from '@teable/db-main-prisma';
import {
  directoryRoleVoSchema,
  directoryRoleRulesSchema,
  type IDirectoryRoleRosterRo,
  type IDirectoryRoleRosterVo,
  type IDirectorySetRolePeopleRo,
} from '@teable/openapi';
import { compileDirectoryRoleRules } from './directory-role-matcher';
import { DirectoryRoleService } from './directory-role.service';

export const rosterInclude = {
  user: {
    select: {
      id: true,
      name: true,
      email: true,
      isAdmin: true,
      deletedTime: true,
      permanentDeletedTime: true,
      deactivatedTime: true,
      isSystem: true,
    },
  },
  memberships: {
    where: { department: { inactiveTime: null } },
    include: {
      department: {
        select: { id: true, name: true },
      },
    },
  },
} satisfies Prisma.DirectoryMemberInclude;
export type RosterMember = Prisma.DirectoryMemberGetPayload<{ include: typeof rosterInclude }>;
export function accountEligible(member: RosterMember) {
  const user = member.user;
  return (
    !!user &&
    !user.deletedTime &&
    !user.permanentDeletedTime &&
    !user.deactivatedTime &&
    !user.isSystem
  );
}
export function roleSources(
  rules: Parameters<typeof compileDirectoryRoleRules>[0],
  departments: Parameters<typeof compileDirectoryRoleRules>[1],
  member: RosterMember
) {
  const identity = {
    memberId: member.id,
    departmentIds: member.memberships.map((item) => item.departmentId),
    externalRoleIds: member.externalRoleIds,
  };
  return (['member', 'department', 'externalRole'] as const).filter((source) =>
    compileDirectoryRoleRules(
      rules.filter((rule) => rule.type === source),
      departments
    )(identity)
  );
}
export async function directorySnapshot(tx: Prisma.TransactionClient, corpId: string) {
  const connection = await tx.directoryConnection.findFirst({
    where: { provider: 'dingtalk', tenantId: corpId },
  });
  if (!connection) throw new NotFoundException('Directory connection not found');
  const [departments, members, roles] = await Promise.all([
    tx.directoryDepartment.findMany({
      where: { connectionId: connection.id, inactiveTime: null },
      select: { id: true, externalId: true, name: true, parentExternalId: true },
    }),
    tx.directoryMember.findMany({
      where: { connectionId: connection.id },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      include: rosterInclude,
    }),
    tx.directoryBusinessRole.findMany({
      where: { connectionId: connection.id },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    }),
  ]);
  return { connection, departments, members, roles };
}
@Injectable()
export class DirectoryRoleToolsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly roles: DirectoryRoleService
  ) {}

  async counts(corpId: string) {
    return this.prisma.$transaction(
      async (tx) => {
        const { connection, departments, members, roles } = await directorySnapshot(tx, corpId);
        return roles.map((role) => {
          const parsed = directoryRoleRulesSchema.safeParse(role.rules);
          const matched = parsed.success
            ? members.filter(
                (member) =>
                  !member.inactiveTime && roleSources(parsed.data, departments, member).length
              )
            : [];
          return {
            roleId: role.id,
            effective:
              connection.enabled && role.enabled ? matched.filter(accountEligible).length : 0,
            unbound: matched.filter((member) => !member.userId).length,
          };
        });
      },
      { isolationLevel: 'RepeatableRead' }
    );
  }
  async roster(ro: IDirectoryRoleRosterRo): Promise<IDirectoryRoleRosterVo> {
    return this.prisma.$transaction(
      async (tx) => {
        const { connection, departments, members, roles } = await directorySnapshot(tx, ro.corpId);
        const stored = roles.find((role) => role.id === ro.roleId);
        if (!stored) throw new NotFoundException('Business role not found');
        const role = directoryRoleVoSchema.parse(stored);
        const rows = members.map((member) => {
          const sources = roleSources(role.rules, departments, member);
          return {
            member,
            sources,
            effective:
              connection.enabled &&
              role.enabled &&
              !member.inactiveTime &&
              accountEligible(member) &&
              sources.length > 0,
          };
        });
        const counts = {
          matched: rows.filter((row) => row.sources.length).length,
          effective: rows.filter((row) => row.effective).length,
          unbound: rows.filter(
            (row) => !row.member.inactiveTime && !row.member.userId && row.sources.length
          ).length,
        };
        const filtered = rows.filter((row) => matchesRoster(ro, row));
        return {
          role,
          counts,
          total: filtered.length,
          members: filtered
            .slice(ro.skip, ro.skip + ro.take)
            .map(({ member, sources, effective }) => ({
              id: member.id,
              externalId: member.externalId,
              name: member.name,
              email: member.email,
              active: !member.inactiveTime,
              userId: member.userId,
              user:
                member.user && !member.user.deletedTime && !member.user.permanentDeletedTime
                  ? {
                      id: member.user.id,
                      name: member.user.name,
                      email: member.user.email,
                    }
                  : null,
              departments: member.memberships.map((item) => item.department),
              externalRoleIds: member.externalRoleIds,
              sources,
              effective,
            })),
        };
      },
      { isolationLevel: 'RepeatableRead' }
    );
  }

  async setPeople(ro: IDirectorySetRolePeopleRo) {
    const stored = await this.prisma.directoryBusinessRole.findFirst({
      where: {
        id: ro.roleId,
        connection: { provider: 'dingtalk', tenantId: ro.corpId },
      },
    });
    if (!stored || stored.version !== ro.expectedVersion)
      throw new ConflictException('Role changed or unavailable; refresh before editing');
    const role = directoryRoleVoSchema.parse(stored);
    const targets = await this.prisma.directoryMember.count({
      where: {
        connectionId: stored.connectionId,
        id: { in: ro.memberIds },
        ...(ro.assigned ? { inactiveTime: null } : {}),
      },
    });
    if (targets !== ro.memberIds.length)
      throw new NotFoundException('Active employee not found in this enterprise');
    const selected = new Set(ro.memberIds);
    const rules = role.rules.filter(
      (rule) => rule.type !== 'member' || !selected.has(rule.memberId)
    );
    if (ro.assigned)
      rules.push(...ro.memberIds.map((memberId) => ({ type: 'member' as const, memberId })));
    if (!directoryRoleRulesSchema.safeParse(rules).success)
      throw new BadRequestException('Role rule limit exceeded');
    // save() acquires the shared sync lock, revalidates references/version, and writes history atomically.
    const input = {
      corpId: ro.corpId,
      roleId: role.id,
      expectedVersion: ro.expectedVersion,
      name: role.name,
      enabled: role.enabled,
      rules,
    };
    return ro.assigned ? this.roles.save(input, ro.memberIds) : this.roles.save(input);
  }
}
function matchesRoster(
  ro: IDirectoryRoleRosterRo,
  row: { member: RosterMember; sources: string[] }
) {
  const { member, sources } = row;
  if (ro.scope === 'matched' && !sources.length) return false;
  if (ro.source !== 'all' && !sources.includes(ro.source)) return false;
  if (ro.departmentId && !member.memberships.some((item) => item.departmentId === ro.departmentId))
    return false;
  if (ro.binding === 'bound' && !member.userId) return false;
  if (ro.binding === 'unbound' && member.userId) return false;
  const search = ro.search?.normalize('NFKC').toLocaleLowerCase();
  return (
    !search ||
    [member.name, member.externalId].some((value) =>
      value.normalize('NFKC').toLocaleLowerCase().includes(search)
    )
  );
}

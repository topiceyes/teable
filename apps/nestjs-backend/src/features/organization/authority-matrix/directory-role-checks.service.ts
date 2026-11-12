import { Injectable } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import {
  directoryRoleRulesSchema,
  tableAuthorityPolicySchema,
  type IDirectoryChecksRo,
  type IDirectoryChecksVo,
} from '@teable/openapi';
import {
  accountEligible,
  directorySnapshot,
  roleSources,
} from '../directory/directory-role-tools.service';
import { TableAuthorityPreviewService } from './table-authority-preview.service';

type Issue = IDirectoryChecksVo['issues'][number];
type Snapshot = Awaited<ReturnType<typeof directorySnapshot>>;
function configurationIssues(snapshot: Snapshot): Issue[] {
  const members = new Map(snapshot.members.map((member) => [member.id, member]));
  const departments = new Set(snapshot.departments.map((department) => department.id));
  return snapshot.roles.flatMap((role) => {
    const parsed = directoryRoleRulesSchema.safeParse(role.rules);
    const context = { roleId: role.id, roleName: role.name, roleEnabled: role.enabled };
    if (!parsed.success) return [{ ...context, kind: 'invalidRules' as const }];
    return parsed.data.flatMap((rule): Issue[] => {
      if (rule.type === 'department')
        return departments.has(rule.departmentId)
          ? []
          : [{ ...context, kind: 'invalidDepartment', departmentId: rule.departmentId }];
      if (rule.type !== 'member') return [];
      const member = members.get(rule.memberId);
      if (!member) return [{ ...context, kind: 'missingMember', memberId: rule.memberId }];
      const person = { ...context, memberId: member.id, memberName: member.name };
      if (member.inactiveTime) return [{ ...person, kind: 'inactiveMember' }];
      if (!member.userId) return [{ ...person, kind: 'unboundMember' }];
      return accountEligible(member) ? [] : [{ ...person, kind: 'inactiveAccount' }];
    });
  });
}
@Injectable()
export class DirectoryRoleChecksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly preview: TableAuthorityPreviewService
  ) {}
  async check(ro: IDirectoryChecksRo): Promise<IDirectoryChecksVo> {
    const { snapshot, policies } = await this.prisma.$transaction(
      async (tx) => ({
        snapshot: await directorySnapshot(tx, ro.corpId),
        policies: await tx.tableAuthorityPolicy.findMany({
          where: {
            connection: { provider: 'dingtalk', tenantId: ro.corpId },
            base: { deletedTime: null, space: { deletedTime: null } },
          },
          select: { policy: true, base: { select: { id: true, name: true } } },
        }),
      }),
      { isolationLevel: 'RepeatableRead' }
    );
    const issues = configurationIssues(snapshot);
    if (ro.kind === 'all' || ro.kind === 'noBaseAccess')
      issues.push(...(await this.baseIssues(snapshot, policies)));
    const filtered = issues.filter((issue) => ro.kind === 'all' || issue.kind === ro.kind);
    filtered.sort((a, b) =>
      JSON.stringify([a.kind, a.roleId, a.memberId, a.departmentId, a.baseId]).localeCompare(
        JSON.stringify([b.kind, b.roleId, b.memberId, b.departmentId, b.baseId])
      )
    );
    return {
      checkedAt: new Date().toISOString(),
      connectionEnabled: snapshot.connection.enabled,
      total: filtered.length,
      issues: filtered.slice(ro.skip, ro.skip + ro.take),
    };
  }
  private async baseIssues(
    snapshot: Snapshot,
    policies: { policy: unknown; base: { id: string; name: string | null } }[]
  ): Promise<Issue[]> {
    if (!snapshot.connection.enabled) return [];
    const issues: Issue[] = [];
    const roles = snapshot.roles
      .filter((role) => role.enabled)
      .flatMap((role) => {
        const parsed = directoryRoleRulesSchema.safeParse(role.rules);
        return parsed.success ? [{ role, rules: parsed.data }] : [];
      });
    for (const member of snapshot.members.filter(
      (row) => !row.inactiveTime && accountEligible(row)
    )) {
      const matched = roles.filter(
        ({ rules }) => roleSources(rules, snapshot.departments, member).length
      );
      issues.push(...(await this.memberBaseIssues(member, matched, policies)));
    }
    return issues;
  }
  private async memberBaseIssues(
    member: Snapshot['members'][number],
    matched: { role: Snapshot['roles'][number] }[],
    policies: { policy: unknown; base: { id: string; name: string | null } }[]
  ): Promise<Issue[]> {
    const issues: Issue[] = [];
    for (const policyRow of policies) {
      const policy = tableAuthorityPolicySchema.safeParse(policyRow.policy);
      if (!policy.success || !policy.data.enabled) continue;
      const referenced = new Set([
        ...policy.data.rules.filter((rule) => rule.actions.length > 0).map((rule) => rule.roleId),
        ...(policy.data.restrictions ?? []).flatMap((rule) =>
          (rule.roleOverrides ?? []).map((override) => override.roleId)
        ),
      ]);
      const relevant = matched.filter(({ role }) => referenced.has(role.id));
      if (!relevant.length) continue;
      const actions = await this.preview.baseAccess(member.user!, policyRow.base.id);
      if (actions.includes('base|read')) continue;
      issues.push(
        ...relevant.map(({ role }) => ({
          kind: 'noBaseAccess' as const,
          roleId: role.id,
          roleName: role.name,
          roleEnabled: role.enabled,
          memberId: member.id,
          memberName: member.name,
          baseId: policyRow.base.id,
          baseName: policyRow.base.name ?? policyRow.base.id,
        }))
      );
    }
    return issues;
  }
}

import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@teable/db-main-prisma';
import { PrismaService } from '@teable/db-main-prisma';
import {
  tableAuthorityPolicySchema,
  tableMatrixActions,
  type IMemberAuthorityDiagnostic,
  type IMemberAuthorityRo,
  type IMemberAuthorityTablesRo,
  type ITableAuthorityPreviewVo,
} from '@teable/openapi';
import { DirectoryRoleService } from '../directory/directory-role.service';
import { TableAuthorityPreviewService } from './table-authority-preview.service';

const identitySelect = {
  id: true,
  name: true,
  inactiveTime: true,
  user: {
    select: {
      id: true,
      name: true,
      email: true,
      isAdmin: true,
      isSystem: true,
      deletedTime: true,
      deactivatedTime: true,
      permanentDeletedTime: true,
    },
  },
  connection: { select: { id: true, enabled: true } },
  memberships: {
    where: { department: { inactiveTime: null } },
    select: { department: { select: { id: true, name: true } } },
  },
} satisfies Prisma.DirectoryMemberSelect;
type Identity = Prisma.DirectoryMemberGetPayload<{ select: typeof identitySelect }>;
const baseSelect = {
  id: true,
  name: true,
  spaceId: true,
  space: { select: { name: true } },
  authorityPolicy: { select: { connectionId: true, policy: true } },
} satisfies Prisma.BaseSelect;
type Base = Prisma.BaseGetPayload<{ select: typeof baseSelect }>;
type PolicyRow = Base['authorityPolicy'];

function activeAccount(member: Identity) {
  const user = member.user;
  return Boolean(
    user &&
    !user.deletedTime &&
    !user.permanentDeletedTime &&
    !user.deactivatedTime &&
    !user.isSystem
  );
}
function policyState(row: PolicyRow) {
  if (!row) return 'missing' as const;
  const parsed = tableAuthorityPolicySchema.safeParse(row.policy);
  if (!parsed.success) return 'invalid' as const;
  return parsed.data.enabled ? ('enabled' as const) : ('disabled' as const);
}
function policyDiagnostics(row: PolicyRow, connectionId: string): IMemberAuthorityDiagnostic[] {
  const state = policyState(row);
  const codes: IMemberAuthorityDiagnostic[] = [];
  if (state === 'missing') codes.push('policyMissing');
  if (state === 'disabled') codes.push('policyDisabled');
  if (state === 'invalid') codes.push('policyInvalid');
  if (row && row.connectionId !== connectionId) codes.push('policyOtherEnterprise');
  return codes;
}
function baseVo(base: Base) {
  return { id: base.id, name: base.name, spaceName: base.space.name };
}
function identityDiagnostics(member: Identity, roleCount: number): IMemberAuthorityDiagnostic[] {
  const codes: IMemberAuthorityDiagnostic[] = [];
  if (!member.user) codes.push('accountUnbound');
  else if (!activeAccount(member)) codes.push('accountInactive');
  if (member.inactiveTime) codes.push('employeeInactive');
  if (!member.connection.enabled) codes.push('connectionDisabled');
  if (!roleCount) codes.push('noEffectiveRole');
  return codes;
}
function tableDiagnostics(
  preview: ITableAuthorityPreviewVo,
  hasRule: boolean
): IMemberAuthorityDiagnostic[] {
  const codes: IMemberAuthorityDiagnostic[] = [];
  if (!preview.hasBaseAccess) codes.push('noBaseAccess');
  if (!hasRule) codes.push('noTableRule');
  const writes = preview.actions.filter(
    (item) =>
      item.allowed && ['record|create', 'record|update', 'record|delete'].includes(item.action)
  );
  if (writes.some((item) => item.sources.includes('collaborator'))) codes.push('collaboratorWrite');
  if (writes.some((item) => item.sources.includes('matrix'))) codes.push('matrixWrite');
  if (preview.dataScope?.rowScope === 'own') codes.push('ownRows');
  if (preview.dataScope?.rowScope === 'department') codes.push('departmentRows');
  if (preview.dataScope?.rowScope === 'department' && preview.dataScope.emptyRowScope)
    codes.push('emptyDepartmentScope');
  if (preview.dataScope?.hiddenFields.length || preview.dataScope?.readOnlyFields.length)
    codes.push('fieldRestrictions');
  return codes;
}

@Injectable()
export class MemberAuthorityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly roles: DirectoryRoleService,
    private readonly preview: TableAuthorityPreviewService
  ) {}

  private async identity(ro: Pick<IMemberAuthorityRo, 'corpId' | 'memberId'>) {
    const member = await this.prisma.directoryMember.findFirst({
      where: { id: ro.memberId, connection: { provider: 'dingtalk', tenantId: ro.corpId } },
      select: identitySelect,
    });
    if (!member) throw new NotFoundException('Employee unavailable in this enterprise');
    return member;
  }

  async overview(ro: IMemberAuthorityRo) {
    const member = await this.identity(ro);
    const effectiveRoles = activeAccount(member)
      ? await this.roles.resolveForUser(member.user!.id)
      : [];
    const selectedRoles = effectiveRoles.filter(
      (role) => role.connectionId === member.connection.id
    );
    const where: Prisma.BaseWhereInput = {
      deletedTime: null,
      space: { deletedTime: null },
      ...(ro.search
        ? {
            OR: [
              { name: { contains: ro.search, mode: 'insensitive' } },
              { id: ro.search },
              { space: { name: { contains: ro.search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const [bases, total] = await Promise.all([
      this.prisma.base.findMany({
        where,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip: ro.skip,
        take: ro.take,
        select: baseSelect,
      }),
      this.prisma.base.count({ where }),
    ]);
    const rows = await Promise.all(
      bases.map(async (base) => {
        const actions = activeAccount(member)
          ? await this.preview.baseAccess(member.user!, base.id)
          : [];
        const hasBaseAccess = actions.includes('base|read');
        const memberships = activeAccount(member)
          ? await this.prisma.collaborator.findMany({
              where: {
                principalId: member.user!.id,
                principalType: 'user',
                OR: [
                  { resourceType: 'base', resourceId: base.id },
                  { resourceType: 'space', resourceId: base.spaceId },
                ],
              },
              select: { resourceType: true, roleName: true },
              orderBy: { id: 'asc' },
            })
          : [];
        return {
          ...baseVo(base),
          hasBaseAccess,
          memberships: memberships
            .filter((item) => item.resourceType === 'space' || item.resourceType === 'base')
            .map((item) => ({
              resourceType: item.resourceType as 'space' | 'base',
              role: item.roleName,
            })),
          policyState: policyState(base.authorityPolicy),
          diagnostics: [
            ...(hasBaseAccess ? [] : ['noBaseAccess' as const]),
            ...policyDiagnostics(base.authorityPolicy, member.connection.id),
          ],
        };
      })
    );
    const user = member.user;
    return {
      checkedAt: new Date().toISOString(),
      employee: {
        id: member.id,
        name: member.name,
        active: !member.inactiveTime,
        connectionEnabled: member.connection.enabled,
        account:
          user && !user.deletedTime && !user.permanentDeletedTime
            ? {
                id: user.id,
                name: user.name,
                email: user.email,
                active: activeAccount(member),
                isAdmin: Boolean(user.isAdmin),
              }
            : null,
        departments: member.memberships.map((item) => item.department),
        roles: selectedRoles.map((role) => ({ id: role.roleId, name: role.name })),
      },
      diagnostics: identityDiagnostics(member, selectedRoles.length),
      total,
      bases: rows,
    };
  }

  async tables(ro: IMemberAuthorityTablesRo) {
    const member = await this.identity(ro);
    const selectedRoles = activeAccount(member)
      ? (await this.roles.resolveForUser(member.user!.id)).filter(
          (role) => role.connectionId === member.connection.id
        )
      : [];
    const base = await this.prisma.base.findFirst({
      where: { id: ro.baseId, deletedTime: null, space: { deletedTime: null } },
      select: baseSelect,
    });
    if (!base) throw new NotFoundException('Active base not found');
    const where: Prisma.TableMetaWhereInput = {
      baseId: base.id,
      deletedTime: null,
      ...(ro.search ? { name: { contains: ro.search, mode: 'insensitive' } } : {}),
    };
    const [tables, total] = await Promise.all([
      this.prisma.tableMeta.findMany({
        where,
        orderBy: [{ order: 'asc' }, { id: 'asc' }],
        skip: ro.skip,
        take: ro.take,
        select: { id: true, name: true },
      }),
      this.prisma.tableMeta.count({ where }),
    ]);
    const rows = await Promise.all(
      tables.map(async (table) => {
        if (!activeAccount(member))
          return {
            ...table,
            hasBaseAccess: false,
            actions: tableMatrixActions.map((action) => ({ action, allowed: false, sources: [] })),
            dataScope: null,
            diagnostics: identityDiagnostics(member, 0),
          };
        // Existing local grants survive directory departure/disablement. Compute the real
        // interactive account rights rather than pretending these events revoke membership.
        const preview = await this.preview.preview({
          baseId: base.id,
          tableId: table.id,
          email: member.user!.email,
        });
        const parsed = tableAuthorityPolicySchema.safeParse(base.authorityPolicy?.policy);
        const roleIds = new Set(preview.roles.map((role) => role.id));
        const hasRule =
          parsed.success &&
          parsed.data.enabled &&
          parsed.data.rules.some(
            (rule) =>
              rule.tableId === table.id && roleIds.has(rule.roleId) && rule.actions.length > 0
          );
        return {
          ...table,
          hasBaseAccess: preview.hasBaseAccess,
          actions: preview.actions,
          dataScope: preview.dataScope,
          diagnostics: [
            ...identityDiagnostics(member, selectedRoles.length),
            ...policyDiagnostics(base.authorityPolicy, member.connection.id),
            ...tableDiagnostics(preview, hasRule),
            ...(member.user!.isAdmin ? ['adminScopeExempt' as const] : []),
          ],
        };
      })
    );
    return { checkedAt: new Date().toISOString(), base: baseVo(base), total, tables: rows };
  }
}

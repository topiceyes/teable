import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute } from '../utils';
import { z } from '../zod';
import { tableAuthorityPreviewVoSchema } from './table-authority-policy';

export const MEMBER_AUTHORITY_OVERVIEW = '/authorityMatrix/memberOverview';
export const MEMBER_AUTHORITY_TABLES = '/authorityMatrix/memberTables';
export const memberAuthorityRoSchema = z
  .object({
    corpId: z.string().min(1).max(100),
    memberId: z.string().min(1).max(200),
    search: z.string().trim().max(200).optional(),
    skip: z.coerce.number().int().min(0).max(100000).default(0),
    take: z.coerce.number().int().min(1).max(20).default(10),
  })
  .strict();
export const memberAuthorityTablesRoSchema = memberAuthorityRoSchema
  .extend({
    baseId: z.string().min(1).max(200),
  })
  .strict();
export type IMemberAuthorityRo = z.infer<typeof memberAuthorityRoSchema>;
export type IMemberAuthorityTablesRo = z.infer<typeof memberAuthorityTablesRoSchema>;
export const memberAuthorityDiagnosticSchema = z.enum([
  'accountUnbound',
  'accountInactive',
  'employeeInactive',
  'connectionDisabled',
  'noEffectiveRole',
  'noBaseAccess',
  'policyMissing',
  'policyDisabled',
  'policyInvalid',
  'policyOtherEnterprise',
  'noTableRule',
  'collaboratorWrite',
  'matrixWrite',
  'ownRows',
  'departmentRows',
  'emptyDepartmentScope',
  'fieldRestrictions',
  'adminScopeExempt',
]);
export type IMemberAuthorityDiagnostic = z.infer<typeof memberAuthorityDiagnosticSchema>;
const diagnostics = z.array(memberAuthorityDiagnosticSchema);
const baseSchema = z.object({ id: z.string(), name: z.string().nullable(), spaceName: z.string() });
export const memberAuthorityOverviewVoSchema = z.object({
  checkedAt: z.string(),
  employee: z.object({
    id: z.string(),
    name: z.string(),
    active: z.boolean(),
    connectionEnabled: z.boolean(),
    account: z
      .object({
        id: z.string(),
        name: z.string(),
        email: z.string(),
        active: z.boolean(),
        isAdmin: z.boolean(),
      })
      .nullable(),
    departments: z.array(z.object({ id: z.string(), name: z.string() })),
    roles: z.array(z.object({ id: z.string(), name: z.string() })),
  }),
  diagnostics,
  total: z.number().int(),
  bases: z.array(
    baseSchema.extend({
      hasBaseAccess: z.boolean(),
      memberships: z.array(z.object({ resourceType: z.enum(['base', 'space']), role: z.string() })),
      policyState: z.enum(['missing', 'disabled', 'enabled', 'invalid']),
      diagnostics,
    })
  ),
});
export const memberAuthorityTablesVoSchema = z.object({
  checkedAt: z.string(),
  base: baseSchema,
  total: z.number().int(),
  tables: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      hasBaseAccess: z.boolean(),
      actions: tableAuthorityPreviewVoSchema.shape.actions,
      dataScope: tableAuthorityPreviewVoSchema.shape.dataScope,
      diagnostics,
    })
  ),
});
export type IMemberAuthorityOverviewVo = z.infer<typeof memberAuthorityOverviewVoSchema>;
export type IMemberAuthorityTablesVo = z.infer<typeof memberAuthorityTablesVoSchema>;
export const memberAuthorityOverviewRoute: RouteConfig = registerRoute({
  method: 'get',
  path: MEMBER_AUTHORITY_OVERVIEW,
  tags: ['organization'],
  request: { query: memberAuthorityRoSchema },
  responses: {
    200: {
      description: 'Read-only employee account and base access diagnostics',
      content: { 'application/json': { schema: memberAuthorityOverviewVoSchema } },
    },
  },
});
export const memberAuthorityTablesRoute: RouteConfig = registerRoute({
  method: 'get',
  path: MEMBER_AUTHORITY_TABLES,
  tags: ['organization'],
  request: { query: memberAuthorityTablesRoSchema },
  responses: {
    200: {
      description: 'Effective interactive table permissions for a bound employee',
      content: { 'application/json': { schema: memberAuthorityTablesVoSchema } },
    },
  },
});
export const getMemberAuthorityOverview = (ro: z.input<typeof memberAuthorityRoSchema>) =>
  axios.get<IMemberAuthorityOverviewVo>(MEMBER_AUTHORITY_OVERVIEW, { params: ro });
export const getMemberAuthorityTables = (ro: z.input<typeof memberAuthorityTablesRoSchema>) =>
  axios.get<IMemberAuthorityTablesVo>(MEMBER_AUTHORITY_TABLES, { params: ro });

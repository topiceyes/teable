import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute } from '../utils';
import { z } from '../zod';
import { directoryMemberVoSchema } from './directory-member';
import { directoryRoleVoSchema } from './directory-role';
import { directoryConnectionRoSchema } from './directory-sync';

export const directoryRoleToolRoSchema = directoryConnectionRoSchema
  .extend({ roleId: z.string().min(1).max(200) })
  .strict();
export const directoryRoleRosterRoSchema = directoryRoleToolRoSchema
  .extend({
    search: z.string().trim().max(200).optional(),
    departmentId: z.string().min(1).max(200).optional(),
    binding: z.enum(['all', 'bound', 'unbound']).default('all'),
    source: z.enum(['all', 'member', 'department', 'externalRole']).default('all'),
    scope: z.enum(['matched', 'all']).default('matched'),
    skip: z.coerce.number().int().min(0).max(100000).default(0),
    take: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();
export const directoryRoleRosterVoSchema = z.object({
  role: directoryRoleVoSchema,
  counts: z.object({
    effective: z.number().int(),
    unbound: z.number().int(),
    matched: z.number().int(),
  }),
  total: z.number().int(),
  members: z.array(
    directoryMemberVoSchema.extend({
      sources: z.array(z.enum(['member', 'department', 'externalRole'])),
      effective: z.boolean(),
    })
  ),
});
export const directorySetRolePeopleRoSchema = directoryRoleToolRoSchema
  .extend({
    expectedVersion: z.number().int().min(1),
    assigned: z.boolean(),
    memberIds: z
      .array(z.string().min(1).max(200))
      .min(1)
      .max(100)
      .refine((ids) => new Set(ids).size === ids.length, 'Duplicate employees'),
  })
  .strict();
export const directoryRoleHistoryRoSchema = directoryRoleToolRoSchema
  .extend({
    skip: z.coerce.number().int().min(0).max(100000).default(0),
    take: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();
export const directoryRoleHistoryVoSchema = z.object({
  total: z.number().int(),
  entries: z.array(
    z.object({
      id: z.string(),
      createdAt: z.string(),
      actor: z.object({ id: z.string().nullable(), name: z.string().nullable() }),
      before: directoryRoleVoSchema.nullable(),
      after: directoryRoleVoSchema,
    })
  ),
});
export const directoryChecksRoSchema = directoryConnectionRoSchema
  .extend({
    kind: z
      .enum([
        'all',
        'inactiveMember',
        'unboundMember',
        'inactiveAccount',
        'invalidDepartment',
        'missingMember',
        'invalidRules',
        'noBaseAccess',
      ])
      .default('all'),
    skip: z.coerce.number().int().min(0).max(100000).default(0),
    take: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();
export const directoryChecksVoSchema = z.object({
  checkedAt: z.string(),
  connectionEnabled: z.boolean(),
  total: z.number().int(),
  issues: z.array(
    z.object({
      kind: directoryChecksRoSchema.shape.kind.unwrap().exclude(['all']),
      roleId: z.string(),
      roleName: z.string(),
      memberId: z.string().optional(),
      memberName: z.string().optional(),
      departmentId: z.string().optional(),
      baseId: z.string().optional(),
      baseName: z.string().optional(),
      roleEnabled: z.boolean(),
    })
  ),
});
export type IDirectoryRoleRosterRo = z.infer<typeof directoryRoleRosterRoSchema>;
export type IDirectoryRoleRosterVo = z.infer<typeof directoryRoleRosterVoSchema>;
export type IDirectorySetRolePeopleRo = z.infer<typeof directorySetRolePeopleRoSchema>;
export type IDirectoryRoleHistoryRo = z.infer<typeof directoryRoleHistoryRoSchema>;
export type IDirectoryRoleHistoryVo = z.infer<typeof directoryRoleHistoryVoSchema>;
export type IDirectoryChecksRo = z.infer<typeof directoryChecksRoSchema>;
export type IDirectoryChecksVo = z.infer<typeof directoryChecksVoSchema>;
export const DIRECTORY_ROLE_ROSTER = '/admin/organization/dingtalk/roleRoster';
export const DIRECTORY_SET_ROLE_PEOPLE = '/admin/organization/dingtalk/setRolePeople';
export const DIRECTORY_ROLE_HISTORY = '/admin/organization/dingtalk/roleHistory';
export const DIRECTORY_ROLE_CHECKS = '/admin/organization/dingtalk/roleChecks';
export const directoryRoleRosterRoute: RouteConfig = registerRoute({
  method: 'get',
  path: DIRECTORY_ROLE_ROSTER,
  tags: ['organization'],
  request: { query: directoryRoleRosterRoSchema },
  responses: {
    200: {
      description: 'Filtered directory role roster and global role counts',
      content: { 'application/json': { schema: directoryRoleRosterVoSchema } },
    },
  },
});
export const directorySetRolePeopleRoute: RouteConfig = registerRoute({
  method: 'post',
  path: DIRECTORY_SET_ROLE_PEOPLE,
  tags: ['organization'],
  request: {
    body: { content: { 'application/json': { schema: directorySetRolePeopleRoSchema } } },
  },
  responses: {
    200: {
      description: 'Direct assignments changed together',
      content: { 'application/json': { schema: directoryRoleVoSchema } },
    },
  },
});
export const directoryRoleHistoryRoute: RouteConfig = registerRoute({
  method: 'get',
  path: DIRECTORY_ROLE_HISTORY,
  tags: ['organization'],
  request: { query: directoryRoleHistoryRoSchema },
  responses: {
    200: {
      description: 'Durable role snapshots from history enablement onward',
      content: { 'application/json': { schema: directoryRoleHistoryVoSchema } },
    },
  },
});
export const directoryRoleChecksRoute: RouteConfig = registerRoute({
  method: 'get',
  path: DIRECTORY_ROLE_CHECKS,
  tags: ['organization'],
  request: { query: directoryChecksRoSchema },
  responses: {
    200: {
      description: 'Read-only directory role configuration issues',
      content: { 'application/json': { schema: directoryChecksVoSchema } },
    },
  },
});
export const getDirectoryRoleRoster = (ro: z.input<typeof directoryRoleRosterRoSchema>) =>
  axios.get<IDirectoryRoleRosterVo>(DIRECTORY_ROLE_ROSTER, { params: ro });
export const setDirectoryRolePeople = (ro: IDirectorySetRolePeopleRo) =>
  axios.post<z.infer<typeof directoryRoleVoSchema>>(DIRECTORY_SET_ROLE_PEOPLE, ro);
export const getDirectoryRoleHistory = (ro: z.input<typeof directoryRoleHistoryRoSchema>) =>
  axios.get<IDirectoryRoleHistoryVo>(DIRECTORY_ROLE_HISTORY, { params: ro });
export const getDirectoryRoleChecks = (ro: z.input<typeof directoryChecksRoSchema>) =>
  axios.get<IDirectoryChecksVo>(DIRECTORY_ROLE_CHECKS, { params: ro });
export const DIRECTORY_ROLE_COUNTS = '/admin/organization/dingtalk/roleCounts';
export const directoryRoleCountsVoSchema = z.array(
  z.object({ roleId: z.string(), effective: z.number().int(), unbound: z.number().int() })
);
export const directoryRoleCountsRoute: RouteConfig = registerRoute({
  method: 'get',
  path: DIRECTORY_ROLE_COUNTS,
  tags: ['organization'],
  request: { query: directoryConnectionRoSchema },
  responses: {
    200: {
      description: 'Role membership counts',
      content: { 'application/json': { schema: directoryRoleCountsVoSchema } },
    },
  },
});
export const getDirectoryRoleCounts = (corpId: string) =>
  axios.get<z.infer<typeof directoryRoleCountsVoSchema>>(DIRECTORY_ROLE_COUNTS, {
    params: { corpId },
  });

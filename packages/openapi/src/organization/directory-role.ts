import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute } from '../utils';
import { z } from '../zod';
import { directoryConnectionRoSchema } from './directory-sync';

export const DIRECTORY_ROLES = '/admin/organization/dingtalk/listRoles';
export const DIRECTORY_SAVE_ROLE = '/admin/organization/dingtalk/saveRole';
export const DIRECTORY_ROLE_MEMBERS = '/admin/organization/dingtalk/roleMembers';
export const directoryRoleRuleSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('department'),
      departmentId: z.string().min(1),
      includeDescendants: z.boolean(),
    })
    .strict(),
  z
    .object({ type: z.literal('externalRole'), externalRoleId: z.string().trim().min(1).max(200) })
    .strict(),
]);
export const directoryRoleRulesSchema = z
  .array(directoryRoleRuleSchema)
  .max(100)
  .superRefine((rules, ctx) => {
    const seen = new Set<string>();
    rules.forEach((rule, index) => {
      const key =
        rule.type === 'department'
          ? `department:${rule.departmentId}`
          : `externalRole:${rule.externalRoleId}`;
      if (seen.has(key))
        ctx.addIssue({ code: 'custom', path: [index], message: 'Duplicate role rule' });
      seen.add(key);
    });
  });
export const directorySaveRoleRoSchema = directoryConnectionRoSchema
  .extend({
    roleId: z.string().min(1).optional(),
    expectedVersion: z.number().int().nonnegative(),
    name: z.string().trim().min(1).max(100),
    enabled: z.boolean(),
    rules: directoryRoleRulesSchema,
  })
  .strict()
  .superRefine((ro, ctx) => {
    if ((!ro.roleId && ro.expectedVersion !== 0) || (ro.roleId && ro.expectedVersion < 1)) {
      ctx.addIssue({ code: 'custom', path: ['expectedVersion'], message: 'Invalid role revision' });
    }
  });
export const directoryRoleVoSchema = z.object({
  id: z.string(),
  name: z.string(),
  enabled: z.boolean(),
  version: z.number().int(),
  rules: directoryRoleRulesSchema,
});
export const directoryRoleMembersRoSchema = directoryConnectionRoSchema
  .extend({
    roleId: z.string().min(1),
    skip: z.coerce.number().int().min(0).default(0),
    take: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();
export const directoryRoleMembersVoSchema = z.object({
  total: z.number().int(),
  members: z.array(
    z.object({
      memberId: z.string(),
      userId: z.string(),
      name: z.string(),
      email: z.string(),
    })
  ),
});
export type IDirectoryRoleRule = z.infer<typeof directoryRoleRuleSchema>;
export type IDirectorySaveRoleRo = z.infer<typeof directorySaveRoleRoSchema>;
export type IDirectoryRoleVo = z.infer<typeof directoryRoleVoSchema>;
export type IDirectoryRoleMembersRo = z.infer<typeof directoryRoleMembersRoSchema>;
export type IDirectoryRoleMembersVo = z.infer<typeof directoryRoleMembersVoSchema>;
export const listDirectoryRolesRoute: RouteConfig = registerRoute({
  method: 'get',
  path: DIRECTORY_ROLES,
  request: { query: directoryConnectionRoSchema },
  tags: ['organization'],
  responses: {
    200: {
      description: 'Business roles',
      content: { 'application/json': { schema: z.array(directoryRoleVoSchema) } },
    },
  },
});
export const saveDirectoryRoleRoute: RouteConfig = registerRoute({
  method: 'post',
  path: DIRECTORY_SAVE_ROLE,
  request: { body: { content: { 'application/json': { schema: directorySaveRoleRoSchema } } } },
  tags: ['organization'],
  responses: {
    200: {
      description: 'Business role saved',
      content: { 'application/json': { schema: directoryRoleVoSchema } },
    },
  },
});
export const getDirectoryRoleMembersRoute: RouteConfig = registerRoute({
  method: 'get',
  path: DIRECTORY_ROLE_MEMBERS,
  request: { query: directoryRoleMembersRoSchema },
  tags: ['organization'],
  responses: {
    200: {
      description: 'Effective linked members',
      content: { 'application/json': { schema: directoryRoleMembersVoSchema } },
    },
  },
});
export const listDirectoryRoles = (corpId: string) =>
  axios.get<IDirectoryRoleVo[]>(DIRECTORY_ROLES, { params: { corpId } });
export const saveDirectoryRole = (ro: IDirectorySaveRoleRo) =>
  axios.post<IDirectoryRoleVo>(DIRECTORY_SAVE_ROLE, ro);
export const getDirectoryRoleMembers = (ro: z.input<typeof directoryRoleMembersRoSchema>) =>
  axios.get<IDirectoryRoleMembersVo>(DIRECTORY_ROLE_MEMBERS, { params: ro });

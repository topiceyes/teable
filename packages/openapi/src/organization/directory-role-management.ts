import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute } from '../utils';
import { z } from '../zod';
import type { IDirectoryRoleVo } from './directory-role';
import { directoryRoleVoSchema, directorySaveRoleRoSchema } from './directory-role';
import { directoryConnectionRoSchema } from './directory-sync';

export const DIRECTORY_PREVIEW_ROLE = '/admin/organization/dingtalk/previewRole';
export const DIRECTORY_MEMBER_ROLES = '/admin/organization/dingtalk/memberRoles';
export const DIRECTORY_SAVE_MEMBER_ROLES = '/admin/organization/dingtalk/saveMemberRoles';
export const directoryPreviewRoleRoSchema = directorySaveRoleRoSchema.safeExtend({
  skip: z.number().int().min(0).max(100000).default(0),
  take: z.number().int().min(1).max(100).default(50),
});
export const directoryRoleChangeSchema = z.enum(['added', 'removed', 'retained', 'pending']);
export const directoryPreviewRoleVoSchema = z.object({
  before: z.number().int(),
  after: z.number().int(),
  counts: z.object({
    added: z.number(),
    removed: z.number(),
    retained: z.number(),
    pending: z.number(),
  }),
  total: z.number().int(),
  members: z.array(
    z.object({
      memberId: z.string(),
      name: z.string(),
      externalId: z.string(),
      change: directoryRoleChangeSchema,
    })
  ),
});
export const directoryMemberRolesRoSchema = directoryConnectionRoSchema
  .extend({
    memberId: z.string().min(1).max(200),
  })
  .strict();
export const directoryMemberRolesVoSchema = z.object({
  eligible: z.boolean(),
  roles: z.array(
    directoryRoleVoSchema.extend({
      sources: z.array(z.enum(['member', 'department', 'externalRole'])),
      effective: z.boolean(),
    })
  ),
});
export const directorySaveMemberRolesRoSchema = directoryMemberRolesRoSchema
  .extend({
    assignments: z
      .array(
        z
          .object({
            roleId: z.string().min(1).max(200),
            expectedVersion: z.number().int().min(1),
            assigned: z.boolean(),
          })
          .strict()
      )
      .min(1)
      .max(100)
      .superRefine((items, ctx) => {
        if (new Set(items.map((item) => item.roleId)).size !== items.length)
          ctx.addIssue({ code: 'custom', message: 'Duplicate role assignment' });
      }),
  })
  .strict();
export type IDirectoryPreviewRoleRo = z.infer<typeof directoryPreviewRoleRoSchema>;
export type IDirectoryPreviewRoleVo = z.infer<typeof directoryPreviewRoleVoSchema>;
export type IDirectoryMemberRolesRo = z.infer<typeof directoryMemberRolesRoSchema>;
export type IDirectoryMemberRolesVo = z.infer<typeof directoryMemberRolesVoSchema>;
export type IDirectorySaveMemberRolesRo = z.infer<typeof directorySaveMemberRolesRoSchema>;

export const previewDirectoryRoleRoute: RouteConfig = registerRoute({
  method: 'post',
  path: DIRECTORY_PREVIEW_ROLE,
  tags: ['organization'],
  request: { body: { content: { 'application/json': { schema: directoryPreviewRoleRoSchema } } } },
  responses: {
    200: {
      description: 'Draft role membership changes; no permissions are changed',
      content: { 'application/json': { schema: directoryPreviewRoleVoSchema } },
    },
  },
});
export const getDirectoryMemberRolesRoute: RouteConfig = registerRoute({
  method: 'get',
  path: DIRECTORY_MEMBER_ROLES,
  tags: ['organization'],
  request: { query: directoryMemberRolesRoSchema },
  responses: {
    200: {
      description: 'Employee role sources and effective membership',
      content: { 'application/json': { schema: directoryMemberRolesVoSchema } },
    },
  },
});
export const saveDirectoryMemberRolesRoute: RouteConfig = registerRoute({
  method: 'post',
  path: DIRECTORY_SAVE_MEMBER_ROLES,
  tags: ['organization'],
  request: {
    body: { content: { 'application/json': { schema: directorySaveMemberRolesRoSchema } } },
  },
  responses: {
    200: {
      description: 'Direct assignments saved atomically',
      content: { 'application/json': { schema: z.array(directoryRoleVoSchema) } },
    },
  },
});
export const previewDirectoryRole = (ro: z.input<typeof directoryPreviewRoleRoSchema>) =>
  axios.post<IDirectoryPreviewRoleVo>(DIRECTORY_PREVIEW_ROLE, ro);
export const getDirectoryMemberRoles = (ro: IDirectoryMemberRolesRo) =>
  axios.get<IDirectoryMemberRolesVo>(DIRECTORY_MEMBER_ROLES, { params: ro });
export const saveDirectoryMemberRoles = (ro: IDirectorySaveMemberRolesRo) =>
  axios.post<IDirectoryRoleVo[]>(DIRECTORY_SAVE_MEMBER_ROLES, ro);

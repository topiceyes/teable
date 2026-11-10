import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute } from '../utils';
import { z } from '../zod';
import { getDepartmentListVoSchema, type IGetDepartmentListVo } from './departments';
import { directoryConnectionRoSchema } from './directory-sync';

export const DIRECTORY_MEMBERS = '/admin/organization/dingtalk/listMembers';
export const DIRECTORY_BIND_MEMBER = '/admin/organization/dingtalk/bindMember';
export const directoryMembersRoSchema = directoryConnectionRoSchema
  .extend({
    search: z.string().trim().max(200).optional(),
    skip: z.coerce.number().int().min(0).default(0),
    take: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();
export const directoryBindMemberRoSchema = directoryConnectionRoSchema
  .extend({
    memberId: z.string().min(1),
    userId: z.string().min(1).nullable(),
    // Required compare-and-set value. Existing links must be explicitly unbound first.
    expectedUserId: z.string().min(1).nullable(),
  })
  .strict();
export const directoryMemberVoSchema = z.object({
  id: z.string(),
  externalId: z.string(),
  name: z.string(),
  email: z.string().nullable(),
  active: z.boolean(),
  userId: z.string().nullable(),
  user: z.object({ id: z.string(), name: z.string(), email: z.string() }).nullable(),
  departments: z.array(z.object({ id: z.string(), name: z.string() })),
  externalRoleIds: z.array(z.string()),
});
export const directoryMembersVoSchema = z.object({
  members: z.array(directoryMemberVoSchema),
  total: z.number().int(),
});
export type IDirectoryMembersRo = z.infer<typeof directoryMembersRoSchema>;
export type IDirectoryBindMemberRo = z.infer<typeof directoryBindMemberRoSchema>;
export type IDirectoryMemberVo = z.infer<typeof directoryMemberVoSchema>;
export type IDirectoryMembersVo = z.infer<typeof directoryMembersVoSchema>;
export const listDirectoryMembersRoute: RouteConfig = registerRoute({
  method: 'get',
  path: DIRECTORY_MEMBERS,
  tags: ['organization'],
  request: { query: directoryMembersRoSchema },
  responses: {
    200: {
      description: 'Synchronized employees and local account links',
      content: { 'application/json': { schema: directoryMembersVoSchema } },
    },
  },
});
export const bindDirectoryMemberRoute: RouteConfig = registerRoute({
  method: 'post',
  path: DIRECTORY_BIND_MEMBER,
  tags: ['organization'],
  request: { body: { content: { 'application/json': { schema: directoryBindMemberRoSchema } } } },
  responses: {
    200: {
      description: 'Binding updated',
      content: {
        'application/json': {
          schema: z.object({ memberId: z.string(), userId: z.string().nullable() }),
        },
      },
    },
  },
});
export const listDirectoryMembers = (ro: z.input<typeof directoryMembersRoSchema>) =>
  axios.get<IDirectoryMembersVo>(DIRECTORY_MEMBERS, { params: ro });
export const bindDirectoryMember = (ro: IDirectoryBindMemberRo) =>
  axios.post<{ memberId: string; userId: string | null }>(DIRECTORY_BIND_MEMBER, ro);

export const DIRECTORY_DEPARTMENTS = '/admin/organization/dingtalk/listDepartments';
export const DIRECTORY_ACCOUNTS = '/admin/organization/dingtalk/searchAccounts';
export const directoryAccountSearchRoSchema = directoryConnectionRoSchema
  .extend({
    search: z.string().trim().min(2).max(200),
  })
  .strict();
export type IDirectoryAccountSearchRo = z.infer<typeof directoryAccountSearchRoSchema>;
export const directoryAccountVoSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
});
export type IDirectoryAccountVo = z.infer<typeof directoryAccountVoSchema>;
export const searchDirectoryAccountsRoute: RouteConfig = registerRoute({
  method: 'get',
  path: DIRECTORY_ACCOUNTS,
  tags: ['organization'],
  request: { query: directoryAccountSearchRoSchema },
  responses: {
    200: {
      description: 'Active local accounts available for binding',
      content: { 'application/json': { schema: z.array(directoryAccountVoSchema) } },
    },
  },
});
export const searchDirectoryAccounts = (ro: IDirectoryAccountSearchRo) =>
  axios.get<IDirectoryAccountVo[]>(DIRECTORY_ACCOUNTS, { params: ro });

export const listDirectoryDepartmentsRoute: RouteConfig = registerRoute({
  method: 'get',
  path: DIRECTORY_DEPARTMENTS,
  tags: ['organization'],
  request: { query: directoryConnectionRoSchema },
  responses: {
    200: {
      description: 'Active departments for administrator browsing',
      content: { 'application/json': { schema: getDepartmentListVoSchema } },
    },
  },
});
export const listDirectoryDepartments = (ro: { corpId: string }) =>
  axios.get<IGetDepartmentListVo>(DIRECTORY_DEPARTMENTS, { params: ro });

import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute } from '../utils';
import { z } from '../zod';

export const DIRECTORY_CONNECTIONS = '/admin/organization/dingtalk/connections';
export const DIRECTORY_PREVIEW = '/admin/organization/dingtalk/preview';
export const DIRECTORY_SYNC = '/admin/organization/dingtalk/sync';
export const DIRECTORY_SYNC_RUNS = '/admin/organization/dingtalk/runs';
export const DIRECTORY_SAVE_CONNECTION = '/admin/organization/dingtalk/saveConnection';
export const DIRECTORY_TEST_CONNECTION = '/admin/organization/dingtalk/testConnection';

export const directoryConnectionRoSchema = z.object({ corpId: z.string().trim().min(1) }).strict();
export const directorySyncRoSchema = directoryConnectionRoSchema
  .extend({
    previewToken: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type IDirectoryConnectionRo = z.infer<typeof directoryConnectionRoSchema>;
export type IDirectorySyncRo = z.infer<typeof directorySyncRoSchema>;

export const directorySaveConnectionRoSchema = z
  .object({
    corpId: z.string().trim().min(1).max(100),
    name: z.string().trim().min(1).max(100),
    appKey: z.string().trim().min(1).max(256),
    appSecret: z
      .string()
      .trim()
      .min(1)
      .max(2048)
      .refine((value) => !value.startsWith('teable_enc_v1:'), 'Enter a new application secret')
      .optional(),
    expectedVersion: z.number().int().nonnegative(),
  })
  .strict();
export type IDirectorySaveConnectionRo = z.infer<typeof directorySaveConnectionRoSchema>;

export const directoryConnectionVoSchema = z.object({
  corpId: z.string(),
  name: z.string(),
  provider: z.literal('dingtalk'),
  source: z.enum(['environment', 'database']),
  appKey: z.string(),
  hasSecret: z.boolean(),
  version: z.number().int().nonnegative(),
});
export const directoryTestConnectionVoSchema = z.object({
  connected: z.literal(true),
  departmentName: z.string(),
});
export type IDirectoryTestConnectionVo = z.infer<typeof directoryTestConnectionVoSchema>;
const departmentChangeSchema = z.object({
  externalId: z.string(),
  name: z.string(),
  parentExternalId: z.string().nullable(),
});
const memberChangeSchema = z.object({
  externalId: z.string(),
  name: z.string(),
  active: z.boolean(),
  unionId: z.string().nullable(),
  email: z.string().nullable(),
  departmentExternalIds: z.array(z.string()),
  externalRoleIds: z.array(z.string()),
});
const changesSchema = <T extends z.ZodType>(schema: T) =>
  z.object({
    added: z.array(schema),
    updated: z.array(schema),
    deactivated: z.array(schema),
  });
export const directorySyncPreviewVoSchema = z.object({
  previewToken: z.string(),
  changes: z.object({
    departments: changesSchema(departmentChangeSchema),
    members: changesSchema(memberChangeSchema),
  }),
});
export const directorySyncRunVoSchema = z.object({
  id: z.string(),
  connectionId: z.string(),
  status: z.string(),
  startedTime: z.string(),
  finishedTime: z.string().nullable(),
  departmentCount: z.number().int(),
  memberCount: z.number().int(),
  errorCode: z.string().nullable(),
});
export type IDirectoryConnectionVo = z.infer<typeof directoryConnectionVoSchema>;
export type IDirectorySyncPreviewVo = z.infer<typeof directorySyncPreviewVoSchema>;
export type IDirectorySyncRunVo = z.infer<typeof directorySyncRunVoSchema>;

const success = (schema: z.ZodType) => ({
  200: {
    description: 'Directory operation completed',
    content: { 'application/json': { schema } },
  },
});
export const getDirectoryConnectionsRoute: RouteConfig = registerRoute({
  method: 'get',
  path: DIRECTORY_CONNECTIONS,
  tags: ['organization'],
  responses: success(z.array(directoryConnectionVoSchema)),
});
export const previewDirectorySyncRoute: RouteConfig = registerRoute({
  method: 'post',
  path: DIRECTORY_PREVIEW,
  tags: ['organization'],
  request: { body: { content: { 'application/json': { schema: directoryConnectionRoSchema } } } },
  responses: success(directorySyncPreviewVoSchema),
});
export const syncDirectoryRoute: RouteConfig = registerRoute({
  method: 'post',
  path: DIRECTORY_SYNC,
  tags: ['organization'],
  request: { body: { content: { 'application/json': { schema: directorySyncRoSchema } } } },
  responses: success(directorySyncRunVoSchema),
});
export const getDirectorySyncRunsRoute: RouteConfig = registerRoute({
  method: 'get',
  path: DIRECTORY_SYNC_RUNS,
  tags: ['organization'],
  request: { query: directoryConnectionRoSchema },
  responses: success(z.array(directorySyncRunVoSchema)),
});
export const saveDirectoryConnectionRoute: RouteConfig = registerRoute({
  method: 'post',
  path: DIRECTORY_SAVE_CONNECTION,
  tags: ['organization'],
  request: {
    body: { content: { 'application/json': { schema: directorySaveConnectionRoSchema } } },
  },
  responses: success(directoryConnectionVoSchema),
});
export const testDirectoryConnectionRoute: RouteConfig = registerRoute({
  method: 'post',
  path: DIRECTORY_TEST_CONNECTION,
  tags: ['organization'],
  request: {
    body: { content: { 'application/json': { schema: directorySaveConnectionRoSchema } } },
  },
  responses: success(directoryTestConnectionVoSchema),
});
export const saveDirectoryConnection = (ro: IDirectorySaveConnectionRo) =>
  axios.post<IDirectoryConnectionVo>(DIRECTORY_SAVE_CONNECTION, ro);
export const testDirectoryConnection = (ro: IDirectorySaveConnectionRo) =>
  axios.post<IDirectoryTestConnectionVo>(DIRECTORY_TEST_CONNECTION, ro);
export const getDirectoryConnections = () =>
  axios.get<IDirectoryConnectionVo[]>(DIRECTORY_CONNECTIONS);
export const previewDirectorySync = (ro: IDirectoryConnectionRo) =>
  axios.post<IDirectorySyncPreviewVo>(DIRECTORY_PREVIEW, ro);
export const syncDirectory = (ro: IDirectorySyncRo) =>
  axios.post<IDirectorySyncRunVo>(DIRECTORY_SYNC, ro);
export const getDirectorySyncRuns = (ro: IDirectoryConnectionRo) =>
  axios.get<IDirectorySyncRunVo[]>(DIRECTORY_SYNC_RUNS, { params: ro });

import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute } from '../utils';
import { z } from '../zod';

export const TABLE_AUTHORITY_GET = '/authorityMatrix/get';
export const TABLE_AUTHORITY_SAVE = '/authorityMatrix/save';
export const TABLE_AUTHORITY_PREVIEW = '/authorityMatrix/preview';
export const tableAuthorityPreviewRoSchema = z
  .object({
    baseId: z.string().min(1),
    tableId: z.string().min(1),
    email: z.string().trim().toLowerCase().email(),
  })
  .strict();
export type ITableAuthorityPreviewRo = z.infer<typeof tableAuthorityPreviewRoSchema>;
export const tableAuthorityPreviewVoSchema = z.object({
  user: z.object({ id: z.string(), name: z.string(), email: z.string() }),
  hasBaseAccess: z.boolean(),
  roles: z.array(z.object({ id: z.string(), name: z.string() })),
  actions: z.array(
    z.object({
      action: z.string(),
      allowed: z.boolean(),
      sources: z.array(z.enum(['collaborator', 'matrix'])),
    })
  ),
  note: z.string(),
  dataScope: z
    .object({
      rowScope: z.enum(['all', 'own', 'department']),
      hiddenFields: z.array(z.string()),
      readOnlyFields: z.array(z.string()),
    })
    .nullable(),
});
export type ITableAuthorityPreviewVo = z.infer<typeof tableAuthorityPreviewVoSchema>;
export const previewTableAuthorityRoute: RouteConfig = registerRoute({
  method: 'get',
  path: TABLE_AUTHORITY_PREVIEW,
  tags: ['organization'],
  request: { query: tableAuthorityPreviewRoSchema },
  responses: {
    200: {
      description: 'Effective interactive user permissions',
      content: { 'application/json': { schema: tableAuthorityPreviewVoSchema } },
    },
  },
});
export const previewTableAuthority = (ro: ITableAuthorityPreviewRo) =>
  axios.get<ITableAuthorityPreviewVo>(TABLE_AUTHORITY_PREVIEW, { params: ro });
export const tableMatrixActions = [
  'table|read',
  'record|read',
  'record|create',
  'record|update',
  'record|delete',
] as const;
export const tableDataRestrictionSchema = z
  .object({
    tableId: z.string().min(1),
    hiddenFieldIds: z.array(z.string().min(1)).max(1000),
    readOnlyFieldIds: z.array(z.string().min(1)).max(1000),
    rowScope: z.enum(['all', 'own', 'department']),
  })
  .strict();
export type ITableDataRestriction = z.infer<typeof tableDataRestrictionSchema>;
export const tableAuthorityPolicySchema = z
  .object({
    version: z.literal(1),
    enabled: z.boolean(),
    rules: z
      .array(
        z
          .object({
            roleId: z.string().min(1),
            tableId: z.string().min(1),
            actions: z.array(z.enum(tableMatrixActions)).max(tableMatrixActions.length),
          })
          .strict()
      )
      .max(1000),
    restrictions: z.array(tableDataRestrictionSchema).max(1000).optional(),
  })
  .strict()
  .superRefine((policy, ctx) => {
    const tables = new Set<string>();
    for (const [index, restriction] of (policy.restrictions || []).entries()) {
      if (tables.has(restriction.tableId))
        ctx.addIssue({
          code: 'custom',
          path: ['restrictions', index],
          message: 'Duplicate table restriction',
        });
      tables.add(restriction.tableId);
      for (const values of [restriction.hiddenFieldIds, restriction.readOnlyFieldIds]) {
        if (new Set(values).size !== values.length)
          ctx.addIssue({
            code: 'custom',
            path: ['restrictions', index],
            message: 'Duplicate field restriction',
          });
      }
    }
    const keys = new Set<string>();
    policy.rules.forEach((rule, index) => {
      const key = JSON.stringify([rule.roleId, rule.tableId]);
      if (keys.has(key))
        ctx.addIssue({
          code: 'custom',
          path: ['rules', index],
          message: 'Duplicate table role rule',
        });
      keys.add(key);
      if (new Set(rule.actions).size !== rule.actions.length)
        ctx.addIssue({
          code: 'custom',
          path: ['rules', index, 'actions'],
          message: 'Duplicate action',
        });
      if (
        rule.actions.length &&
        (!rule.actions.includes('table|read') || !rule.actions.includes('record|read'))
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['rules', index, 'actions'],
          message: 'Table and record read are required for grants',
        });
      }
    });
  });
export const tableAuthorityGetRoSchema = z.object({ baseId: z.string().min(1) }).strict();
export const tableAuthoritySaveRoSchema = tableAuthorityGetRoSchema
  .extend({
    connectionId: z.string().min(1),
    expectedRevision: z.number().int().nonnegative(),
    policy: tableAuthorityPolicySchema,
  })
  .strict();
export const tableAuthorityVoSchema = z.object({
  baseId: z.string(),
  connectionId: z.string().nullable(),
  revision: z.number().int(),
  policy: tableAuthorityPolicySchema,
});
export type ITableAuthorityGetRo = z.infer<typeof tableAuthorityGetRoSchema>;
export type ITableAuthoritySaveRo = z.infer<typeof tableAuthoritySaveRoSchema>;
export type ITableAuthorityVo = z.infer<typeof tableAuthorityVoSchema>;
export type ITableAuthorityPolicy = z.infer<typeof tableAuthorityPolicySchema>;
export const getTableAuthorityPolicyRoute: RouteConfig = registerRoute({
  method: 'get',
  path: TABLE_AUTHORITY_GET,
  request: { query: tableAuthorityGetRoSchema },
  tags: ['organization'],
  responses: {
    200: {
      description: 'Table authority policy',
      content: { 'application/json': { schema: tableAuthorityVoSchema } },
    },
  },
});
export const saveTableAuthorityPolicyRoute: RouteConfig = registerRoute({
  method: 'post',
  path: TABLE_AUTHORITY_SAVE,
  request: { body: { content: { 'application/json': { schema: tableAuthoritySaveRoSchema } } } },
  tags: ['organization'],
  responses: {
    200: {
      description: 'Saved authority policy',
      content: { 'application/json': { schema: tableAuthorityVoSchema } },
    },
  },
});
export const getTableAuthorityPolicy = (baseId: string) =>
  axios.get<ITableAuthorityVo>(TABLE_AUTHORITY_GET, { params: { baseId } });
export const saveTableAuthorityPolicy = (ro: ITableAuthoritySaveRo) =>
  axios.post<ITableAuthorityVo>(TABLE_AUTHORITY_SAVE, ro);

export const TABLE_AUTHORITY_OPTIONS = '/authorityMatrix/options';
export const tableAuthorityOptionsVoSchema = z.object({
  connections: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      corpId: z.string(),
      roles: z.array(z.object({ id: z.string(), name: z.string() })),
    })
  ),
  tables: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      fields: z
        .array(
          z.object({
            id: z.string(),
            name: z.string(),
            type: z.string(),
            isPrimary: z.boolean().nullable(),
          })
        )
        .optional(),
    })
  ),
});
export type ITableAuthorityOptionsVo = z.infer<typeof tableAuthorityOptionsVoSchema>;
export const getTableAuthorityOptionsRoute: RouteConfig = registerRoute({
  method: 'get',
  path: TABLE_AUTHORITY_OPTIONS,
  request: { query: tableAuthorityGetRoSchema },
  tags: ['organization'],
  responses: {
    200: {
      description: 'Available matrix roles and tables',
      content: { 'application/json': { schema: tableAuthorityOptionsVoSchema } },
    },
  },
});
export const getTableAuthorityOptions = (baseId: string) =>
  axios.get<ITableAuthorityOptionsVo>(TABLE_AUTHORITY_OPTIONS, { params: { baseId } });

import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute } from '../utils';
import { z } from '../zod';
import { organizationQueryRoSchema } from './get-me';

export const GET_DEPARTMENT_USER = '/organization/department-user';

export const getDepartmentUserRoSchema = organizationQueryRoSchema.extend({
  departmentId: z.string().min(1).optional(),
  includeChildrenDepartment: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional()
    .meta({ type: 'string' }),
  skip: z.string().or(z.number()).transform(Number).pipe(z.number().int().min(0)).optional().meta({
    example: 0,
  }),
  take: z
    .string()
    .or(z.number())
    .transform(Number)
    .pipe(z.number().int().min(1).max(100))
    .optional()
    .meta({
      example: 50,
    }),
  search: z.string().trim().max(200).optional(),
});

export type IGetDepartmentUserRo = z.infer<typeof getDepartmentUserRoSchema>;

export const getDepartmentUserItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  avatar: z.string().optional(),
  departments: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        path: z.array(z.string()).optional(),
        pathName: z.array(z.string()).optional(),
      })
    )
    .optional(),
});

export type IGetDepartmentUserItem = z.infer<typeof getDepartmentUserItemSchema>;

export const getDepartmentUserVoSchema = z.object({
  users: z.array(getDepartmentUserItemSchema),
  total: z.number(),
});

export type IGetDepartmentUserVo = z.infer<typeof getDepartmentUserVoSchema>;

export const getDepartmentUsersRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_DEPARTMENT_USER,
  request: {
    query: getDepartmentUserRoSchema,
  },
  responses: {
    200: {
      description: 'Get department users successfully',
      content: { 'application/json': { schema: getDepartmentUserVoSchema } },
    },
  },
  tags: ['organization'],
});

export const getDepartmentUsers = (ro?: IGetDepartmentUserRo) => {
  return axios.get<IGetDepartmentUserVo>(GET_DEPARTMENT_USER, {
    params: ro,
  });
};

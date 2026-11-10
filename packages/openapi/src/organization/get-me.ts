import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute } from '../utils';
import { z } from '../zod';

export const GET_ORGANIZATION_ME = '/organization/me';

export const organizationQueryRoSchema = z.object({
  organizationId: z.string().min(1).optional(),
});
export type IOrganizationQueryRo = z.infer<typeof organizationQueryRoSchema>;

export const organizationVoSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    isAdmin: z.boolean(),
  })
  .nullable()
  .optional();

export type IOrganizationMeVo = z.infer<typeof organizationVoSchema>;

export const getOrganizationMeRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_ORGANIZATION_ME,
  description: 'Get my organization',
  request: { query: organizationQueryRoSchema },
  responses: {
    200: {
      description: 'Get my organization successfully',
      content: {
        'application/json': {
          schema: organizationVoSchema,
        },
      },
    },
  },
  tags: ['organization'],
});

export const getOrganizationMe = (ro?: IOrganizationQueryRo) => {
  return axios.get<IOrganizationMeVo>(GET_ORGANIZATION_ME, { params: ro });
};

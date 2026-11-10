import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute } from '../utils';
import { z } from '../zod';

export const DINGTALK_PROVIDERS = '/auth/dingtalk/providers';
export const DINGTALK_START = '/auth/dingtalk/start';
export const DINGTALK_BIND = '/auth/dingtalk/bind';
export const DINGTALK_CALLBACK = '/auth/dingtalk/callback';
export const dingtalkProvidersVoSchema = z.array(
  z.object({ corpId: z.string(), name: z.string() })
);
export type IDingtalkProvidersVo = z.infer<typeof dingtalkProvidersVoSchema>;
export const dingtalkStartRoSchema = z.object({
  corpId: z.string().trim().min(1).max(100),
  redirect: z.string().max(2048).optional(),
});
export type IDingtalkStartRo = z.infer<typeof dingtalkStartRoSchema>;
export const dingtalkCallbackRoSchema = z.object({
  state: z.string().regex(/^[a-f0-9]{64}$/),
  authCode: z.string().min(1).max(2048),
});
export const dingtalkProvidersRoute: RouteConfig = registerRoute({
  method: 'get',
  path: DINGTALK_PROVIDERS,
  tags: ['auth'],
  responses: {
    200: {
      description: 'Enabled enterprise sign-in options, without credentials',
      content: { 'application/json': { schema: dingtalkProvidersVoSchema } },
    },
  },
});
export const getDingtalkProviders = () => axios.get<IDingtalkProvidersVo>(DINGTALK_PROVIDERS);
export const startDingtalkBinding = (ro: IDingtalkStartRo) =>
  axios.post<{ url: string }>(DINGTALK_BIND, ro);

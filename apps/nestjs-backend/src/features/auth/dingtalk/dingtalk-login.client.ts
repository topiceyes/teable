/* eslint-disable @typescript-eslint/naming-convention -- DingTalk wire headers and Prisma compound selectors. */
import { BadGatewayException, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { safeFetch } from '../../../utils/ssrf-http';
import type { IDingtalkDirectoryConfig } from '../../organization/directory/dingtalk-directory.config';

export interface IDingtalkLoginIdentity {
  externalId: string;
  unionId: string;
  name: string;
  email?: string;
}

/** Identity must be verified both by the personal OAuth grant and the enterprise API. */
@Injectable()
export class DingtalkLoginClient {
  private async request(path: string, body?: object, token?: string, legacy = false) {
    const url = new URL(path, legacy ? 'https://oapi.dingtalk.com' : 'https://api.dingtalk.com');
    if (legacy && token) url.searchParams.set('access_token', token);
    const response = await safeFetch(url.href, {
      method: body ? 'POST' : 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(!legacy && token ? { 'x-acs-dingtalk-access-token': token } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(15000),
      redirect: 'error',
    });
    if (!response.ok) throw new Error('upstream');
    const data: unknown = await response.json();
    if (!legacy) return data;
    const result = z.object({ errcode: z.literal(0), result: z.unknown() }).parse(data);
    return result.result;
  }

  async identity(config: IDingtalkDirectoryConfig, code: string): Promise<IDingtalkLoginIdentity> {
    try {
      const personal = z.object({ accessToken: z.string().min(1) }).parse(
        await this.request('/v1.0/oauth2/userAccessToken', {
          clientId: config.appKey,
          clientSecret: config.appSecret,
          code,
          grantType: 'authorization_code',
        })
      );
      const profile = z
        .object({ unionId: z.string().min(1) })
        .parse(await this.request('/v1.0/contact/users/me', undefined, personal.accessToken));
      const app = z.object({ accessToken: z.string().min(1) }).parse(
        await this.request('/v1.0/oauth2/accessToken', {
          appKey: config.appKey,
          appSecret: config.appSecret,
        })
      );
      const employee = z
        .object({ userid: z.string().min(1) })
        .parse(
          await this.request(
            '/topapi/user/getbyunionid',
            { unionid: profile.unionId },
            app.accessToken,
            true
          )
        );
      const detail = z
        .object({
          userid: z.literal(employee.userid),
          unionid: z.literal(profile.unionId),
          name: z.string().min(1),
          email: z.string().optional(),
          active: z.boolean().optional(),
        })
        .parse(
          await this.request(
            '/topapi/v2/user/get',
            { userid: employee.userid },
            app.accessToken,
            true
          )
        );
      if (detail.active === false) throw new Error('inactive');
      return {
        externalId: detail.userid,
        unionId: detail.unionid,
        name: detail.name,
        email: detail.email,
      };
    } catch {
      // Never pass through transport bodies, tokens, authorization codes or secrets.
      throw new BadGatewayException('DINGTALK_IDENTITY_FAILED');
    }
  }
}

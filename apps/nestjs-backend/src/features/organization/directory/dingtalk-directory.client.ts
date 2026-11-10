import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { safeFetch } from '../../../utils/ssrf-http';
import type { IDingtalkDirectoryConfig } from './dingtalk-directory.config';
import { directorySnapshotSchema, type IDirectorySnapshot } from './directory-snapshot';

const id = z
  .union([z.number().int().positive().max(Number.MAX_SAFE_INTEGER), z.string().regex(/^[1-9]\d*$/)])
  .transform(String);
const departmentSchema = z.object({ dept_id: id, name: z.string().min(1), parent_id: id });
const userSchema = z.object({
  userid: z.string().min(1),
  name: z.string().min(1),
  unionid: z.string().optional(),
  email: z.string().optional(),
  dept_id_list: z.array(id).min(1),
});
const pageLimit = 10000;

export class DingtalkDirectoryError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

/** Fixed provider origin; transport errors and upstream bodies never leave this adapter. */
@Injectable()
export class DingtalkDirectoryClient {
  async testConnection(config: IDingtalkDirectoryConfig) {
    try {
      const token = await this.accessToken(config);
      const response = await this.request('/topapi/v2/department/get', token, { dept_id: 1 });
      const root = z.object({ dept_id: id, name: z.string().min(1) }).parse(response.result);
      if (root.dept_id !== '1') throw new DingtalkDirectoryError('DINGTALK_INVALID_ROOT');
      return { connected: true as const, departmentName: root.name };
    } catch (error) {
      if (error instanceof DingtalkDirectoryError) throw error;
      throw new DingtalkDirectoryError('DINGTALK_INVALID_RESPONSE');
    }
  }

  async fetchSnapshot(config: IDingtalkDirectoryConfig): Promise<IDirectorySnapshot> {
    try {
      return await this.fetchCompleteSnapshot(config);
    } catch (error) {
      if (error instanceof DingtalkDirectoryError) throw error;
      throw new DingtalkDirectoryError('DINGTALK_INVALID_RESPONSE');
    }
  }

  private async request(
    path: string,
    token?: string,
    body?: object
  ): Promise<Record<string, unknown>> {
    const origin =
      path === '/v1.0/oauth2/accessToken'
        ? 'https://api.dingtalk.com'
        : 'https://oapi.dingtalk.com';
    const url = new URL(`${origin}${path}`);
    if (token) url.searchParams.set('access_token', token);
    try {
      const response = await safeFetch(url.href, {
        method: 'POST',
        headers: { ['content-type']: 'application/json' },
        body: JSON.stringify(body || {}),
        signal: AbortSignal.timeout(15000),
        redirect: 'error',
      });
      if (!response.ok) throw new DingtalkDirectoryError('DINGTALK_HTTP_ERROR');
      const raw: unknown = await response.json();
      if (path === '/v1.0/oauth2/accessToken') {
        return z.object({ accessToken: z.string().min(1) }).parse(raw);
      }
      const data = z
        .object({ errcode: z.number().int(), result: z.unknown().optional() })
        .passthrough()
        .parse(raw);
      if (data.errcode !== 0) throw new DingtalkDirectoryError(`DINGTALK_API_${data.errcode}`);
      return data;
    } catch (error) {
      if (error instanceof DingtalkDirectoryError) throw error;
      throw new DingtalkDirectoryError('DINGTALK_TRANSPORT_ERROR');
    }
  }

  private async accessToken(config: IDingtalkDirectoryConfig) {
    const tokenResponse = await this.request('/v1.0/oauth2/accessToken', undefined, {
      appKey: config.appKey,
      appSecret: config.appSecret,
    });
    return z.object({ accessToken: z.string().min(1) }).parse(tokenResponse).accessToken;
  }

  private async fetchCompleteSnapshot(config: IDingtalkDirectoryConfig) {
    const token = await this.accessToken(config);
    let requestCount = 0;
    const deadline = Date.now() + 10 * 60 * 1000;
    const call: ICall = async (path, body) => {
      if (++requestCount > pageLimit || Date.now() > deadline) {
        throw new DingtalkDirectoryError('DINGTALK_DIRECTORY_LIMIT');
      }
      return (await this.request(path, token, body)).result;
    };
    const departments = await this.departments(call);
    const members: IMembers = new Map();
    for (const department of departments) {
      await this.departmentMembers(call, department.externalId, members);
    }
    await this.roles(call, members);
    return directorySnapshotSchema.parse({
      complete: true,
      departments,
      members: [...members.values()],
    });
  }

  private async departments(call: ICall) {
    const root = z
      .object({ dept_id: id, name: z.string().min(1) })
      .parse(await call('/topapi/v2/department/get', { dept_id: 1 }));
    if (root.dept_id !== '1') throw new DingtalkDirectoryError('DINGTALK_INVALID_ROOT');
    const departments: IDirectorySnapshot['departments'] = [
      { externalId: '1', parentExternalId: null, name: root.name },
    ];
    const departmentIds = new Set(['1']);
    for (let index = 0; index < departments.length; index++) {
      if (index >= pageLimit) throw new DingtalkDirectoryError('DINGTALK_DIRECTORY_LIMIT');
      const departmentId = departments[index].externalId;
      const children = z
        .array(departmentSchema)
        .parse(await call('/topapi/v2/department/listsub', { dept_id: departmentId }));
      for (const child of children) {
        if (departmentIds.has(child.dept_id) || child.parent_id !== departmentId) {
          throw new DingtalkDirectoryError('DINGTALK_INCONSISTENT_HIERARCHY');
        }
        departmentIds.add(child.dept_id);
        departments.push({
          externalId: child.dept_id,
          parentExternalId: departmentId,
          name: child.name,
        });
      }
    }
    return departments;
  }

  private mergeMember(user: z.infer<typeof userSchema>, departmentId: string, members: IMembers) {
    const normalized = {
      externalId: user.userid,
      name: user.name,
      unionId: user.unionid || undefined,
      email: user.email || undefined,
      active: true,
      departmentExternalIds: [...new Set(user.dept_id_list)].sort(),
      externalRoleIds: [] as string[],
    };
    if (!normalized.departmentExternalIds.includes(departmentId)) {
      throw new DingtalkDirectoryError('DINGTALK_INCONSISTENT_MEMBERSHIP');
    }
    const existing = members.get(user.userid);
    if (existing && JSON.stringify(existing) !== JSON.stringify(normalized)) {
      throw new DingtalkDirectoryError('DINGTALK_DIRECTORY_CHANGED');
    }
    members.set(user.userid, normalized);
  }

  private async departmentMembers(call: ICall, departmentId: string, members: IMembers) {
    let cursor = 0;
    const seenCursors = new Set<number>();
    for (let pageIndex = 0; ; pageIndex++) {
      if (pageIndex >= pageLimit || seenCursors.has(cursor))
        throw new DingtalkDirectoryError('DINGTALK_PAGINATION_ERROR');
      seenCursors.add(cursor);
      const page = z
        .object({
          list: z.array(userSchema),
          has_more: z.boolean(),
          next_cursor: z.number().int().nonnegative().optional(),
        })
        .parse(await call('/topapi/v2/user/list', { dept_id: departmentId, cursor, size: 100 }));
      for (const user of page.list) this.mergeMember(user, departmentId, members);
      if (!page.has_more) return;
      if (!page.list.length || page.next_cursor === undefined)
        throw new DingtalkDirectoryError('DINGTALK_PAGINATION_ERROR');
      cursor = page.next_cursor;
    }
  }

  private async *offsetPages<T>(
    call: ICall,
    path: string,
    schema: z.ZodType<T>,
    body: object = {}
  ) {
    const pageSchema = z.object({ hasMore: z.boolean(), list: z.array(schema) });
    for (let offset = 0, pageIndex = 0; ; pageIndex++) {
      if (pageIndex >= pageLimit) throw new DingtalkDirectoryError('DINGTALK_PAGINATION_ERROR');
      const page = pageSchema.parse(await call(path, { ...body, offset, size: 200 }));
      yield page.list;
      if (!page.hasMore) return;
      if (!page.list.length) throw new DingtalkDirectoryError('DINGTALK_PAGINATION_ERROR');
      offset += page.list.length;
    }
  }

  private async roles(call: ICall, members: IMembers) {
    const roleIds = new Set<string>();
    const schema = z.object({ roles: z.array(z.object({ id, name: z.string() })) });
    for await (const groups of this.offsetPages(call, '/topapi/role/list', schema)) {
      for (const role of groups.flatMap((group) => group.roles)) {
        if (roleIds.has(role.id)) throw new DingtalkDirectoryError('DINGTALK_DUPLICATE_ROLE');
        roleIds.add(role.id);
        await this.roleMembers(call, role.id, members);
      }
    }
  }

  private async roleMembers(call: ICall, roleId: string, members: IMembers) {
    const schema = z.object({ userid: z.string().min(1) });
    for await (const users of this.offsetPages(call, '/topapi/role/simplelist', schema, {
      role_id: roleId,
    })) {
      for (const user of users) {
        const member = members.get(user.userid);
        if (!member) throw new DingtalkDirectoryError('DINGTALK_INCOMPLETE_DIRECTORY_SCOPE');
        if (member.externalRoleIds.includes(roleId))
          throw new DingtalkDirectoryError('DINGTALK_DUPLICATE_ROLE_MEMBER');
        member.externalRoleIds.push(roleId);
      }
    }
  }
}

type ICall = (path: string, body: object) => Promise<unknown>;
type IMembers = Map<string, IDirectorySnapshot['members'][number]>;

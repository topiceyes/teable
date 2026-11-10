/* eslint-disable @typescript-eslint/naming-convention -- Provider API paths are fixture keys. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DingtalkDirectoryClient } from './dingtalk-directory.client';
vi.mock('../../../utils/ssrf-http', () => ({
  safeFetch: (url: string, init: RequestInit) => fetch(new URL(url), init),
}));
const config = { corpId: 'corp', name: 'Company', appKey: 'key', appSecret: 'secret' };
const user = { userid: 'employee', name: 'Name', dept_id_list: [1, 2] };
function mockProvider(overrides: Record<string, unknown[]> = {}) {
  const responses: Record<string, unknown[]> = {
    '/v1.0/oauth2/accessToken': [{ accessToken: 'token' }],
    '/topapi/v2/department/get': [{ dept_id: 1, name: 'Company' }],
    '/topapi/v2/department/listsub': [[{ dept_id: 2, parent_id: 1, name: 'Department' }], []],
    '/topapi/v2/user/list': [
      { list: [user], has_more: false },
      { list: [user], has_more: false },
    ],
    '/topapi/role/list': [{ list: [{ roles: [{ id: 3, name: 'Manager' }] }], hasMore: false }],
    '/topapi/role/simplelist': [{ list: [{ userid: 'employee' }], hasMore: false }],
    ...overrides,
  };
  const mock = vi.fn(async (url: URL, init: RequestInit) => {
    const value = responses[url.pathname]?.shift();
    if (value === undefined) throw new Error(`Unexpected request ${url.pathname}`);
    expect(init.redirect).toBe('error');
    return {
      ok: true,
      json: async () =>
        url.pathname === '/v1.0/oauth2/accessToken' ? value : { errcode: 0, result: value },
    };
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}
afterEach(() => vi.unstubAllGlobals());
describe('DingTalk directory adapter', () => {
  it('tests credentials and root department access without listing employees or roles', async () => {
    const mock = mockProvider();
    expect(await new DingtalkDirectoryClient().testConnection(config)).toEqual({
      connected: true,
      departmentName: 'Company',
    });
    expect(mock.mock.calls.map(([url]) => url.pathname)).toEqual([
      '/v1.0/oauth2/accessToken',
      '/topapi/v2/department/get',
    ]);
  });
  it('walks departments, merges memberships and reads roles without leaking credentials into token URLs', async () => {
    const mock = mockProvider();
    const snapshot = await new DingtalkDirectoryClient().fetchSnapshot(config);
    expect(snapshot.departments).toHaveLength(2);
    expect(snapshot.members).toEqual([
      expect.objectContaining({
        externalId: 'employee',
        active: true,
        departmentExternalIds: ['1', '2'],
        externalRoleIds: ['3'],
      }),
    ]);
    expect(mock.mock.calls[0][0].origin).toBe('https://api.dingtalk.com');
    expect(mock.mock.calls[0][0].search).toBe('');
    expect(mock.mock.calls[0][1].body).toContain('secret');
    expect(
      mock.mock.calls.slice(1).every(([url]) => url.origin === 'https://oapi.dingtalk.com')
    ).toBe(true);
  });
  it('reads all user pages', async () => {
    const mock = mockProvider({
      '/topapi/v2/user/list': [
        { list: [user], has_more: true, next_cursor: 100 },
        { list: [], has_more: false },
        { list: [user], has_more: false },
      ],
    });
    await new DingtalkDirectoryClient().fetchSnapshot(config);
    expect(
      mock.mock.calls
        .filter(([url]) => url.pathname === '/topapi/v2/user/list')
        .map(([, init]) => JSON.parse(init.body as string).cursor)
    ).toEqual([0, 100, 0]);
  });
  it('rejects repeated cursors', async () => {
    mockProvider({ '/topapi/v2/user/list': [{ list: [user], has_more: true, next_cursor: 0 }] });
    await expect(new DingtalkDirectoryClient().fetchSnapshot(config)).rejects.toThrow(
      'DINGTALK_PAGINATION_ERROR'
    );
  });
  it('rejects employee changes between department reads', async () => {
    mockProvider({
      '/topapi/v2/user/list': [
        { list: [user], has_more: false },
        { list: [{ ...user, name: 'Changed' }], has_more: false },
      ],
    });
    await expect(new DingtalkDirectoryClient().fetchSnapshot(config)).rejects.toThrow(
      'DINGTALK_DIRECTORY_CHANGED'
    );
  });
  it('rejects missing employee scope in role membership', async () => {
    mockProvider({
      '/topapi/role/simplelist': [{ list: [{ userid: 'invisible' }], hasMore: false }],
    });
    await expect(new DingtalkDirectoryClient().fetchSnapshot(config)).rejects.toThrow(
      'DINGTALK_INCOMPLETE_DIRECTORY_SCOPE'
    );
  });
  it('sanitizes transport errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('https://host?secret=private')));
    await expect(new DingtalkDirectoryClient().fetchSnapshot(config)).rejects.toThrow(
      /^DINGTALK_TRANSPORT_ERROR$/
    );
  });
});

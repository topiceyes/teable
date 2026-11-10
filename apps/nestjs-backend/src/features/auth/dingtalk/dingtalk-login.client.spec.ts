/* eslint-disable @typescript-eslint/naming-convention -- DingTalk wire headers and Prisma compound selectors. */
import { Response } from 'node-fetch';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { safeFetch } from '../../../utils/ssrf-http';
import { DingtalkLoginClient } from './dingtalk-login.client';
vi.mock('../../../utils/ssrf-http', () => ({ safeFetch: vi.fn() }));
const fetchMock = vi.mocked(safeFetch);
const config = { corpId: 'corp', name: 'Company', appKey: 'key', appSecret: 'private-secret' };
function reply(data: unknown) {
  return new Response(JSON.stringify(data), { status: 200 });
}
function validResponses() {
  fetchMock.mockResolvedValueOnce(reply({ accessToken: 'personal-token' }));
  fetchMock.mockResolvedValueOnce(reply({ unionId: 'union' }));
  fetchMock.mockResolvedValueOnce(reply({ accessToken: 'app-token' }));
  fetchMock.mockResolvedValueOnce(reply({ errcode: 0, result: { userid: 'employee' } }));
}
beforeEach(() => fetchMock.mockReset());
describe('DingTalk personal OAuth and corporate identity verification', () => {
  it('verifies unionId against the enterprise user and keeps personal tokens out of URLs', async () => {
    validResponses();
    fetchMock.mockResolvedValueOnce(
      reply({
        errcode: 0,
        result: {
          userid: 'employee',
          unionid: 'union',
          name: 'Employee',
          email: 'corporate@example.test',
          active: true,
        },
      })
    );
    expect(await new DingtalkLoginClient().identity(config, 'authorization-code')).toEqual({
      externalId: 'employee',
      unionId: 'union',
      name: 'Employee',
      email: 'corporate@example.test',
    });
    const calls = fetchMock.mock.calls;
    expect(calls).toHaveLength(5);
    expect(JSON.parse(calls[0][1]!.body as string)).toEqual({
      clientId: 'key',
      clientSecret: 'private-secret',
      code: 'authorization-code',
      grantType: 'authorization_code',
    });
    expect(calls[1][1]!.headers).toMatchObject({ 'x-acs-dingtalk-access-token': 'personal-token' });
    expect(
      calls.every(
        ([url]) =>
          !String(url).includes('personal-token') &&
          !String(url).includes('authorization-code') &&
          !String(url).includes('private-secret')
      )
    ).toBe(true);
  });
  it.each(['foreignUnion', 'wrongUser', 'inactive', 'notEmployee'])(
    'rejects %s without returning provider data',
    async (scenario) => {
      if (scenario === 'notEmployee') {
        fetchMock.mockResolvedValueOnce(reply({ accessToken: 'personal-token' }));
        fetchMock.mockResolvedValueOnce(reply({ unionId: 'union' }));
        fetchMock.mockResolvedValueOnce(reply({ accessToken: 'app-token' }));
        fetchMock.mockResolvedValueOnce(
          reply({ errcode: 60121, errmsg: 'private-upstream-secret' })
        );
      } else {
        validResponses();
        fetchMock.mockResolvedValueOnce(
          reply({
            errcode: 0,
            result: {
              userid: scenario === 'wrongUser' ? 'wrong' : 'employee',
              unionid: scenario === 'foreignUnion' ? 'foreign' : 'union',
              name: 'Employee',
              active: scenario !== 'inactive',
            },
          })
        );
      }
      await expect(new DingtalkLoginClient().identity(config, 'code')).rejects.toThrow(
        'DINGTALK_IDENTITY_FAILED'
      );
    }
  );
  it('returns a fixed error when upstream echoes a secret or network call fails', async () => {
    fetchMock.mockRejectedValueOnce(new Error(config.appSecret));
    await expect(new DingtalkLoginClient().identity(config, 'code')).rejects.toThrow(
      /^DINGTALK_IDENTITY_FAILED$/
    );
  });
});

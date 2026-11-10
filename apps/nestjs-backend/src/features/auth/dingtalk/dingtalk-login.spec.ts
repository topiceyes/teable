import type { PrismaService } from '@teable/db-main-prisma';
import type { Request } from 'express';
import Keyv from 'keyv';
import { describe, expect, it, vi } from 'vitest';
import { CacheService } from '../../../cache/cache.service';
import type { IBaseConfig } from '../../../configs/base.config';
import type { AuditScope } from '../../audit/audit-scope';
import type { DirectoryConnectionService } from '../../organization/directory/directory-connection.service';
import type { DingtalkLoginClient } from './dingtalk-login.client';
import { DINGTALK_LOGIN_COOKIE, DingtalkLoginService } from './dingtalk-login.service';

const identity = {
  externalId: 'employee',
  unionId: 'union',
  name: 'Employee',
  email: 'employee@example.test',
};
function fixture() {
  const connection = {
    id: 'connection',
    tenantId: 'corp',
    name: 'Company',
    provider: 'dingtalk',
    enabled: true,
    loginEnabled: true,
    autoProvision: true,
    appKey: 'app',
    appSecret: 'encrypted',
    configurationVersion: 1,
  };
  const member = {
    id: 'member',
    connectionId: 'connection',
    externalId: 'employee',
    unionId: 'union',
    userId: null as string | null,
    inactiveTime: null as Date | null,
  };
  const user = {
    id: 'user',
    name: 'Employee',
    email: identity.email,
    avatar: null,
    phone: null,
    password: null,
    notifyMeta: '{}',
    isAdmin: false,
    isSystem: null,
    lang: null,
  };
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([{ acquired: true }]),
    directoryConnection: {
      findUnique: vi.fn(async () => connection),
      findMany: vi.fn(async () => [{ tenantId: 'corp', name: 'Company' }]),
    },
    directoryMember: {
      findUnique: vi.fn(async () => member),
      findFirst: vi.fn().mockResolvedValue(null),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    user: {
      create: vi.fn(async (_arg: { data: Record<string, unknown> }) => user),
      findFirst: vi.fn(async (arg) => (arg.where.id ? user : null)),
    },
    account: { upsert: vi.fn() },
  };
  const prisma = { ...tx, $transaction: vi.fn(async (fn) => fn(tx)) };
  const config = {
    corpId: 'corp',
    name: 'Company',
    appKey: 'app',
    appSecret: 'secret',
    configurationVersion: 1,
  };
  const connections = { get: vi.fn(async () => config) };
  const client = { identity: vi.fn(async () => identity) };
  const audit = { emitAtomic: vi.fn() };
  const cache = new CacheService(new Keyv());
  const service = new DingtalkLoginService(
    prisma as unknown as PrismaService,
    connections as unknown as DirectoryConnectionService,
    client as unknown as DingtalkLoginClient,
    cache,
    audit as unknown as AuditScope,
    { publicOrigin: 'https://tables.example.test' } as IBaseConfig
  );
  const req = { sessionID: 'browser', headers: {}, session: {} } as unknown as Request;
  const start = async (actorId?: string) => {
    const result = await service.start(req, 'corp', '/space', actorId);
    req.headers.cookie = DINGTALK_LOGIN_COOKIE + '=' + result.nonce;
    return new URL(result.url).searchParams.get('state')!;
  };
  return {
    service,
    tx,
    connection,
    member,
    user,
    client,
    audit,
    cache,
    connections,
    config,
    req,
    start,
  };
}

describe('DingTalk login identity and binding', () => {
  it('lists only enabled enterprise labels and never credentials', async () => {
    const { service, tx } = fixture();
    expect(await service.providers()).toEqual([{ corpId: 'corp', name: 'Company' }]);
    expect(tx.directoryConnection.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ enabled: true, loginEnabled: true }),
      })
    );
  });
  it('uses configured origin for callback and rejects open redirects', async () => {
    const { service, req } = fixture();
    const result = await service.start(req, 'corp', '//evil.example');
    const url = new URL(result.url);
    expect(url.origin).toBe('https://login.dingtalk.com');
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://tables.example.test/api/auth/dingtalk/callback'
    );
    expect(url.searchParams.get('state')).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(result)).not.toContain('encrypted');
  });
  it('requires browser proof before calling the identity provider', async () => {
    const f = fixture();
    const state = await f.start();
    f.req.headers.cookie = '';
    await expect(f.service.callback(f.req, state, 'code')).rejects.toThrow(
      'DINGTALK_STATE_INVALID'
    );
    expect(f.client.identity).not.toHaveBeenCalled();
  });
  it('consumes an OAuth state atomically, including parallel callbacks', async () => {
    const f = fixture();
    const state = await f.start();
    f.member.userId = f.user.id;
    const results = await Promise.allSettled([
      f.service.callback(f.req, state, 'code'),
      f.service.callback(f.req, state, 'code'),
    ]);
    expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(f.client.identity).toHaveBeenCalledTimes(1);
    await expect(f.service.callback(f.req, state, 'code')).rejects.toThrow(
      'DINGTALK_STATE_INVALID'
    );
  });
  it('blocks expired state and changed configuration', async () => {
    const f = fixture();
    const state = await f.start();
    const saved = (await f.cache.get(`auth:dingtalk:state:${state}`))!;
    await f.cache.setDetail(`auth:dingtalk:state:${state}`, { ...saved, expiresAt: 1 }, 600);
    await expect(f.service.callback(f.req, state, 'code')).rejects.toThrow(
      'DINGTALK_STATE_INVALID'
    );
    const next = await f.start();
    f.connection.configurationVersion = 2;
    await expect(f.service.callback(f.req, next, 'code')).rejects.toThrow(
      'DINGTALK_CONFIGURATION_CHANGED'
    );
    expect(f.client.identity).not.toHaveBeenCalled();
  });
  it('allows bound employees without creating or rebinding accounts', async () => {
    const f = fixture();
    f.member.userId = f.user.id;
    f.connection.autoProvision = false;
    const result = await f.service.resolveIdentity('connection', 1, identity);
    expect(result).toMatchObject({ created: false, bound: false, user: { id: f.user.id } });
    expect(f.tx.user.create).not.toHaveBeenCalled();
    expect(f.tx.directoryMember.updateMany).not.toHaveBeenCalled();
  });
  it('creates a regular account and binding in one locked transaction without granting membership', async () => {
    const f = fixture();
    const result = await f.service.resolveIdentity('connection', 1, identity);
    expect(result).toMatchObject({ created: true, bound: true });
    expect(f.tx.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ isAdmin: false, email: identity.email }),
    });
    expect(f.tx.$queryRaw).toHaveBeenCalledOnce();
    expect(f.tx.account.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          provider: 'dingtalk',
          connectionId: 'connection',
          userId: 'user',
        }),
      })
    );
  });
  it('does not take over an existing email account, including deleted or administrator accounts', async () => {
    const f = fixture();
    f.tx.user.findFirst.mockResolvedValue(f.user);
    await expect(f.service.resolveIdentity('connection', 1, identity)).rejects.toThrow(
      'DINGTALK_BIND_REQUIRED'
    );
    expect(f.tx.user.create).not.toHaveBeenCalled();
    expect(f.tx.directoryMember.updateMany).not.toHaveBeenCalled();
  });
  it('binds a signed-in account only after fresh OAuth and same cookie session proof', async () => {
    const f = fixture();
    f.req.session = { passport: { user: { id: 'user' } } } as unknown as Request['session'];
    const state = await f.start('user');
    f.req.sessionID = 'another-browser-session';
    await expect(f.service.callback(f.req, state, 'code')).rejects.toThrow(
      'DINGTALK_STATE_INVALID'
    );
    expect(f.client.identity).not.toHaveBeenCalled();
    const result = await f.service.resolveIdentity('connection', 1, identity, 'user');
    expect(result.bound).toBe(true);
    expect(f.tx.user.create).not.toHaveBeenCalled();
  });
  it.each([
    'disabled',
    'inactive',
    'unionMismatch',
    'unboundDisabled',
    'blockedSignup',
    'wrongActor',
    'occupied',
    'userUnavailable',
    'lockBusy',
    'configurationChanged',
  ])('rejects %s before a binding can commit', async (scenario) => {
    const f = fixture();
    let actor: string | undefined;
    let blocked = false;
    if (scenario === 'disabled') f.connection.loginEnabled = false;
    if (scenario === 'inactive') f.member.inactiveTime = new Date();
    if (scenario === 'unionMismatch') f.member.unionId = 'another';
    if (scenario === 'unboundDisabled') f.connection.autoProvision = false;
    if (scenario === 'blockedSignup') blocked = true;
    if (scenario === 'wrongActor') {
      actor = 'other';
      f.member.userId = 'user';
    }
    if (scenario === 'occupied') {
      actor = 'user';
      f.tx.directoryMember.findFirst.mockResolvedValue({ id: 'other' });
    }
    if (scenario === 'userUnavailable') {
      f.member.userId = 'user';
      f.tx.user.findFirst.mockResolvedValue(null);
    }
    if (scenario === 'lockBusy') f.tx.$queryRaw.mockResolvedValue([{ acquired: false }]);
    if (scenario === 'configurationChanged') f.connection.configurationVersion = 2;
    await expect(
      f.service.resolveIdentity('connection', 1, identity, actor, blocked)
    ).rejects.toThrow();
    expect(f.tx.account.upsert).not.toHaveBeenCalled();
  });
  it('uses deterministic enterprise-scoped internal email when provider supplies none', async () => {
    const f = fixture();
    await f.service.resolveIdentity('connection', 1, { ...identity, email: undefined });
    const data = f.tx.user.create.mock.calls[0][0]?.data;
    expect(data?.email).toMatch(/^dt-[a-f0-9]{40}@dingtalk.invalid$/);
  });
});

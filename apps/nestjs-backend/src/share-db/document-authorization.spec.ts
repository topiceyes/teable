import ShareDB from 'sharedb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { authMiddleware } from './auth.middleware';

const disposers: Array<() => void> = [];
afterEach(() => {
  disposers.splice(0).forEach((dispose) => dispose());
});
async function fixture() {
  let allowed = true,
    active = true,
    session = true;
  const sanitize = vi.fn(async () => {});
  const backend = new ShareDB();
  authMiddleware(backend, {
    sessionHandleService: {
      getSessionIdFromRequest: async () => 'session',
      getUserId: async () => (session ? 'usrActor' : undefined),
    } as never,
    prismaService: {
      user: { findFirst: async () => (active ? { id: 'usrActor' } : null) },
    } as never,
    clsService: { runWith: (_: unknown, fn: () => unknown) => fn() } as never,
    permissionService: {
      getPermissionsByResourceId: async () => (allowed ? ['table|read', 'base|read'] : []),
    } as never,
    sanitizeDocument: sanitize,
  });
  const server = backend.connect();
  const original = server.get('rec_tblAcceptance', 'recOne');
  await new Promise<void>((resolve, reject) =>
    original.create({ fields: { fldName: 'first' } }, (error) =>
      error ? reject(error) : resolve()
    )
  );
  const client = backend.connect(undefined, {
    headers: { cookie: 'test-session' },
    url: '/socket',
  });
  const agent = (client as unknown as { agent: { stream: { isServer: boolean } } }).agent;
  agent.stream.isServer = false;
  const wire: unknown[] = [];
  backend.on('send', (sender, message) => {
    if (sender === agent) wire.push(structuredClone(message));
  });
  client.on('error', () => {});
  const doc = client.get('rec_tblAcceptance', 'recOne');
  doc.on('error', () => {});
  await new Promise<void>((resolve, reject) =>
    doc.subscribe((error) => (error ? reject(error) : resolve()))
  );
  disposers.push(() => {
    client.close();
    server.close();
    backend.close();
  });
  const update = (value: string) =>
    new Promise<void>((resolve, reject) =>
      original.submitOp(
        [{ p: ['fields', 'fldName'], oi: value, od: original.data.fields.fldName }],
        {},
        (error) => (error ? reject(error) : resolve())
      )
    );
  return {
    client,
    doc,
    wire,
    update,
    sanitize,
    revoke: () => {
      allowed = false;
    },
    deactivate: () => {
      active = false;
    },
    signout: () => {
      session = false;
    },
  };
}
describe('live document delivery authorization', () => {
  for (const action of ['qf', 'qs'] as const) {
    it(`authorizes the initial ${action} reply even though ShareDB omits its collection`, async () => {
      const f = await fixture();
      f.sanitize.mockClear();
      const query =
        action === 'qf'
          ? f.client.createFetchQuery('rec_tblAcceptance', {})
          : f.client.createSubscribeQuery('rec_tblAcceptance', {});
      query.on('error', () => {});
      await vi.waitFor(() =>
        expect(f.sanitize).toHaveBeenCalledWith(
          'usrActor',
          'rec',
          'tblAcceptance',
          expect.objectContaining({ a: action })
        )
      );
      await vi.waitFor(() => expect(query.results).toHaveLength(1));
      query.destroy();
    });
    it(`does not deliver an initial ${action} result after resource revocation`, async () => {
      const f = await fixture();
      f.revoke();
      const query =
        action === 'qf'
          ? f.client.createFetchQuery('rec_tblAcceptance', {})
          : f.client.createSubscribeQuery('rec_tblAcceptance', {});
      query.on('error', () => {});
      await vi.waitFor(() => expect(f.client.state).not.toBe('connected'));
      expect(f.wire.some((message) => (message as { a?: string }).a === action)).toBe(false);
    });
  }
  it('delivers authorized operations in order through the installed ShareDB client/server', async () => {
    const f = await fixture();
    await f.update('second');
    await f.update('third');
    await vi.waitFor(() => expect(f.doc.data.fields.fldName).toBe('third'));
    expect(f.sanitize).toHaveBeenCalled();
  });
  for (const change of ['revoke', 'deactivate', 'signout'] as const) {
    it(`closes an existing subscriber before disclosing an op after ${change}`, async () => {
      const f = await fixture();
      f[change]();
      await f.update('private-after-revocation');
      await vi.waitFor(() => expect(f.client.state).not.toBe('connected'));
      expect(JSON.stringify(f.wire)).not.toContain('private-after-revocation');
      expect(f.doc.data.fields.fldName).toBe('first');
    });
  }
  it('fails closed if the data policy check cannot complete', async () => {
    const f = await fixture();
    f.sanitize.mockRejectedValue(new Error('storage unavailable'));
    await f.update('private-storage-error');
    await vi.waitFor(() => expect(f.client.state).not.toBe('connected'));
    expect(JSON.stringify(f.wire)).not.toContain('private-storage-error');
  });
});

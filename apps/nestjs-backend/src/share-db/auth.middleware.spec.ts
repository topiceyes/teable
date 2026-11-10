import {
  getActionTriggerChannel,
  getBaseNodeChannel,
  getChatChannel,
  getCollaboratorsChannel,
  getUserNotificationChannel,
  getWorkflowTestChannel,
} from '@teable/core';
import ShareDBClass from 'sharedb';
import type { Connection } from 'sharedb/lib/client';
import { describe, expect, it, vi } from 'vitest';
import { authMiddleware, type IAuthMiddlewareDeps } from './auth.middleware';

// --- fake backend data -------------------------------------------------------
// table -> base
const tableBase: Record<string, string> = {
  tblMine: 'bseMine',
  tblOther: 'bseOther',
  tblShared: 'bseShared',
  tblTpl: 'bseTpl',
};
// viewId -> table (for action_trigger keyed by a view id)
const viewTable: Record<string, string> = { viwShared: 'tblShared' };
// a view share: shareId -> the shared table (enableShare = true)
const viewShareTable: Record<string, string> = { shrView: 'tblShared' };
// a base share: shareId -> { baseId, enabled }
const baseShares: Record<string, { baseId: string; enabled: boolean }> = {
  shrBase: { baseId: 'bseShared', enabled: true },
};
// which bases each signed-in user can read
const userBaseAccess: Record<string, Set<string>> = { usrMe: new Set(['bseMine']) };

const createDeps = (): IAuthMiddlewareDeps => {
  // The session cookie names the user directly here.
  const sessionHandleService = {
    getSessionIdFromRequest: async (req: { headers: { cookie?: string } }) =>
      req.headers.cookie?.replace('session=', ''),
    getUserId: async (sessionId: string) => sessionId,
  };
  let currentUserId: string | undefined;
  const clsService = {
    runWith: (store: { user?: { id?: string } }, fn: () => unknown) => {
      currentUserId = store?.user?.id;
      return fn();
    },
    get: () => undefined,
  };
  const permissionService = {
    getPermissionsByResourceId: vi.fn(async (resourceId: string) => {
      const baseId = tableBase[resourceId] || resourceId;
      if (currentUserId && userBaseAccess[currentUserId]?.has(baseId))
        return ['base|read', 'table|read'];
      throw new Error('no permission');
    }),
  };
  const prismaService = {
    user: { findFirst: vi.fn(async ({ where }: { where: { id: string } }) => ({ id: where.id })) },
    tableMeta: {
      findFirst: async ({ where: { id } }: { where: { id: string } }) =>
        tableBase[id] ? { baseId: tableBase[id] } : null,
    },
    view: {
      findFirst: async ({ where }: { where: { id?: string; shareId?: string } }) => {
        if (where.shareId) {
          const tableId = viewShareTable[where.shareId];
          return tableId ? { tableId } : null;
        }
        const tableId = where.id ? viewTable[where.id] : undefined;
        return tableId ? { tableId } : null;
      },
    },
    baseShare: {
      findUnique: async ({ where: { shareId } }: { where: { shareId: string } }) =>
        baseShares[shareId] ?? null,
    },
  };
  return {
    sessionHandleService: sessionHandleService as never,
    permissionService: permissionService as never,
    clsService: clsService as never,
    prismaService: prismaService as never,
  };
};

const createBackend = (deps = createDeps()) => {
  const backend = new ShareDBClass({
    presence: true,
    doNotForwardSendPresenceErrorsToClient: true,
  });
  authMiddleware(backend, deps);
  return backend;
};

/**
 * A browser connection, signed in as `userId` and/or carrying a share id or a template preview
 * header (or anonymous).
 */
const connectBrowser = (
  backend: ShareDBClass,
  opts: { userId?: string; shareId?: string; baseShareId?: string; templateHeader?: string } = {}
): Connection => {
  const params = new URLSearchParams();
  if (opts.shareId) params.set('shareId', opts.shareId);
  if (opts.baseShareId) params.set('baseShareId', opts.baseShareId);
  if (opts.templateHeader) params.set('templateHeader', opts.templateHeader);
  const query = params.toString();
  const connection = backend.connect(undefined, {
    headers: { cookie: opts.userId ? `session=${opts.userId}` : undefined },
    url: query ? `/socket?${query}` : '/socket',
  }) as Connection & { agent: { stream: { isServer: boolean } } };
  // backend.connect() is the in-process transport; mark it remote like a WebSocket client.
  connection.agent.stream.isServer = false;
  return connection;
};

const subscribe = (connection: Connection, channel: string) => {
  const presence = connection.getPresence(channel);
  return new Promise<typeof presence>((resolve, reject) =>
    presence.subscribe((error) => (error ? reject(error) : resolve(presence)))
  );
};

const submit = (connection: Connection, channel: string, id: string, value: unknown) =>
  new Promise<void>((resolve, reject) =>
    connection
      .getPresence(channel)
      .create(id)
      .submit(value, (error) => (error ? reject(error) : resolve()))
  );

describe('notification presence is private to its user', () => {
  it('lets a user subscribe to their own notifications', async () => {
    const backend = createBackend();
    await expect(
      subscribe(connectBrowser(backend, { userId: 'usrMe' }), getUserNotificationChannel('usrMe'))
    ).resolves.toBeDefined();
  });

  it("refuses another user's notifications", async () => {
    const backend = createBackend();
    await expect(
      subscribe(
        connectBrowser(backend, { userId: 'usrMe' }),
        getUserNotificationChannel('usrOther')
      )
    ).rejects.toMatchObject({ message: expect.stringContaining('own user only') });
  });

  it('refuses anonymous connections', async () => {
    const backend = createBackend();
    await expect(
      subscribe(connectBrowser(backend), getUserNotificationChannel('usrMe'))
    ).rejects.toBeDefined();
  });

  it('refuses a browser publishing onto a notification channel, even its own', async () => {
    const backend = createBackend();
    const channel = getUserNotificationChannel('usrMe');
    await expect(
      submit(connectBrowser(backend, { userId: 'usrMe' }), channel, 'notFake', { message: 'fake' })
    ).rejects.toMatchObject({ message: expect.stringContaining('server only') });
  });

  it('delivers what the server publishes to the owner', async () => {
    const backend = createBackend();
    const channel = getUserNotificationChannel('usrMe');
    const mine = await subscribe(connectBrowser(backend, { userId: 'usrMe' }), channel);
    const received = new Promise((resolve) => mine.on('receive', (_id, value) => resolve(value)));

    await submit(backend.connect(), channel, 'notReal', { message: 'hello' });
    await expect(received).resolves.toEqual({ message: 'hello' });
  });
});

describe('non-notification presence requires read access to the channel resource', () => {
  it('rejects an anonymous connection subscribing to a table presence channel', async () => {
    const backend = createBackend();
    await expect(
      subscribe(connectBrowser(backend), getCollaboratorsChannel('tblMine'))
    ).rejects.toBeDefined();
  });

  it('rejects an anonymous connection publishing fake presence', async () => {
    const backend = createBackend();
    await expect(
      submit(connectBrowser(backend), getCollaboratorsChannel('tblMine'), 'me', { name: 'x' })
    ).rejects.toBeDefined();
  });

  it('lets a user with base access subscribe to that base’s table presence', async () => {
    const backend = createBackend();
    await expect(
      subscribe(connectBrowser(backend, { userId: 'usrMe' }), getCollaboratorsChannel('tblMine'))
    ).resolves.toBeDefined();
  });

  it('rejects a signed-in user subscribing to another tenant’s table presence', async () => {
    const backend = createBackend();
    await expect(
      subscribe(connectBrowser(backend, { userId: 'usrMe' }), getCollaboratorsChannel('tblOther'))
    ).rejects.toBeDefined();
  });

  it('rejects an unused channel even for a signed-in user', async () => {
    const backend = createBackend();
    await expect(
      subscribe(connectBrowser(backend, { userId: 'usrMe' }), getChatChannel('chtX'))
    ).rejects.toBeDefined();
  });
});

describe('presence on a deleted or nonexistent resource is allowed (nothing to protect)', () => {
  // Regression guard: when a table a collaborator had open is deleted out from under them, the
  // client still tears down presence for the now-gone table. That channel no longer resolves to a
  // base (tblGone is absent from the fixture, like a row with deletedTime set), so there is no data
  // to protect and denying it only makes the collaborator's page throw "Presence channel access
  // denied". A channel that points at live data always resolves and stays gated by the tests above.
  it('lets a signed-in collaborator subscribe to a deleted table’s presence channel', async () => {
    const backend = createBackend();
    await expect(
      subscribe(connectBrowser(backend, { userId: 'usrMe' }), getCollaboratorsChannel('tblGone'))
    ).resolves.toBeDefined();
  });

  it('lets a signed-in collaborator publish presence onto a deleted table’s channel', async () => {
    const backend = createBackend();
    await expect(
      submit(
        connectBrowser(backend, { userId: 'usrMe' }),
        getCollaboratorsChannel('tblGone'),
        'me',
        {
          name: 'x',
        }
      )
    ).resolves.toBeUndefined();
  });
});

describe('public-share presence is scoped to the share', () => {
  it('lets a base-share visitor use a base channel for the shared base', async () => {
    const backend = createBackend();
    await expect(
      subscribe(
        connectBrowser(backend, { baseShareId: 'shrBase' }),
        getBaseNodeChannel('bseShared')
      )
    ).resolves.toBeDefined();
  });

  it('lets a base-share visitor use a table channel inside the shared base', async () => {
    const backend = createBackend();
    await expect(
      subscribe(
        connectBrowser(backend, { baseShareId: 'shrBase' }),
        getCollaboratorsChannel('tblShared')
      )
    ).resolves.toBeDefined();
  });

  it('rejects a base-share visitor reaching a base outside the share', async () => {
    const backend = createBackend();
    await expect(
      subscribe(connectBrowser(backend, { baseShareId: 'shrBase' }), getBaseNodeChannel('bseOther'))
    ).rejects.toBeDefined();
  });

  it('lets a view-share visitor use the shared table’s action-trigger channel', async () => {
    const backend = createBackend();
    await expect(
      subscribe(
        connectBrowser(backend, { shareId: 'shrView' }),
        getActionTriggerChannel('tblShared')
      )
    ).resolves.toBeDefined();
  });

  it('rejects a view-share visitor reaching a base-only channel', async () => {
    const backend = createBackend();
    await expect(
      subscribe(connectBrowser(backend, { shareId: 'shrView' }), getBaseNodeChannel('bseShared'))
    ).rejects.toBeDefined();
  });
});

describe('template preview connections get no presence', () => {
  // A template preview shows a frozen snapshot, so its page opens no presence channel
  // (usePresenceConnection). The template header authorizes document reads only: it must never
  // become a way onto a base's live channels.
  it.each([getBaseNodeChannel('bseTpl'), getActionTriggerChannel('tblTpl')])(
    'refuses %s to an anonymous template preview',
    async (ch) => {
      const backend = createBackend();
      await expect(
        subscribe(connectBrowser(backend, { templateHeader: 'tplHeader' }), ch)
      ).rejects.toMatchObject({ message: 'Presence channel access denied' });
    }
  );
});

describe('workflow-test presence requires a signed-in user', () => {
  it('rejects an anonymous connection', async () => {
    const backend = createBackend();
    await expect(
      subscribe(connectBrowser(backend), getWorkflowTestChannel('wflX'))
    ).rejects.toBeDefined();
  });

  it('allows a signed-in user', async () => {
    const backend = createBackend();
    await expect(
      subscribe(connectBrowser(backend, { userId: 'usrMe' }), getWorkflowTestChannel('wflX'))
    ).resolves.toBeDefined();
  });
});

describe('presence authorization is rechecked on an existing connection', () => {
  it('checks table permission rather than treating database membership as table access', async () => {
    const deps = createDeps();
    const getPermissions = vi.mocked(deps.permissionService!.getPermissionsByResourceId);
    getPermissions.mockResolvedValue(['base|read']);
    const backend = createBackend(deps);
    await expect(
      subscribe(connectBrowser(backend, { userId: 'usrMe' }), getCollaboratorsChannel('tblMine'))
    ).rejects.toBeDefined();
    expect(getPermissions).toHaveBeenCalledWith('tblMine');
  });

  it('rejects the next publish after resource access is revoked', async () => {
    const deps = createDeps();
    const backend = createBackend(deps);
    const connection = connectBrowser(backend, { userId: 'usrMe' });
    const channel = getCollaboratorsChannel('tblMine');
    await subscribe(connection, channel);
    vi.mocked(deps.permissionService!.getPermissionsByResourceId).mockRejectedValue(
      new Error('revoked')
    );
    await expect(submit(connection, channel, 'me', { name: 'old member' })).rejects.toBeDefined();
  });

  it('allows a previously denied channel after a new live authorization', async () => {
    const deps = createDeps();
    const backend = createBackend(deps);
    const connection = connectBrowser(backend, { userId: 'usrMe' });
    const channel = getCollaboratorsChannel('tblOther');
    await expect(
      submit(connection, channel, 'me', { name: 'not yet allowed' })
    ).rejects.toBeDefined();
    vi.mocked(deps.permissionService!.getPermissionsByResourceId).mockResolvedValue(['table|read']);
    await expect(
      submit(connection, channel, 'me', { name: 'now allowed' })
    ).resolves.toBeUndefined();
  });

  it('rejects old-session activity after signout and after account deactivation', async () => {
    for (const invalidate of ['session', 'account'] as const) {
      const deps = createDeps();
      const backend = createBackend(deps);
      const connection = connectBrowser(backend, { userId: 'usrMe' });
      const channel = getCollaboratorsChannel('tblMine');
      await subscribe(connection, channel);
      if (invalidate === 'session') {
        deps.sessionHandleService!.getUserId = vi.fn().mockResolvedValue(undefined);
      } else {
        deps.prismaService!.user.findFirst = vi.fn().mockResolvedValue(null);
      }
      await expect(submit(connection, channel, 'me', { name: 'inactive' })).rejects.toBeDefined();
    }
  });

  it('does not retain a disabled base share or view share scope', async () => {
    for (const share of ['base', 'view'] as const) {
      const deps = createDeps();
      const backend = createBackend(deps);
      const connection = connectBrowser(
        backend,
        share === 'base' ? { baseShareId: 'shrBase' } : { shareId: 'shrView' }
      );
      const channel = getActionTriggerChannel('tblShared');
      await subscribe(connection, channel);
      if (share === 'base') {
        deps.prismaService!.baseShare.findUnique = vi
          .fn()
          .mockResolvedValue({ baseId: 'bseShared', enabled: false });
      } else {
        deps.prismaService!.view.findFirst = vi.fn().mockResolvedValue(null);
      }
      await expect(
        submit(connection, channel, 'me', { name: 'share disabled' })
      ).rejects.toBeDefined();
    }
  });

  it('continues delivering table presence while live access remains valid', async () => {
    const deps = createDeps();
    const backend = createBackend(deps);
    const channel = getCollaboratorsChannel('tblMine');
    const presence = await subscribe(connectBrowser(backend, { userId: 'usrMe' }), channel);
    const received = new Promise((resolve) =>
      presence.on('receive', (_id, value) => resolve(value))
    );
    await submit(backend.connect(), channel, 'server', { name: 'authorized update' });
    await expect(received).resolves.toEqual({ name: 'authorized update' });
    expect(deps.permissionService!.getPermissionsByResourceId).toHaveBeenCalledWith('tblMine');
    expect(deps.prismaService!.user.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'usrMe',
        deletedTime: null,
        deactivatedTime: null,
        permanentDeletedTime: null,
        OR: [{ isSystem: false }, { isSystem: null }],
      },
      select: { id: true },
    });
  });

  it('drops broadcasts after a public share is disabled on an already open subscription', async () => {
    const deps = createDeps();
    const backend = createBackend(deps);
    const channel = getActionTriggerChannel('tblShared');
    const presence = await subscribe(connectBrowser(backend, { baseShareId: 'shrBase' }), channel);
    const received = vi.fn();
    presence.on('receive', received);
    deps.prismaService!.baseShare.findUnique = vi
      .fn()
      .mockResolvedValue({ baseId: 'bseShared', enabled: false });
    const blocked = new Promise<unknown>((resolve) => {
      backend.errorHandler = (error) => resolve(error);
    });
    await submit(backend.connect(), channel, 'server', { name: 'share disabled' });
    await expect(blocked).resolves.toMatchObject({ message: 'Presence channel access denied' });
    expect(received).not.toHaveBeenCalled();
  });

  it('drops server broadcasts to an already subscribed user after access is revoked', async () => {
    const deps = createDeps();
    const backend = createBackend(deps);
    const channel = getCollaboratorsChannel('tblMine');
    const presence = await subscribe(connectBrowser(backend, { userId: 'usrMe' }), channel);
    const received = vi.fn();
    presence.on('receive', received);
    vi.mocked(deps.permissionService!.getPermissionsByResourceId).mockRejectedValue(
      new Error('revoked')
    );
    const blocked = new Promise<unknown>((resolve) => {
      backend.errorHandler = (error) => resolve(error);
    });
    await submit(backend.connect(), channel, 'server', { name: 'must not arrive' });
    await expect(blocked).resolves.toMatchObject({ message: 'Presence channel access denied' });
    expect(received).not.toHaveBeenCalled();
  });

  it('drops notification delivery when the original session has expired', async () => {
    const deps = createDeps();
    const backend = createBackend(deps);
    const channel = getUserNotificationChannel('usrMe');
    const presence = await subscribe(connectBrowser(backend, { userId: 'usrMe' }), channel);
    const received = vi.fn();
    presence.on('receive', received);
    deps.sessionHandleService!.getUserId = vi.fn().mockResolvedValue(undefined);
    const blocked = new Promise<unknown>((resolve) => {
      backend.errorHandler = (error) => resolve(error);
    });
    await submit(backend.connect(), channel, 'notification', { message: 'private' });
    await expect(blocked).resolves.toMatchObject({
      message: expect.stringContaining('own user only'),
    });
    expect(received).not.toHaveBeenCalled();
  });

  it('fails closed when permission or session storage becomes unavailable', async () => {
    const deps = createDeps();
    const backend = createBackend(deps);
    const connection = connectBrowser(backend, { userId: 'usrMe' });
    const channel = getCollaboratorsChannel('tblMine');
    await subscribe(connection, channel);
    deps.sessionHandleService!.getUserId = vi.fn().mockRejectedValue(new Error('storage down'));
    await expect(submit(connection, channel, 'me', { name: 'offline' })).rejects.toBeDefined();
  });
});

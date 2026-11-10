import type { Action } from '@teable/core';
import type ShareDB from 'sharedb';
import type { IAuthMiddlewareDeps } from './auth.middleware';

type IMessage = { a?: string; c?: string; d?: string; id?: number; [key: string]: unknown };

/** Every outbound document operation and query diff crosses this boundary, including live streams. */
export function registerDocumentAuthorization(backend: ShareDB, deps: IAuthMiddlewareDeps) {
  const {
    permissionService: permissions,
    prismaService: prisma,
    clsService: cls,
    sessionHandleService: sessions,
  } = deps;
  if (!permissions || !prisma || !cls || !sessions) return;
  backend.use('connect', (context, next) => {
    const agent = context.agent as typeof context.agent & { closed: boolean; close: () => void };
    const send = agent.send.bind(agent);
    const queryCollections = new Map<number, string>();
    let pending = Promise.resolve();
    const authorize = async (message: IMessage) => {
      if (agent.stream.isServer || message.error) return;
      const collection =
        message.c ||
        (['q', 'qs', 'qf'].includes(message.a || '') && message.id != null
          ? queryCollections.get(message.id)
          : undefined);
      if (!collection) return;
      const [type, parentId] = collection.split('_');
      if (!['rec', 'fld', 'viw', 'tbl'].includes(type) || !parentId)
        throw new Error('Document access denied');
      const resourceId = parentId;
      const action: Action = type === 'tbl' ? 'base|read' : 'table|read';
      const userId = await authorizeIdentity(
        agent,
        {
          permissionService: permissions,
          prismaService: prisma,
          clsService: cls,
          sessionHandleService: sessions,
        },
        resourceId,
        action
      );
      await deps.sanitizeDocument?.(userId, type, parentId, message);
    };
    agent.send = ((message: IMessage) => {
      if (agent.stream.isServer) return send(message as Parameters<typeof send>[0]);
      // Preserve wire ordering: an async check must never reorder document versions or query diffs.
      pending = pending
        .then(async () => {
          if (agent.closed) return;
          await authorize(message);
          send(message as Parameters<typeof send>[0]);
          if ((message.a === 'qf' || message.a === 'qu') && message.id != null)
            queryCollections.delete(message.id);
        })
        .catch(() => {
          agent.close();
        });
    }) as typeof agent.send;
    agent.custom.documentQueryCollections = queryCollections;
    next();
  });
  backend.use('receive', (context, next) => {
    const message = context.data as IMessage;
    const collections = context.agent.custom.documentQueryCollections as
      | Map<number, string>
      | undefined;
    if (
      collections &&
      collections.size >= 1000 &&
      message.id != null &&
      !collections.has(message.id)
    )
      return next(new Error('Too many active queries'));
    if (message.id != null && message.c && (message.a === 'qs' || message.a === 'qf'))
      collections?.set(message.id, message.c);
    // Keep the association through qu acknowledgement; query ids may be reused on the same connection.
    next();
  });
}

async function authorizeIdentity(
  agent: ShareDB.middleware.ConnectContext['agent'],
  deps: Required<
    Pick<
      IAuthMiddlewareDeps,
      'permissionService' | 'prismaService' | 'clsService' | 'sessionHandleService'
    >
  >,
  resourceId: string,
  action: Action
) {
  const {
    permissionService: permissions,
    prismaService: prisma,
    clsService: cls,
    sessionHandleService: sessions,
  } = deps;
  const sessionId = agent.custom.sessionId;
  const userId = sessionId ? await sessions.getUserId(sessionId) : undefined;
  const user = userId
    ? await prisma.user.findFirst({
        where: {
          id: userId,
          deletedTime: null,
          deactivatedTime: null,
          permanentDeletedTime: null,
          OR: [{ isSystem: false }, { isSystem: null }],
        },
        select: { id: true },
      })
    : null;
  const custom = agent.custom;
  const identity = { user: user ? { id: user.id } : undefined };
  if (custom.baseShareId) {
    await cls.runWith(identity as never, () =>
      permissions.validBaseSharePermissions(custom.baseShareId, resourceId, [action])
    );
  } else if (custom.shareId) {
    await cls.runWith(identity as never, () =>
      permissions.validShareViewPermissions(custom.shareId, resourceId, [action])
    );
  } else if (custom.templateHeader) {
    const template = permissions.getTemplateIdByHeader(custom.templateHeader);
    if (!template) throw new Error('Document access denied');
    await cls.runWith(identity as never, () =>
      permissions.validTemplatePermissions(resourceId, [action])
    );
  } else {
    if (!user) throw new Error('Document access denied');
    const allowed = await cls.runWith({ user: { id: user.id } } as never, () =>
      permissions.getPermissionsByResourceId(resourceId)
    );
    if (!allowed.includes(action)) throw new Error('Document access denied');
  }
  return user?.id;
}

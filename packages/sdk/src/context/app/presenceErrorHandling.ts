import type { Connection } from 'sharedb/lib/client';

/** Wire errors are already reported by handleShareDbReceive. Presence is its own EventEmitter;
 * without a listener, subscribe() callers without a callback throw a second, uncaught error. */
export function installPresenceErrorHandling(connection: Connection) {
  const getPresence = connection.getPresence.bind(connection);
  const installed = new WeakSet<object>();
  connection.getPresence = (channel) => {
    const presence = getPresence(channel);
    if (!installed.has(presence)) {
      presence.on('error', () => {
        // The connection's receive listener reports the wire error once.
      });
      installed.add(presence);
    }
    return presence;
  };
}

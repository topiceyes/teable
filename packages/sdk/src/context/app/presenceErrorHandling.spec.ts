import { Connection } from 'sharedb/lib/client';
import { describe, expect, it, vi } from 'vitest';
import { installPresenceErrorHandling } from './presenceErrorHandling';

describe('presence subscription errors', () => {
  it('does not throw an uncaught EventEmitter error for a rejected optional channel', () => {
    const connection = new Connection({ readyState: 0 } as never);
    installPresenceErrorHandling(connection);
    const presence = connection.getPresence('restricted-channel');
    expect(() => presence.emit('error', new Error('access denied'))).not.toThrow();
  });
  it('attaches one listener and preserves feature-specific error handlers', () => {
    const connection = new Connection({ readyState: 0 } as never);
    installPresenceErrorHandling(connection);
    const presence = connection.getPresence('restricted-channel');
    const handler = vi.fn();
    presence.on('error', handler);
    expect(connection.getPresence('restricted-channel')).toBe(presence);
    expect(presence.listenerCount('error')).toBe(2);
    presence.emit('error', new Error('access denied'));
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

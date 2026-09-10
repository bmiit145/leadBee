import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DependencyStatus } from '../infrastructure/dependency.types.js';

const startMock = vi.fn(async () => {});
const stopMock = vi.fn(async () => {});
const statusMock = vi.fn<() => DependencyStatus>();

vi.mock('../infrastructure/database/database.manager.js', () => ({
  databaseManager: {
    start: () => startMock(),
    stop: () => stopMock(),
    status: () => statusMock(),
  },
}));

function status(overrides: Partial<DependencyStatus> = {}): DependencyStatus {
  return {
    name: 'mongodb',
    state: 'connected',
    ready: true,
    lastConnectedAt: null,
    lastDisconnectedAt: null,
    consecutiveFailures: 0,
    ...overrides,
  };
}

describe('database config adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    statusMock.mockReturnValue(status());
  });

  describe('connectDatabase (one-shot scripts)', () => {
    it('resolves once the database is reachable', async () => {
      const { connectDatabase } = await import('./database.js');

      await expect(connectDatabase()).resolves.toBeUndefined();

      expect(startMock).toHaveBeenCalledOnce();
      expect(stopMock).not.toHaveBeenCalled();
    });

    it('fails fast when the database is unreachable', async () => {
      // A script has nothing to do without a database. The server survives an
      // outage; `seed`/`smoke` must not silently proceed into buffer timeouts.
      statusMock.mockReturnValue(status({ state: 'disconnected', ready: false }));
      const { connectDatabase } = await import('./database.js');

      await expect(connectDatabase()).rejects.toThrow('MongoDB is not reachable');
      // ...and the pending reconnect is cancelled so the script can exit.
      expect(stopMock).toHaveBeenCalledOnce();
    });
  });

  describe('databaseState', () => {
    it('mirrors the manager state without touching the database', async () => {
      statusMock.mockReturnValue(status({ state: 'degraded', ready: false }));
      const { databaseState } = await import('./database.js');

      expect(databaseState()).toEqual({ ok: false, state: 'degraded' });
      expect(startMock).not.toHaveBeenCalled();
    });
  });
});

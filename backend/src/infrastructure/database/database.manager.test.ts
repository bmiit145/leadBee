import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseLifecycleListener } from './database.manager.js';

type Listener = (...args: unknown[]) => void;

const connectMock = vi.fn();
const closeMock = vi.fn();
const listeners = new Map<string, Listener[]>();

const connection = {
  readyState: 0,
  on: vi.fn((event: string, listener: Listener) => {
    const existing = listeners.get(event) ?? [];
    existing.push(listener);
    listeners.set(event, existing);
  }),
  close: closeMock,
};

/** Fires a driver event the way Mongoose re-emits it on the connection. */
function emit(event: string, ...args: unknown[]): void {
  for (const listener of listeners.get(event) ?? []) listener(...args);
}

const loggerMock = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

vi.mock('mongoose', () => ({
  default: {
    connection,
    set: vi.fn(),
    connect: connectMock,
  },
}));

vi.mock('../../config/env.js', () => ({
  env: {
    // Deliberately carries a password — no log line may ever reproduce it.
    MONGODB_URI: 'mongodb://leadbee:sup3r-s3cret@db.example.com:27017/leadbee',
    MONGODB_MAX_POOL_SIZE: 10,
    MONGODB_MIN_POOL_SIZE: 1,
    MONGO_DEBUG: false,
  },
}));

vi.mock('../../lib/logger.js', () => ({ logger: loggerMock }));

async function loadManager() {
  const { databaseManager } = await import('./database.manager.js');
  return databaseManager;
}

describe('DatabaseManager', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers();
    listeners.clear();
    connection.readyState = 0;
    connectMock.mockReset();
    closeMock.mockReset();
    closeMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('startup', () => {
    it('does not throw when the initial MongoDB connection is unavailable', async () => {
      connectMock.mockRejectedValue(new Error('Atlas unavailable'));
      const manager = await loadManager();

      await expect(manager.start()).resolves.toBeUndefined();

      expect(manager.status().state).toBe('disconnected');
      expect(manager.status().ready).toBe(false);
      expect(manager.status().consecutiveFailures).toBe(1);
    });

    it('becomes ready when the driver reports connected', async () => {
      connectMock.mockImplementation(async () => {
        connection.readyState = 1;
      });
      const manager = await loadManager();

      await manager.start();

      expect(manager.status().state).toBe('connected');
      expect(manager.status().ready).toBe(true);
      expect(manager.status().lastConnectedAt).not.toBeNull();
    });

    it('does not report connected when connect() resolves but the driver is not ready', async () => {
      // `connect()` resolving is not proof of a usable connection.
      connectMock.mockResolvedValue(undefined);
      connection.readyState = 0;
      const manager = await loadManager();

      await manager.start();

      expect(manager.status().state).not.toBe('connected');
      expect(manager.status().ready).toBe(false);
    });

    it('binds connection listeners exactly once across repeated starts', async () => {
      connectMock.mockImplementation(async () => {
        connection.readyState = 1;
      });
      const manager = await loadManager();

      await manager.start();
      await manager.start();

      const boundEvents = connection.on.mock.calls.map(([event]) => event);
      expect(boundEvents).toEqual(['connected', 'error', 'disconnected']);
    });

    it('retries the initial connection until it succeeds, without a restart', async () => {
      // Mongoose does not retry a failed initial connect — openUri() rejects and
      // leaves the connection disconnected forever — so the manager must.
      connectMock
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockImplementation(async () => {
          connection.readyState = 1;
        });

      const manager = await loadManager();
      await manager.start();

      expect(manager.status().ready).toBe(false);
      expect(connectMock).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(60_000);

      expect(connectMock).toHaveBeenCalledTimes(3);
      expect(manager.status().state).toBe('connected');
      expect(manager.status().ready).toBe(true);
      expect(manager.status().consecutiveFailures).toBe(0);
    });

    it('backs off instead of spinning, so an outage cannot flood the log', async () => {
      connectMock.mockRejectedValue(new Error('ECONNREFUSED'));
      const manager = await loadManager();

      await manager.start();
      await vi.advanceTimersByTimeAsync(60_000);

      // Exponential backoff capped at 30s: a minute of outage is a handful of
      // attempts, not hundreds.
      expect(connectMock.mock.calls.length).toBeLessThanOrEqual(8);
      expect(manager.status().state).toBe('disconnected');
    });

    it('dumps a full error once per outage window, not once per attempt', async () => {
      connectMock.mockRejectedValue(new Error('ECONNREFUSED'));
      const manager = await loadManager();

      await manager.start();
      await vi.advanceTimersByTimeAsync(25_000);

      const fullDumps = loggerMock.error.mock.calls.filter(([fields]) => 'err' in Object(fields));
      expect(fullDumps).toHaveLength(1);
      // Later attempts are still reported, just compactly and at warn.
      expect(connectMock.mock.calls.length).toBeGreaterThan(1);
      expect(manager.status().consecutiveFailures).toBe(connectMock.mock.calls.length);
    });

    it('never writes the connection string or its credentials to the log', async () => {
      connectMock.mockRejectedValue(new Error('ECONNREFUSED'));
      const manager = await loadManager();

      await manager.start();
      await vi.advanceTimersByTimeAsync(60_000);

      const logged = [loggerMock.info, loggerMock.warn, loggerMock.error, loggerMock.debug]
        .flatMap((fn) => fn.mock.calls)
        .map((args) => JSON.stringify(args));

      expect(logged.join('\n')).not.toContain('sup3r-s3cret');
      expect(logged.join('\n')).not.toContain('mongodb://');
      // The host is still useful and safe to surface.
      expect(logged.some((line) => line.includes('db.example.com:27017/leadbee'))).toBe(true);
    });
  });

  describe('runtime outage and recovery', () => {
    async function connectedManager() {
      connectMock.mockImplementation(async () => {
        connection.readyState = 1;
      });
      const manager = await loadManager();
      await manager.start();
      return manager;
    }

    it('drops readiness when the driver reports a disconnect', async () => {
      const manager = await connectedManager();

      connection.readyState = 0;
      emit('disconnected');

      expect(manager.status().state).toBe('degraded');
      expect(manager.status().ready).toBe(false);
      expect(manager.status().lastDisconnectedAt).not.toBeNull();
    });

    it('restores readiness when the driver reconnects on its own', async () => {
      const manager = await connectedManager();
      const attemptsBefore = connectMock.mock.calls.length;

      connection.readyState = 0;
      emit('disconnected');
      expect(manager.status().ready).toBe(false);

      connection.readyState = 1;
      emit('connected');

      expect(manager.status().state).toBe('connected');
      expect(manager.status().ready).toBe(true);

      // Recovery after a successful connect belongs to the driver's topology
      // monitor. A competing reconnect loop here would only add churn.
      await vi.advanceTimersByTimeAsync(60_000);
      expect(connectMock).toHaveBeenCalledTimes(attemptsBefore);
    });

    it('keeps readiness when an error arrives on a still-live connection', async () => {
      const manager = await connectedManager();

      connection.readyState = 1;
      emit('error', new Error('transient command failure'));

      expect(manager.status().state).toBe('connected');
      expect(manager.status().ready).toBe(true);
    });

    it('drops readiness when an error arrives and the topology is gone', async () => {
      const manager = await connectedManager();

      connection.readyState = 0;
      emit('error', new Error('topology destroyed'));

      expect(manager.status().ready).toBe(false);
    });

    it('publishes every lifecycle transition to registered listeners', async () => {
      connectMock.mockRejectedValue(new Error('Atlas unavailable'));
      const manager = await loadManager();
      const states: string[] = [];
      const listener: DatabaseLifecycleListener = (status) => states.push(status.state);
      manager.onLifecycleChange(listener);

      await manager.start();
      connection.readyState = 1;
      emit('connected');

      expect(states).toContain('connecting');
      expect(states).toContain('disconnected');
      expect(states).toContain('connected');
    });

    it('does not re-publish a state the manager is already in', async () => {
      const manager = await connectedManager();
      const states: string[] = [];
      manager.onLifecycleChange((status) => states.push(status.state));

      // A duplicate 'connected' must not retrigger downstream work such as
      // catalogue registration.
      emit('connected');
      emit('connected');

      expect(states).toEqual([]);
    });

    it('stops notifying a listener once it unsubscribes', async () => {
      const manager = await connectedManager();
      const states: string[] = [];
      const unsubscribe = manager.onLifecycleChange((status) => states.push(status.state));

      unsubscribe();
      connection.readyState = 0;
      emit('disconnected');

      expect(states).toEqual([]);
    });

    it('survives a listener that throws', async () => {
      const manager = await connectedManager();
      manager.onLifecycleChange(() => {
        throw new Error('listener exploded');
      });

      connection.readyState = 0;
      expect(() => emit('disconnected')).not.toThrow();
      expect(manager.status().ready).toBe(false);
    });
  });

  describe('shutdown', () => {
    it('closes an open connection and reports the terminal state', async () => {
      connectMock.mockImplementation(async () => {
        connection.readyState = 1;
      });
      const manager = await loadManager();
      await manager.start();

      await expect(manager.stop()).resolves.toBeUndefined();

      expect(closeMock).toHaveBeenCalledWith(false);
      expect(manager.status().state).toBe('disconnected');
      expect(manager.status().ready).toBe(false);
    });

    it('is a no-op when nothing was ever connected', async () => {
      connectMock.mockRejectedValue(new Error('Atlas unavailable'));
      const manager = await loadManager();
      await manager.start();

      await manager.stop();

      expect(closeMock).not.toHaveBeenCalled();
      expect(manager.status().state).toBe('disconnected');
    });

    it('cancels a pending reconnect so the process can exit', async () => {
      connectMock.mockRejectedValue(new Error('ECONNREFUSED'));
      const manager = await loadManager();
      await manager.start();

      await manager.stop();
      const attempts = connectMock.mock.calls.length;
      await vi.advanceTimersByTimeAsync(60_000);

      expect(connectMock).toHaveBeenCalledTimes(attempts);
    });

    it('does not treat a shutdown disconnect as a failure or schedule a retry', async () => {
      connectMock.mockImplementation(async () => {
        connection.readyState = 1;
      });
      const manager = await loadManager();
      await manager.start();

      closeMock.mockImplementation(async () => {
        connection.readyState = 0;
        emit('disconnected');
      });
      await manager.stop();
      const attempts = connectMock.mock.calls.length;
      await vi.advanceTimersByTimeAsync(60_000);

      expect(manager.status().state).toBe('disconnected');
      expect(manager.status().consecutiveFailures).toBe(0);
      expect(connectMock).toHaveBeenCalledTimes(attempts);
    });

    it('still reports disconnected when close() rejects', async () => {
      connectMock.mockImplementation(async () => {
        connection.readyState = 1;
      });
      const manager = await loadManager();
      await manager.start();

      closeMock.mockRejectedValue(new Error('close failed'));

      // The failure propagates so ApplicationLifecycle can log it...
      await expect(manager.stop()).rejects.toThrow('close failed');
      // ...but the reported state is still the truthful terminal one.
      expect(manager.status().state).toBe('disconnected');
    });
  });
});

import { describe, expect, it, vi } from 'vitest';
import { ApplicationLifecycle } from './application.lifecycle.js';
import type { DependencyState, InfrastructureDependency } from '../dependency.types.js';

type FakeDependency = InfrastructureDependency & {
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
};

/**
 * `start`/`stop` are real spies rather than counters closed over by the factory:
 * a captured primitive is copied at construction time and can never observe a
 * later increment, which is exactly how the previous helper always read zero.
 */
function dependency(
  name: string,
  state: DependencyState = 'connected',
  options: { failOnStop?: boolean } = {}
): FakeDependency {
  let current = state;

  const start = vi.fn(async () => {
    current = 'connected';
  });

  const stop = vi.fn(async () => {
    if (options.failOnStop) throw new Error(`${name} failed to stop`);
    current = 'disconnected';
  });

  return {
    start,
    stop,
    status() {
      return {
        name,
        state: current,
        ready: current === 'connected',
        lastConnectedAt: null,
        lastDisconnectedAt: null,
        consecutiveFailures: 0,
      };
    },
  };
}

describe('ApplicationLifecycle', () => {
  it('starts dependencies and reports readiness', async () => {
    const db = dependency('mongodb', 'disconnected');
    const lifecycle = new ApplicationLifecycle([db]);

    await lifecycle.start();

    expect(db.start).toHaveBeenCalledOnce();
    expect(lifecycle.isReady()).toBe(true);
    expect(lifecycle.statuses()[0]?.state).toBe('connected');
  });

  it('starts dependencies in registration order', async () => {
    const order: string[] = [];
    const track = (name: string): InfrastructureDependency => {
      const dep = dependency(name, 'disconnected');
      dep.start.mockImplementation(async () => {
        order.push(name);
      });
      return dep;
    };

    const lifecycle = new ApplicationLifecycle([track('mongodb'), track('redis'), track('queue')]);

    await lifecycle.start();

    expect(order).toEqual(['mongodb', 'redis', 'queue']);
  });

  it('reports not-ready while any dependency is down', async () => {
    const up = dependency('mongodb', 'connected');
    const down = dependency('redis', 'disconnected');

    expect(new ApplicationLifecycle([up, down]).isReady()).toBe(false);
  });

  it('propagates a start failure the dependency chose not to absorb', async () => {
    const fatal = dependency('queue', 'disconnected');
    fatal.start.mockRejectedValue(new Error('misconfigured'));

    await expect(new ApplicationLifecycle([fatal]).start()).rejects.toThrow('misconfigured');
  });

  it('stops dependencies in reverse order and tolerates stop failures', async () => {
    const order: string[] = [];
    const first = dependency('mongodb');
    const second = dependency('redis');
    const failing = dependency('queue', 'connected', { failOnStop: true });

    for (const [name, dep] of [
      ['mongodb', first],
      ['redis', second],
      ['queue', failing],
    ] as const) {
      const original = dep.stop.getMockImplementation();
      dep.stop.mockImplementation(async () => {
        order.push(name);
        await original?.();
      });
    }

    const lifecycle = new ApplicationLifecycle([first, second, failing]);

    // One dependency throwing must not reject the shutdown as a whole.
    await expect(lifecycle.stop()).resolves.toBeUndefined();

    // 'queue' throws first, and the two registered before it still run.
    expect(order).toEqual(['queue', 'redis', 'mongodb']);
    expect(failing.stop).toHaveBeenCalledOnce();
    expect(second.stop).toHaveBeenCalledOnce();
    expect(first.stop).toHaveBeenCalledOnce();
  });

  it('keeps stopping when a dependency cannot report its own name', async () => {
    const broken = dependency('broken');
    broken.stop.mockRejectedValue(new Error('stop failed'));
    broken.status = () => {
      throw new Error('status unavailable');
    };
    const survivor = dependency('mongodb');

    const lifecycle = new ApplicationLifecycle([survivor, broken]);

    await expect(lifecycle.stop()).resolves.toBeUndefined();
    expect(survivor.stop).toHaveBeenCalledOnce();
  });
});

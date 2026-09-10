import { describe, expect, it, vi } from 'vitest';
import { ApplicationLifecycle } from './application.lifecycle.js';
import type { DependencyState, InfrastructureDependency } from '../dependency.types.js';

function dependency(name: string, state: DependencyState = 'connected'): InfrastructureDependency & { stopCalls: number } {
  let current = state;
  let stopCalls = 0;
  return {
    stopCalls,
    async start() {
      current = 'connected';
    },
    async stop() {
      stopCalls += 1;
      current = 'disconnected';
    },
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

    expect(lifecycle.isReady()).toBe(true);
    expect(lifecycle.statuses()[0]?.state).toBe('connected');
  });

  it('stops dependencies in reverse order and tolerates stop failures', async () => {
    const first = dependency('mongodb');
    const second = dependency('redis');
    const failing: InfrastructureDependency = {
      async start() {},
      async stop() {
        throw new Error('stop failed');
      },
      status() {
        return {
          name: 'queue',
          state: 'connected',
          ready: true,
          lastConnectedAt: null,
          lastDisconnectedAt: null,
          consecutiveFailures: 0,
        };
      },
    };

    const lifecycle = new ApplicationLifecycle([first, second, failing]);
    const spy = vi.spyOn(second, 'stop');

    await expect(lifecycle.stop()).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalledOnce();
    expect(first.stopCalls).toBe(1);
  });
});

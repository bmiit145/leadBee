import { databaseManager } from '../infrastructure/database/database.manager.js';
import type { DependencyStatus } from '../infrastructure/dependency.types.js';

/**
 * Opens the shared connection for a one-shot script — seed, catalogue seed,
 * index sync, smoke test.
 *
 * The API server does *not* use this. It goes through `ApplicationLifecycle`,
 * where an unreachable database is survivable and worth waiting out. A script
 * has nothing to do without one, so this fails fast and says why, rather than
 * letting every subsequent query die on a buffering timeout several seconds
 * later with a much less obvious message.
 */
export async function connectDatabase(): Promise<void> {
  await databaseManager.start();

  const status = databaseManager.status();
  if (status.ready) return;

  // Cancels the pending reconnect too, so the script exits promptly.
  await databaseManager.stop();
  throw new Error(`MongoDB is not reachable — connection state: ${status.state}`);
}

export async function disconnectDatabase(): Promise<void> {
  await databaseManager.stop();
}

/**
 * Health probe for `/health/ready`. Reports the manager's cached view rather
 * than issuing a ping, so a health check never adds load during an incident.
 */
export function databaseState(): { ok: boolean; state: string } {
  const status: DependencyStatus = databaseManager.status();
  return {
    ok: status.ready,
    state: status.state,
  };
}

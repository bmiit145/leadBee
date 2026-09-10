import { databaseManager } from '../infrastructure/database/database.manager.js';
import type { DependencyStatus } from '../infrastructure/dependency.types.js';

export async function connectDatabase(): Promise<void> {
  await databaseManager.start();
}

export async function disconnectDatabase(): Promise<void> {
  await databaseManager.stop();
}

export function databaseState(): { ok: boolean; state: string } {
  const status: DependencyStatus = databaseManager.status();
  return {
    ok: status.ready,
    state: status.state,
  };
}

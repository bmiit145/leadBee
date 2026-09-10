import { logger } from '../../lib/logger.js';
import type { DependencyStatus, InfrastructureDependency } from '../dependency.types.js';

/**
 * Orchestrates infrastructure dependencies. Deliberately knows nothing about
 * any particular dependency: retry policy, recoverability and readiness
 * semantics belong to the dependency itself, so adding Redis, a queue or a mail
 * transport later means implementing `InfrastructureDependency` and nothing here.
 */
export class ApplicationLifecycle {
  private readonly dependencies: InfrastructureDependency[];

  constructor(dependencies: InfrastructureDependency[]) {
    this.dependencies = dependencies;
  }

  /**
   * Starts dependencies in registration order.
   *
   * Errors are *not* swallowed. A dependency decides for itself whether its own
   * failure is recoverable — `DatabaseManager`, for instance, treats an
   * unreachable server as recoverable and returns normally — so anything that
   * still throws here is by definition unrecoverable and should abort the boot.
   */
  async start(): Promise<void> {
    for (const dependency of this.dependencies) {
      await dependency.start();
    }
  }

  /**
   * Stops dependencies in reverse registration order, so a dependency is only
   * torn down after everything that might use it. Every dependency is attempted
   * even if an earlier one fails; failures are logged, never rethrown.
   */
  async stop(): Promise<void> {
    for (const dependency of [...this.dependencies].reverse()) {
      const name = this.nameOf(dependency);
      try {
        await dependency.stop();
      } catch (err) {
        logger.error({ err, dependency: name }, 'failed to stop infrastructure dependency');
      }
    }
  }

  statuses(): DependencyStatus[] {
    return this.dependencies.map((dependency) => dependency.status());
  }

  isReady(): boolean {
    return this.dependencies.every((dependency) => dependency.status().ready);
  }

  /** Resolved before `stop()` so a broken `status()` cannot abandon the loop. */
  private nameOf(dependency: InfrastructureDependency): string {
    try {
      return dependency.status().name;
    } catch {
      return 'unknown';
    }
  }
}

import { logger } from '../../lib/logger.js';
import type { DependencyStatus, InfrastructureDependency } from '../dependency.types.js';

export class ApplicationLifecycle {
  private readonly dependencies: InfrastructureDependency[];

  constructor(dependencies: InfrastructureDependency[]) {
    this.dependencies = dependencies;
  }

  async start(): Promise<void> {
    for (const dependency of this.dependencies) {
      await dependency.start();
    }
  }

  async stop(): Promise<void> {
    for (const dependency of [...this.dependencies].reverse()) {
      try {
        await dependency.stop();
      } catch (err) {
        logger.error({ err, dependency: dependency.status().name }, 'failed to stop infrastructure dependency');
      }
    }
  }

  statuses(): DependencyStatus[] {
    return this.dependencies.map((dependency) => dependency.status());
  }

  isReady(): boolean {
    return this.dependencies.every((dependency) => dependency.status().ready);
  }
}

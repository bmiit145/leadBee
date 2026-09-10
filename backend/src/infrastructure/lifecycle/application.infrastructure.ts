import { databaseManager } from '../database/database.manager.js';
import { ApplicationLifecycle } from './application.lifecycle.js';

/**
 * Single application-wide infrastructure registry.
 *
 * Dependencies are registered here once so startup, readiness and shutdown all
 * observe the same lifecycle. Adding Redis, queues, storage, etc. means adding
 * the dependency here rather than teaching server.ts or health routes about it.
 */
export const applicationLifecycle = new ApplicationLifecycle([databaseManager]);

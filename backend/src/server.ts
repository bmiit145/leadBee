import closeWithGrace from 'close-with-grace';
import { buildApp } from './app.js';
import { env } from './config/env.js';
import { databaseManager } from './infrastructure/database/database.manager.js';
import { applicationLifecycle } from './infrastructure/lifecycle/application.infrastructure.js';
import { logger } from './lib/logger.js';
import { registerModuleManifests } from './entitlements/registry.js';
import './models/index.js';

let catalogueRun: Promise<void> | null = null;

/**
 * Registers the entitlement catalogue, if the database is reachable.
 *
 * `registerModuleManifests()` is already idempotent and safe to run
 * concurrently across instances — every instance upserts the same values. This
 * guard is narrower and process-local on purpose: it stops a flapping
 * connection from stacking redundant registration jobs inside *this* process.
 * It is not, and must not be mistaken for, a distributed lock.
 */
async function registerCatalogue(reason: string): Promise<void> {
  if (!databaseManager.status().ready) {
    logger.warn({ reason }, 'entitlement catalogue registration deferred — database unavailable');
    return;
  }

  if (catalogueRun) {
    logger.debug({ reason }, 'entitlement catalogue registration already in flight');
    return catalogueRun;
  }

  catalogueRun = (async () => {
    try {
      await registerModuleManifests();
    } catch (err) {
      // Never fatal. The next 'connected' transition retries it, and an
      // instance running against an already-registered catalogue is fine.
      logger.error({ err, reason }, 'entitlement catalogue registration failed');
    }
  })().finally(() => {
    catalogueRun = null;
  });

  return catalogueRun;
}

async function main(): Promise<void> {
  const app = await buildApp();

  // The HTTP process is independent from transient infrastructure reachability.
  // Readiness reflects dependency state; liveness remains available so an
  // orchestrator does not restart a process that can recover in place.
  await applicationLifecycle.start();

  // Subscribed *after* the first attempt so a healthy boot registers once, not
  // twice — the initial 'connected' transition has already been published by
  // this point, and the explicit call below covers it.
  databaseManager.onLifecycleChange((status) => {
    if (status.state !== 'connected') return;
    void registerCatalogue('database-connected');
  });

  await registerCatalogue('startup');

  await app.listen({ port: env.PORT, host: env.HOST });

  logger.info(
    { port: env.PORT, env: env.NODE_ENV },
    env.isProduction ? 'LeadBee API listening' : `LeadBee API → http://localhost:${env.PORT}/docs`
  );

  closeWithGrace({ delay: 10_000 }, async ({ signal, err }) => {
    if (err) logger.error({ err }, 'shutting down after error');
    else logger.info({ signal }, 'shutting down');

    // Stop accepting new HTTP work before tearing down infrastructure. The
    // shared lifecycle owns every dependency, so future additions such as
    // Redis/queues/storage automatically participate in graceful shutdown.
    await app.close();
    await applicationLifecycle.stop();
  });
}

main().catch((err) => {
  logger.fatal({ err }, 'failed to start');
  process.exit(1);
});

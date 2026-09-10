import closeWithGrace from 'close-with-grace';
import { buildApp } from './app.js';
import { env } from './config/env.js';
import { disconnectDatabase } from './config/database.js';
import { databaseManager } from './infrastructure/database/database.manager.js';
import { ApplicationLifecycle } from './infrastructure/lifecycle/application.lifecycle.js';
import { logger } from './lib/logger.js';
import { registerModuleManifests } from './entitlements/registry.js';
import './models/index.js';

async function main(): Promise<void> {
  const lifecycle = new ApplicationLifecycle([databaseManager]);
  const app = await buildApp();

  // The HTTP process is independent from transient infrastructure reachability.
  // Readiness reflects dependency state; liveness remains available so an
  // orchestrator does not restart a process that can recover in place.
  await lifecycle.start();

  if (databaseManager.status().ready) {
    await registerModuleManifests();
  } else {
    logger.warn('MongoDB unavailable at boot; entitlement catalogue registration deferred');
  }

  await app.listen({ port: env.PORT, host: env.HOST });

  logger.info(
    { port: env.PORT, env: env.NODE_ENV },
    env.isProduction ? 'LeadBee API listening' : `LeadBee API → http://localhost:${env.PORT}/docs`
  );

  closeWithGrace({ delay: 10_000 }, async ({ signal, err }) => {
    if (err) logger.error({ err }, 'shutting down after error');
    else logger.info({ signal }, 'shutting down');

    await app.close();
    await disconnectDatabase();
  });
}

main().catch((err) => {
  logger.fatal({ err }, 'failed to start');
  process.exit(1);
});

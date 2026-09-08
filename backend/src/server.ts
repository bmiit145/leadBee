import closeWithGrace from 'close-with-grace';
import { buildApp } from './app.js';
import { env } from './config/env.js';
import { connectDatabase, disconnectDatabase } from './config/database.js';
import { logger } from './lib/logger.js';

async function main(): Promise<void> {
  // The database comes up before the listener, so the process never accepts a
  // request it cannot serve — a readiness probe passing while every query fails
  // is worse than a slower start.
  await connectDatabase();

  const app = await buildApp();
  await app.listen({ port: env.PORT, host: env.HOST });

  logger.info(
    { port: env.PORT, env: env.NODE_ENV },
    env.isProduction ? 'LeadBee API listening' : `LeadBee API → http://localhost:${env.PORT}/docs`
  );

  /**
   * Stop taking new connections, let in-flight requests finish, then close the
   * database. Killing the pool first would fail requests that were already
   * accepted and would have succeeded.
   */
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

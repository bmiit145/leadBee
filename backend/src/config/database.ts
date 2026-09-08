import mongoose from 'mongoose';
import { env } from './env.js';
import { logger } from '../lib/logger.js';

/**
 * Connection settings tuned for a shared multi-tenant cluster.
 *
 * The pool is sized generously because every request does at least one read and
 * tenants are not coordinated — bursts overlap. `maxTimeMS` on the driver keeps a
 * single pathological query from holding a connection forever and starving the
 * rest of the pool, which is how one tenant takes down everyone else.
 */
export async function connectDatabase(): Promise<void> {
  mongoose.set('strictQuery', true);

  // A populate() that quietly fires N queries per row is the usual cause of a
  // slow list endpoint. Opt in with MONGO_DEBUG=true when chasing one — it is
  // not on by default because the hook is synchronous and per-operation, so it
  // distorts the very timings it is meant to explain.
  if (env.MONGO_DEBUG) {
    mongoose.set('debug', (collection: string, method: string, query: unknown) => {
      logger.debug({ collection, method, query }, 'mongo');
    });
  }

  mongoose.connection.on('connected', () => logger.info('MongoDB connected'));
  mongoose.connection.on('error', (err) => logger.error({ err }, 'MongoDB error'));
  mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'));

  /**
   * Index building is a deploy-time operation, not a boot-time one — it runs
   * from `npm run sync-indexes`, in every environment.
   *
   * This must be set BEFORE connect(): Mongoose kicks off index builds for
   * already-registered models as soon as the connection opens, so setting it
   * afterwards races the behaviour it is meant to control.
   *
   * It stays off in development too. Building every index on boot floods the
   * event loop for several seconds, during which load shedding rejects each
   * incoming request with a 503 — a failure that looks like a broken API and
   * has nothing to do with the code under test. Development matching production
   * is worth more here than the convenience of implicit index creation.
   */
  mongoose.set('autoIndex', false);

  await mongoose.connect(env.MONGODB_URI, {
    maxPoolSize: env.MONGODB_MAX_POOL_SIZE,
    minPoolSize: env.MONGODB_MIN_POOL_SIZE,
    serverSelectionTimeoutMS: 10_000,
    socketTimeoutMS: 45_000,
    // Reads that can tolerate a moment of staleness should be routed off the
    // primary once there are secondaries; the default stays primary so that
    // read-your-own-write behaviour is not surprising.
    retryWrites: true,
    retryReads: true,
  });
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.connection.close(false);
  logger.info('MongoDB connection closed');
}

/**
 * Health probe for `/health`. Reports the driver's view rather than issuing a
 * ping, so a health check never adds load during an incident.
 */
export function databaseState(): { ok: boolean; state: string } {
  // A Record rather than a tuple: the driver also reports 99 ("uninitialized"),
  // which a fixed-length tuple has no slot for.
  const states: Record<number, string> = {
    0: 'disconnected',
    1: 'connected',
    2: 'connecting',
    3: 'disconnecting',
    99: 'uninitialized',
  };
  const readyState = mongoose.connection.readyState;
  return {
    ok: readyState === 1,
    state: states[readyState] ?? 'unknown',
  };
}

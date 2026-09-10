import mongoose from 'mongoose';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import type { DependencyStatus, DependencyState, InfrastructureDependency } from '../dependency.types.js';

export type DatabaseLifecycleListener = (status: DependencyStatus) => void;

/**
 * Owns MongoDB lifecycle state while leaving actual connection recovery to
 * Mongoose/MongoDB driver's topology management.
 */
class DatabaseManager implements InfrastructureDependency {
  private state: DependencyState = 'uninitialized';
  private lastConnectedAt: string | null = null;
  private lastDisconnectedAt: string | null = null;
  private consecutiveFailures = 0;
  private listenersBound = false;
  private readonly lifecycleListeners = new Set<DatabaseLifecycleListener>();

  async start(): Promise<void> {
    this.configure();
    this.bindListeners();

    if (mongoose.connection.readyState === 1) {
      this.markConnected();
      return;
    }

    this.state = 'connecting';
    this.publish();

    try {
      await mongoose.connect(env.MONGODB_URI, {
        maxPoolSize: env.MONGODB_MAX_POOL_SIZE,
        minPoolSize: env.MONGODB_MIN_POOL_SIZE,
        serverSelectionTimeoutMS: 10_000,
        socketTimeoutMS: 45_000,
        retryWrites: true,
        retryReads: true,
      });
      // The driver's `connected` event also calls markConnected(). Do not emit
      // a second lifecycle transition here when that event has already fired.
      if (this.state !== 'connected') this.markConnected();
    } catch (err) {
      this.markDisconnected(err);
      // Do not throw transient infrastructure failure back through application
      // bootstrap. The driver remains responsible for topology recovery.
    }
  }

  async stop(): Promise<void> {
    if (mongoose.connection.readyState === 0) {
      this.state = 'disconnected';
      this.publish();
      return;
    }

    this.state = 'disconnecting';
    this.publish();
    await mongoose.connection.close(false);
    this.state = 'disconnected';
    this.publish();
    logger.info('MongoDB connection closed');
  }

  status(): DependencyStatus {
    return {
      name: 'mongodb',
      state: this.state,
      ready: this.state === 'connected',
      lastConnectedAt: this.lastConnectedAt,
      lastDisconnectedAt: this.lastDisconnectedAt,
      consecutiveFailures: this.consecutiveFailures,
    };
  }

  onLifecycleChange(listener: DatabaseLifecycleListener): () => void {
    this.lifecycleListeners.add(listener);
    return () => this.lifecycleListeners.delete(listener);
  }

  private configure(): void {
    mongoose.set('strictQuery', true);
    mongoose.set('autoIndex', false);

    if (env.MONGO_DEBUG) {
      mongoose.set('debug', (collection: string, method: string, query: unknown) => {
        logger.debug({ collection, method, query }, 'mongo');
      });
    }
  }

  private bindListeners(): void {
    if (this.listenersBound) return;
    this.listenersBound = true;

    mongoose.connection.on('connected', () => this.markConnected());
    mongoose.connection.on('error', (err) => {
      this.state = 'degraded';
      this.publish();
      logger.error({ err }, 'MongoDB error');
    });
    mongoose.connection.on('disconnected', () => {
      this.markDisconnected();
      logger.warn('MongoDB disconnected; waiting for driver recovery');
    });
  }

  private markConnected(): void {
    this.state = 'connected';
    this.consecutiveFailures = 0;
    this.lastConnectedAt = new Date().toISOString();
    this.publish();
    logger.info('MongoDB connected');
  }

  private markDisconnected(err?: unknown): void {
    this.state = 'disconnected';
    this.consecutiveFailures += 1;
    this.lastDisconnectedAt = new Date().toISOString();
    this.publish();
    if (err) logger.error({ err, consecutiveFailures: this.consecutiveFailures }, 'MongoDB initial connection failed');
  }

  private publish(): void {
    const status = this.status();
    for (const listener of this.lifecycleListeners) {
      try {
        listener(status);
      } catch (err) {
        logger.error({ err }, 'database lifecycle listener failed');
      }
    }
  }
}

export const databaseManager = new DatabaseManager();
import mongoose from 'mongoose';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import type { DependencyStatus, DependencyState, InfrastructureDependency } from '../dependency.types.js';

export type DatabaseLifecycleListener = (status: DependencyStatus) => void;

/**
 * Backoff bounds for the *initial* connection only — see `scheduleRetry()`.
 */
const INITIAL_RETRY_BASE_MS = 1_000;
const INITIAL_RETRY_MAX_MS = 30_000;

/** Floor between two full error dumps, so an outage cannot flood the log. */
const ERROR_LOG_INTERVAL_MS = 30_000;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** `mongoose.connection.readyState` values this class cares about. */
const READY_STATE = { disconnected: 0, connected: 1 } as const;

function backoffDelay(attempt: number): number {
  const ceiling = Math.min(INITIAL_RETRY_BASE_MS * 2 ** Math.max(attempt - 1, 0), INITIAL_RETRY_MAX_MS);
  // Half jitter. Every instance loses Mongo at the same moment and would
  // otherwise retry in lockstep, hammering the cluster exactly as it recovers.
  return Math.round(ceiling / 2 + Math.random() * (ceiling / 2));
}

/**
 * Host and database only. The URI carries credentials, so it is never logged.
 */
function safeTarget(uri: string): string {
  try {
    const url = new URL(uri);
    return `${url.host}${url.pathname}`;
  } catch {
    return 'unparseable-uri';
  }
}

/**
 * Owns MongoDB configuration, connection lifecycle state and readiness.
 *
 * **Division of responsibility with the driver.** Once a connection has been
 * established the driver's topology monitor owns recovery: it reconnects on its
 * own and Mongoose re-emits `connected`, so this class only observes. The
 * initial connect is the exception — `Connection.prototype.openUri()` rejects,
 * sets `readyState` to disconnected and never retries, leaving the process
 * permanently unusable — so a bounded, jittered retry runs until the first
 * successful connect and then stands down for good.
 */
class DatabaseManager implements InfrastructureDependency {
  private state: DependencyState = 'uninitialized';
  private lastConnectedAt: string | null = null;
  private lastDisconnectedAt: string | null = null;
  private consecutiveFailures = 0;
  private listenersBound = false;
  private everConnected = false;
  private stopping = false;
  private connectAttempt = 0;
  private retryTimer: NodeJS.Timeout | null = null;
  private lastErrorLoggedAt = 0;
  private readonly lifecycleListeners = new Set<DatabaseLifecycleListener>();

  /**
   * Resolves once the first connection attempt has been made — successful or
   * not. A failure is deliberately not rethrown: the API process stays up and
   * serves liveness while readiness reports the outage.
   */
  async start(): Promise<void> {
    this.stopping = false;
    this.configure();
    this.bindListeners();
    await this.attemptConnect();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    this.clearRetry();

    if (this.isDriverDisconnected()) {
      this.transition('disconnected');
      return;
    }

    this.transition('disconnecting');
    try {
      await mongoose.connection.close(false);
      logger.info('MongoDB connection closed');
    } finally {
      // Report the terminal state even if close() rejected. The caller logs the
      // failure; a status stuck on 'disconnecting' would help nobody.
      this.transition('disconnected');
    }
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
    return () => {
      this.lifecycleListeners.delete(listener);
    };
  }

  /**
   * Read fresh on every call. The driver mutates `readyState` asynchronously,
   * so a value observed before an `await` says nothing about the state after it.
   */
  private isDriverConnected(): boolean {
    return mongoose.connection.readyState === READY_STATE.connected;
  }

  private isDriverDisconnected(): boolean {
    return mongoose.connection.readyState === READY_STATE.disconnected;
  }

  private async attemptConnect(): Promise<void> {
    if (this.stopping) return;

    if (this.isDriverConnected()) {
      this.markConnected();
      return;
    }

    this.connectAttempt += 1;
    this.transition('connecting');
    logger.info(
      { target: safeTarget(env.MONGODB_URI), attempt: this.connectAttempt },
      'MongoDB connection attempt'
    );

    try {
      await mongoose.connect(env.MONGODB_URI, {
        maxPoolSize: env.MONGODB_MAX_POOL_SIZE,
        minPoolSize: env.MONGODB_MIN_POOL_SIZE,
        serverSelectionTimeoutMS: 10_000,
        socketTimeoutMS: 45_000,
        retryWrites: true,
        retryReads: true,
      });
    } catch (err) {
      this.consecutiveFailures += 1;
      this.markNotConnected();
      this.logConnectFailure(err);
      this.scheduleRetry();
      return;
    }

    // `connect()` resolving is not on its own proof of a usable connection —
    // only `readyState` is. The driver's `connected` event normally lands first,
    // in which case `transition()` collapses this into a no-op.
    if (this.isDriverConnected()) this.markConnected();
    else this.scheduleRetry();
  }

  /**
   * Queues one retry of the *initial* connect. No-op once a connection has
   * existed: from that point the driver's topology monitor is doing this job,
   * and a second loop competing with it would only multiply connection churn.
   */
  private scheduleRetry(): void {
    if (this.everConnected || this.stopping) return;
    if (this.retryTimer) return;
    // A non-disconnected readyState means a connect is still in flight; it will
    // resolve into `connected` or into the error handler, which reschedules.
    if (!this.isDriverDisconnected()) return;

    const delayMs = backoffDelay(this.connectAttempt);
    logger.warn({ delayMs, attempt: this.connectAttempt }, 'retrying MongoDB connection');

    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.attemptConnect();
    }, delayMs);
    // A pending retry must never be the reason the process refuses to exit.
    this.retryTimer.unref();
  }

  private clearRetry(): void {
    if (!this.retryTimer) return;
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
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

    mongoose.connection.on('connected', () => {
      this.markConnected();
    });

    mongoose.connection.on('error', (err: unknown) => {
      // Shares the gate with `logConnectFailure`: a failed connect emits both,
      // describing one failure, and one full dump of it is enough.
      if (this.shouldLogFullError()) logger.error({ err }, 'MongoDB error');
      if (this.stopping) return;
      // An error on a live connection is not automatically fatal — a single
      // failed operation does not mean the topology is gone. Trust readyState.
      if (this.isDriverConnected()) return;
      this.markNotConnected();
      this.scheduleRetry();
    });

    mongoose.connection.on('disconnected', () => {
      if (this.stopping) {
        this.transition('disconnected');
        return;
      }
      const changed = this.markNotConnected();
      // Only once a connection has existed, which is the case where the driver's
      // topology monitor owns recovery. A failed *initial* attempt also emits
      // this event, and `logConnectFailure` already reports that far better.
      if (changed && this.everConnected) logger.warn('MongoDB disconnected; awaiting driver recovery');
      this.scheduleRetry();
    });
  }

  private markConnected(): void {
    this.clearRetry();
    const recovered = this.everConnected;
    this.everConnected = true;
    this.consecutiveFailures = 0;
    this.connectAttempt = 0;

    if (this.state === 'connected') return;
    this.lastConnectedAt = new Date().toISOString();
    this.state = 'connected';
    this.publish();
    logger.info(recovered ? 'MongoDB recovery complete' : 'MongoDB connected');
  }

  /**
   * Not connected. Reported as 'degraded' once a connection has existed, since
   * the driver is actively recovering it, and as 'disconnected' before that.
   * Either way readiness is false. Returns whether the state actually changed.
   */
  private markNotConnected(): boolean {
    const next: DependencyState = this.everConnected ? 'degraded' : 'disconnected';
    if (this.state === next) return false;
    this.lastDisconnectedAt = new Date().toISOString();
    this.transition(next);
    return true;
  }

  private logConnectFailure(err: unknown): void {
    const context = { attempt: this.connectAttempt, consecutiveFailures: this.consecutiveFailures };

    if (this.shouldLogFullError()) {
      logger.error({ err, ...context }, 'MongoDB connection attempt failed');
      return;
    }

    // A retry failing the same way is expected-but-notable during an outage, so
    // `warn` per ENG-14 — and one line, not another full topology dump.
    logger.warn({ ...context, reason: errorMessage(err) }, 'MongoDB connection attempt failed');
  }

  /** True at most once per interval, so a prolonged outage cannot flood the log. */
  private shouldLogFullError(): boolean {
    const now = Date.now();
    if (now - this.lastErrorLoggedAt < ERROR_LOG_INTERVAL_MS) return false;
    this.lastErrorLoggedAt = now;
    return true;
  }

  private transition(next: DependencyState): void {
    if (this.state === next) return;
    this.state = next;
    this.publish();
  }

  private publish(): void {
    const status = this.status();
    for (const listener of this.lifecycleListeners) {
      try {
        listener(status);
      } catch (err) {
        // A misbehaving observer must not break the lifecycle it observes.
        logger.error({ err }, 'database lifecycle listener failed');
      }
    }
  }
}

export const databaseManager = new DatabaseManager();

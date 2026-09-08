import axios from 'axios';
import { API_BASE_URL } from './api';

/**
 * Server reachability, checked before the app lets anyone in.
 *
 * Its own axios instance with a short timeout: this runs on the startup path,
 * and a server that is down should be reported in seconds, not after the
 * standard 15-second request timeout has elapsed.
 */
const healthApi = axios.create({
  baseURL: API_BASE_URL,
  timeout: 5000,
  headers: { 'Content-Type': 'application/json' },
});

export type ServerStatus = 'checking' | 'healthy' | 'unreachable' | 'database_down';

export const systemService = {
  async getServerHealth(maxRetries = 1): Promise<{ status: ServerStatus; detail?: string }> {
    let attempt = 0;

    while (attempt <= maxRetries) {
      try {
        // Readiness, not liveness: the app needs the database, so a process
        // that is up but cannot reach Mongo is not usable.
        const { data, status } = await healthApi.get('/health/ready');

        if (status === 200 && data?.status === 'ready') {
          return { status: 'healthy' };
        }

        if (data?.database && data.database !== 'connected') {
          return { status: 'database_down', detail: 'Database connection failed' };
        }

        return { status: 'unreachable' };
      } catch (error: any) {
        attempt += 1;
        const isLastAttempt = attempt > maxRetries;

        if (__DEV__) {
          console.warn(`[Health] attempt ${attempt} failed:`, error.message);
        }

        if (!isLastAttempt) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
          continue;
        }

        // 503 from readiness means the process is alive but its database is
        // not — a materially different problem from "cannot reach the server",
        // and worth telling the user apart.
        if (error.response?.status === 503) {
          const dbStatus = error.response.data?.database;
          if (dbStatus && dbStatus !== 'connected') {
            return { status: 'database_down', detail: 'Database is temporarily unavailable' };
          }
        }

        return { status: 'unreachable', detail: error.message };
      }
    }

    return { status: 'unreachable' };
  },
};

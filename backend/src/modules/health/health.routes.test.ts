import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';

const statusesMock = vi.fn();
const isReadyMock = vi.fn();

vi.mock('../../infrastructure/lifecycle/application.infrastructure.js', () => ({
  applicationLifecycle: {
    statuses: () => statusesMock(),
    isReady: () => isReadyMock(),
  },
}));

async function buildHealthApp() {
  const { healthRoutes } = await import('./health.routes.js');
  const app = Fastify().withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(healthRoutes, { prefix: '/api/v1' });
  await app.ready();
  return app;
}

describe('health routes', () => {
  let app: Awaited<ReturnType<typeof buildHealthApp>>;

  beforeEach(async () => {
    vi.resetModules();
    statusesMock.mockReset();
    isReadyMock.mockReset();
    statusesMock.mockReturnValue([{
      name: 'mongodb',
      state: 'connected',
      ready: true,
      lastConnectedAt: null,
      lastDisconnectedAt: null,
      consecutiveFailures: 0,
    }]);
    isReadyMock.mockReturnValue(true);
    app = await buildHealthApp();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('GET /api/v1/health (liveness)', () => {
    it('answers 200 while the process is alive', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/health' });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ status: 'ok' });
    });

    it('stays 200 while infrastructure is unavailable', async () => {
      isReadyMock.mockReturnValue(false);
      statusesMock.mockReturnValue([{
        name: 'mongodb',
        state: 'disconnected',
        ready: false,
        lastConnectedAt: null,
        lastDisconnectedAt: new Date().toISOString(),
        consecutiveFailures: 2,
      }]);

      const res = await app.inject({ method: 'GET', url: '/api/v1/health' });

      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe('ok');
    });

    it('does not consult infrastructure at all', async () => {
      await app.inject({ method: 'GET', url: '/api/v1/health' });

      expect(statusesMock).not.toHaveBeenCalled();
      expect(isReadyMock).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/v1/health/ready (readiness)', () => {
    it('answers 200 when every required dependency is ready', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/health/ready' });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        status: 'ready',
        dependencies: {
          mongodb: { state: 'connected', ready: true, consecutiveFailures: 0 },
        },
      });
    });

    it('answers 503 when a required dependency is unavailable', async () => {
      isReadyMock.mockReturnValue(false);
      statusesMock.mockReturnValue([{
        name: 'mongodb',
        state: 'disconnected',
        ready: false,
        lastConnectedAt: null,
        lastDisconnectedAt: new Date().toISOString(),
        consecutiveFailures: 3,
      }]);

      const res = await app.inject({ method: 'GET', url: '/api/v1/health/ready' });

      expect(res.statusCode).toBe(503);
      expect(res.json()).toEqual({
        status: 'not-ready',
        dependencies: {
          mongodb: { state: 'disconnected', ready: false, consecutiveFailures: 3 },
        },
      });
    });

    it('answers 503 while degraded, and recovers to 200 without a restart', async () => {
      isReadyMock.mockReturnValue(false);
      statusesMock.mockReturnValue([{
        name: 'mongodb',
        state: 'degraded',
        ready: false,
        lastConnectedAt: new Date().toISOString(),
        lastDisconnectedAt: new Date().toISOString(),
        consecutiveFailures: 1,
      }]);
      expect((await app.inject({ method: 'GET', url: '/api/v1/health/ready' })).statusCode).toBe(503);

      isReadyMock.mockReturnValue(true);
      statusesMock.mockReturnValue([{
        name: 'mongodb',
        state: 'connected',
        ready: true,
        lastConnectedAt: new Date().toISOString(),
        lastDisconnectedAt: new Date().toISOString(),
        consecutiveFailures: 0,
      }]);
      expect((await app.inject({ method: 'GET', url: '/api/v1/health/ready' })).statusCode).toBe(200);
    });

    it('reflects multiple infrastructure dependencies without route changes', async () => {
      statusesMock.mockReturnValue([
        {
          name: 'mongodb',
          state: 'connected',
          ready: true,
          lastConnectedAt: null,
          lastDisconnectedAt: null,
          consecutiveFailures: 0,
        },
        {
          name: 'redis',
          state: 'degraded',
          ready: false,
          lastConnectedAt: null,
          lastDisconnectedAt: null,
          consecutiveFailures: 4,
        },
      ]);
      isReadyMock.mockReturnValue(false);

      const res = await app.inject({ method: 'GET', url: '/api/v1/health/ready' });

      expect(res.statusCode).toBe(503);
      expect(res.json().dependencies.redis).toEqual({
        state: 'degraded',
        ready: false,
        consecutiveFailures: 4,
      });
    });

    it('uses in-memory lifecycle state rather than querying dependencies per request', async () => {
      await app.inject({ method: 'GET', url: '/api/v1/health/ready' });
      await app.inject({ method: 'GET', url: '/api/v1/health/ready' });

      expect(statusesMock).toHaveBeenCalledTimes(2);
      expect(isReadyMock).toHaveBeenCalledTimes(2);
    });
  });
});

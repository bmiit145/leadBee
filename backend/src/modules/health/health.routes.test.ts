import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';

const databaseStateMock = vi.fn<[], { ok: boolean; state: string }>();

vi.mock('../../config/database.js', () => ({
  databaseState: () => databaseStateMock(),
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
    databaseStateMock.mockReset();
    databaseStateMock.mockReturnValue({ ok: true, state: 'connected' });
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

    it('stays 200 while MongoDB is unavailable', async () => {
      // Liveness must never fail on a dependency outage, or the orchestrator
      // restarts a process that would have recovered in place.
      databaseStateMock.mockReturnValue({ ok: false, state: 'disconnected' });

      const res = await app.inject({ method: 'GET', url: '/api/v1/health' });

      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe('ok');
    });

    it('does not consult the database at all', async () => {
      await app.inject({ method: 'GET', url: '/api/v1/health' });

      expect(databaseStateMock).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/v1/health/ready (readiness)', () => {
    it('answers 200 when MongoDB is connected', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/health/ready' });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ status: 'ready', database: 'connected' });
    });

    it('answers 503 when MongoDB is unavailable', async () => {
      databaseStateMock.mockReturnValue({ ok: false, state: 'disconnected' });

      const res = await app.inject({ method: 'GET', url: '/api/v1/health/ready' });

      expect(res.statusCode).toBe(503);
      expect(res.json()).toEqual({ status: 'not-ready', database: 'disconnected' });
    });

    it('answers 503 while degraded, and recovers to 200 without a restart', async () => {
      databaseStateMock.mockReturnValue({ ok: false, state: 'degraded' });
      expect((await app.inject({ method: 'GET', url: '/api/v1/health/ready' })).statusCode).toBe(503);

      databaseStateMock.mockReturnValue({ ok: true, state: 'connected' });
      expect((await app.inject({ method: 'GET', url: '/api/v1/health/ready' })).statusCode).toBe(200);
    });

    it('reads cached state rather than querying MongoDB per request', async () => {
      await app.inject({ method: 'GET', url: '/api/v1/health/ready' });
      await app.inject({ method: 'GET', url: '/api/v1/health/ready' });

      // One cheap in-memory status read per request, no database round trip.
      expect(databaseStateMock).toHaveBeenCalledTimes(2);
    });
  });
});

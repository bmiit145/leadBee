import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { applicationLifecycle } from '../../infrastructure/lifecycle/application.infrastructure.js';

const dependencySchema = z.object({
  state: z.string(),
  ready: z.boolean(),
  consecutiveFailures: z.number(),
});

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  /**
   * Liveness. Answers "is this process running" and nothing else, so a
   * transient infrastructure outage never causes the orchestrator to kill and
   * restart a healthy process that can recover in place.
   */
  r.route({
    method: 'GET',
    url: '/health',
    schema: {
      tags: ['health'],
      response: {
        200: z.object({
          status: z.literal('ok'),
          timestamp: z.string(),
          uptime: z.number(),
        }),
      },
    },
    handler: async () => ({
      status: 'ok' as const,
      timestamp: new Date().toISOString(),
      uptime: Math.round(process.uptime()),
    }),
  });

  /**
   * Readiness. Uses the same application-wide dependency registry as startup
   * and shutdown. Adding another required infrastructure dependency therefore
   * updates readiness automatically without coupling this route to that service.
   */
  r.route({
    method: 'GET',
    url: '/health/ready',
    schema: {
      tags: ['health'],
      response: {
        200: z.object({
          status: z.literal('ready'),
          dependencies: z.record(dependencySchema),
        }),
        503: z.object({
          status: z.literal('not-ready'),
          dependencies: z.record(dependencySchema),
        }),
      },
    },
    handler: async (_request, reply) => {
      const statuses = applicationLifecycle.statuses();
      const dependencies = Object.fromEntries(
        statuses.map((dependency) => [dependency.name, {
          state: dependency.state,
          ready: dependency.ready,
          consecutiveFailures: dependency.consecutiveFailures,
        }])
      );
      const ready = applicationLifecycle.isReady();

      return reply.status(ready ? 200 : 503).send({
        status: ready ? 'ready' : 'not-ready',
        dependencies,
      });
    },
  });
}

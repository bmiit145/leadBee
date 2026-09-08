import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { databaseState } from '../../config/database.js';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  /**
   * Liveness. Answers "is this process running" and nothing else, so a database
   * blip never causes the orchestrator to kill and restart a healthy process
   * that would have recovered on its own.
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
   * Readiness. Answers "can this process serve traffic", which does depend on
   * the database — a 503 here pulls the instance out of the load balancer
   * without restarting it.
   */
  r.route({
    method: 'GET',
    url: '/health/ready',
    schema: {
      tags: ['health'],
      response: {
        200: z.object({ status: z.string(), database: z.string() }),
        503: z.object({ status: z.string(), database: z.string() }),
      },
    },
    handler: async (_request, reply) => {
      const db = databaseState();
      return reply
        .status(db.ok ? 200 : 503)
        .send({ status: db.ok ? 'ready' : 'not-ready', database: db.state });
    },
  });
}

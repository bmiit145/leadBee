import Fastify from 'fastify';
import sensible from '@fastify/sensible';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { randomUUID } from 'node:crypto';

import { logger } from './lib/logger.js';

import { errorHandlerPlugin } from './plugins/errorHandler.js';
import { securityPlugin } from './plugins/security.js';
import { authPlugin } from './plugins/auth.js';
import { swaggerPlugin } from './plugins/swagger.js';

// Importing the barrel registers every schema with Mongoose up front, so a
// populate() never fails on a model that simply had not been imported yet.
import './models/index.js';

import { healthRoutes } from './modules/health/health.routes.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { signupRoutes } from './modules/signup/signup.routes.js';
import { leadRoutes } from './modules/leads/lead.routes.js';
import { taskRoutes } from './modules/tasks/task.routes.js';
import { meetingRoutes } from './modules/meetings/meeting.routes.js';
import { userRoutes } from './modules/users/user.routes.js';
import { roleRoutes } from './modules/roles/role.routes.js';
import { lookupRoutes } from './modules/lookups/lookup.routes.js';
import { notificationRoutes } from './modules/notifications/notification.routes.js';
import { platformRoutes } from './modules/platform/platform.routes.js';
import { catalogRoutes } from './modules/platform/catalog.routes.js';

export const API_PREFIX = '/api/v1';

/**
 * The return type is inferred rather than annotated as `FastifyInstance`.
 * Passing a concrete pino instance and a type provider both narrow the
 * instance's generics, and the bare `FastifyInstance` alias does not match
 * either — annotating it fights the library for no benefit.
 */
export async function buildApp() {
  const app = Fastify({
    loggerInstance: logger,
    // Every response carries this back as `requestId`. When a customer reports
    // an error, that string is the only thing needed to find the exact log line.
    genReqId: (req) => (req.headers['x-request-id'] as string) || randomUUID(),
    requestIdHeader: 'x-request-id',
    trustProxy: true,
    // Fastify's default is 1MB. Lead payloads are small; a bigger ceiling only
    // widens the window for a memory-pressure attack.
    bodyLimit: 1_048_576,
    ajv: { customOptions: { removeAdditional: 'all' } },
  }).withTypeProvider<ZodTypeProvider>();

  // zod validates requests and serialises responses, so the OpenAPI document
  // and the runtime checks come from one source.
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(sensible);
  await app.register(errorHandlerPlugin);
  await app.register(securityPlugin);
  await app.register(authPlugin);
  await app.register(swaggerPlugin);

  // ─── Routes ─────────────────────────────────────────────────────────────────
  await app.register(healthRoutes, { prefix: API_PREFIX });

  // Tenant realm.
  await app.register(authRoutes, { prefix: `${API_PREFIX}/auth` });
  await app.register(signupRoutes, { prefix: `${API_PREFIX}/signup` });
  await app.register(leadRoutes, { prefix: `${API_PREFIX}/leads` });
  await app.register(taskRoutes, { prefix: `${API_PREFIX}/tasks` });
  await app.register(meetingRoutes, { prefix: `${API_PREFIX}/meetings` });
  await app.register(userRoutes, { prefix: `${API_PREFIX}/users` });
  await app.register(roleRoutes, { prefix: `${API_PREFIX}/roles` });
  await app.register(lookupRoutes, { prefix: API_PREFIX });
  await app.register(notificationRoutes, { prefix: `${API_PREFIX}/notifications` });

  // Control plane. Separate token realm — see lib/tokens.ts.
  await app.register(platformRoutes, { prefix: `${API_PREFIX}/platform` });
  // Plan catalogue administration — same realm, same prefix.
  await app.register(catalogRoutes, { prefix: `${API_PREFIX}/platform` });

  return app;
}

import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { jsonSchemaTransform } from 'fastify-type-provider-zod';
import { env } from '../config/env.js';

/**
 * OpenAPI generated from the same zod schemas the routes validate with, so the
 * documentation cannot drift from the implementation.
 *
 * Not registered in production: the mobile and dashboard clients are built
 * against it at development time, and a public schema dump of an internal API is
 * free reconnaissance.
 */
export const swaggerPlugin = fp(async function swaggerPlugin(app: FastifyInstance) {
  if (env.isProduction) return;

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'LeadBee API',
        description:
          'Multi-tenant lead management. Two auth realms: `/api/v1/*` for tenants, ' +
          '`/api/v1/platform/*` for the superadmin control plane.',
        version: '0.1.0',
      },
      servers: [{ url: `http://localhost:${env.PORT}`, description: 'local' }],
      components: {
        securitySchemes: {
          tenantToken: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
            description: 'Tenant access token from POST /api/v1/auth/login',
          },
          platformToken: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
            description: 'Platform token from POST /api/v1/platform/auth/login',
          },
        },
      },
      tags: [
        { name: 'auth', description: 'Tenant authentication' },
        { name: 'signup', description: 'Self-serve organization signup' },
        { name: 'leads', description: 'Leads, call logs, threads, documents' },
        { name: 'tasks', description: 'Tasks' },
        { name: 'meetings', description: 'Meetings' },
        { name: 'users', description: 'Organization users and roles' },
        { name: 'lookups', description: 'Projects, purposes, quick replies' },
        { name: 'platform', description: 'Superadmin control plane' },
      ],
    },
    transform: jsonSchemaTransform,
  });

  await app.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: { docExpansion: 'list', deepLinking: true },
  });
});

import type { FastifyRequest } from 'fastify';
import { AppError } from './errors.js';
import type { Viewer } from '../modules/leads/lead.service.js';

/**
 * The request's authenticated caller, in the shape services take.
 *
 * Services deal in a `Viewer`, not a `FastifyRequest` — that is what keeps them
 * testable without a server and free of HTTP types.
 */
export function viewerOf(request: FastifyRequest): Viewer {
  const auth = request.auth;
  if (!auth) {
    // Reaching a handler with no auth means a route was registered without its
    // authenticate preHandler. Fail loudly rather than defaulting to something.
    throw AppError.unauthorized();
  }
  return {
    userId: auth.userId,
    isOrganizer: auth.isOrganizer,
    name: auth.user.name,
    role: auth.role,
  };
}

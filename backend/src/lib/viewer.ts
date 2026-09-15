import type { FastifyRequest } from 'fastify';
import { AppError } from './errors.js';
import { env } from '../config/env.js';
import { isValidTimeZone } from './zonedTime.js';
import type { Viewer } from '../modules/leads/lead.service.js';

/** Longest IANA zone name in practice is ~30 characters; anything past this is not one. */
const MAX_TIME_ZONE_LENGTH = 64;

/**
 * The zone a request's user is in, from the app's `X-Timezone` header. Unknown
 * or missing falls back to the deployment's default — never to the server's
 * own clock.
 */
export function resolveTimeZone(requested: unknown): string {
  return typeof requested === 'string' &&
    requested.length <= MAX_TIME_ZONE_LENGTH &&
    isValidTimeZone(requested)
    ? requested
    : env.DEFAULT_TIME_ZONE;
}

/** The zone to compute "today" in for this viewer. */
export function zoneOf(viewer: Pick<Viewer, 'timeZone'>): string {
  return viewer.timeZone ?? env.DEFAULT_TIME_ZONE;
}

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
    timeZone: resolveTimeZone(request.headers['x-timezone']),
  };
}

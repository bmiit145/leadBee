import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import compress from '@fastify/compress';
import rateLimit from '@fastify/rate-limit';
import underPressure from '@fastify/under-pressure';
import { env } from '../config/env.js';
import { AppError } from '../lib/errors.js';

export const securityPlugin = fp(async function securityPlugin(app: FastifyInstance) {
  await app.register(helmet, {
    // The API serves JSON to native and SPA clients, never HTML it controls, so
    // CSP here would only constrain the Swagger UI. It is disabled in production
    // anyway; keep the header off rather than shipping a policy nothing honours.
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  });

  await app.register(cors, {
    origin(origin, cb) {
      // No Origin header: native app, curl, server-to-server. Not a browser, so
      // the same-origin policy this protects is not in play.
      if (!origin) return cb(null, true);
      if (env.corsOrigins.includes(origin)) return cb(null, true);
      // Expo dev serves from an ephemeral LAN port; allowing it in production
      // would defeat the allowlist entirely.
      if (env.isDevelopment && /^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.)/.test(origin)) {
        return cb(null, true);
      }
      cb(new Error(`Origin ${origin} is not allowed by CORS`), false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  await app.register(compress, { global: true, threshold: 1024 });

  /**
   * Rate limiting is keyed per **tenant user** where one is known, falling back
   * to IP. Keying on IP alone punishes every user behind one office NAT — which
   * for a B2B CRM is the normal case, not the exception.
   *
   * The store is in-memory, which means the limit is per instance. That is
   * honest for a single node and wrong behind a load balancer: swap in
   * `@fastify/rate-limit`'s Redis store before scaling out horizontally.
   */
  await app.register(rateLimit, {
    max: env.RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_WINDOW,
    keyGenerator(request: FastifyRequest) {
      const auth = request.auth;
      if (auth) return `u:${auth.userId.toString()}`;
      const platformAuth = request.platformAuth;
      if (platformAuth) return `p:${platformAuth.adminId.toString()}`;
      return `ip:${request.ip}`;
    },
    /**
     * Returns an `AppError`, not a response body.
     *
     * `@fastify/rate-limit` **throws** whatever this returns
     * (`throw params.errorResponseBuilder(req, respCtx)`), so returning a plain
     * object sent a non-Error into the error handler: it matched no branch,
     * fell through to `String(error)` — literally `"[object Object]"` — and,
     * having no numeric `statusCode`, was reported as **500** rather than 429.
     *
     * Every rate-limited request looked like a server fault, which is the one
     * failure mode a rate limiter must not have: it hides the throttling from
     * the caller and buries a real 500 in the noise.
     *
     * `AppError` is the first branch `translate()` handles, so this produces the
     * intended `RATE_LIMITED` / 429 envelope with the request id attached.
     */
    errorResponseBuilder(_request, context) {
      return AppError.tooManyRequests(`Too many requests. Retry in ${context.after}.`);
    },
  });

  /**
   * Shed load before the event loop stalls. A 503 that arrives in 2ms is a far
   * better failure than a 200 that arrives in 40 seconds — the client can retry
   * the first and has usually given up on the second.
   *
   * Only event-loop *delay* is checked. Utilization was tried and removed: it
   * sits near 1.0 during any burst of back-to-back requests, which is normal
   * throughput rather than distress, and it rejected everything. Sustained
   * delay is the signal that actually means "requests are queueing".
   */
  /**
   * Requests are never shed during the first few seconds of process life.
   *
   * A cold process has genuinely awful event-loop readings — module evaluation,
   * JIT warmup, the driver opening its pool — none of which mean "overloaded".
   * Shedding on them makes every freshly rolled instance answer 503 to real
   * traffic for its first moments, which is the opposite of what load shedding
   * is for. Measured from plugin registration rather than `process.uptime()` so
   * that a long boot (a slow database connection, say) is not counted as
   * warm time the server never actually had.
   */
  const warmupStartedAt = Date.now();
  const WARMUP_MS = 10_000;

  await app.register(underPressure, {
    maxEventLoopDelay: 1000,
    retryAfter: 5,
    /**
     * Health endpoints bypass load shedding.
     *
     * Liveness answers "is this process alive", and a 503 there tells the
     * orchestrator to kill and restart a process that is merely busy — turning
     * a load spike into an outage. Readiness is allowed through too so it can
     * report the truth rather than the pressure plugin's opinion.
     */
    pressureHandler: (request, reply, type, value) => {
      // Returning without touching `reply` lets the request through.
      if (request.url.startsWith('/api/v1/health')) return;

      if (Date.now() - warmupStartedAt < WARMUP_MS) {
        request.log.debug({ type, value }, 'pressure during warmup — not shedding');
        return;
      }

      request.log.warn({ type, value, url: request.url }, 'shedding load');
      void reply.status(503).send({
        success: false,
        error: {
          code: 'SERVICE_OVERLOADED',
          message: 'Service under heavy load, please retry shortly.',
        },
        requestId: request.id,
      });
    },
  });
});

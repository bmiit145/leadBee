import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import mongoose from 'mongoose';
import { ZodError } from 'zod';
import { AppError } from '../lib/errors.js';
import { env } from '../config/env.js';

interface ErrorBody {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  requestId: string;
}

/**
 * One place where every failure becomes a response.
 *
 * Two rules it exists to enforce:
 *  - a 5xx never leaks an internal message to the client, but always writes the
 *    real one to the log with the request id, so support can join them;
 *  - a Mongo duplicate-key error becomes a 409 with the offending field, not an
 *    opaque 500 that looks like an outage.
 */
export const errorHandlerPlugin = fp(async function errorHandlerPlugin(app: FastifyInstance) {
  app.setErrorHandler((error: unknown, request: FastifyRequest, reply: FastifyReply) => {
    const requestId = request.id;
    const body = translate(error, request);

    if (body.error.code === 'INTERNAL_ERROR') {
      request.log.error({ err: error, requestId }, 'unhandled error');
    } else {
      request.log.warn(
        { code: body.error.code, msg: messageOf(error), requestId },
        'request failed'
      );
    }

    const status = statusFor(error, body.error.code);
    return reply.status(status).send({ ...body, requestId });
  });

  app.setNotFoundHandler((request, reply) => {
    return reply.status(404).send({
      success: false,
      error: {
        code: 'ROUTE_NOT_FOUND',
        message: `Route ${request.method} ${request.url} not found`,
      },
      requestId: request.id,
    } satisfies ErrorBody);
  });
});

/** A thrown value is not guaranteed to be an Error — read its message safely. */
function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/** Fastify's own schema-validation failure, before it reaches a handler. */
interface FastifyValidationError {
  code?: string;
  validation?: Array<{
    instancePath?: string;
    message?: string;
    params?: { issue?: { path?: Array<string | number>; message?: string } };
  }>;
  validationContext?: string;
}

function isSchemaValidationError(error: unknown): error is FastifyValidationError {
  return (error as FastifyValidationError)?.code === 'FST_ERR_VALIDATION';
}

function statusFor(error: unknown, code: string): number {
  if (error instanceof AppError) return error.statusCode;
  if (code === 'VALIDATION_ERROR') return 422;
  if (code === 'DUPLICATE_KEY') return 409;
  if (code === 'INVALID_ID') return 400;
  if (code === 'RATE_LIMITED') return 429;
  const statusCode = (error as { statusCode?: number }).statusCode;
  if (typeof statusCode === 'number' && statusCode >= 400 && statusCode < 600) {
    return statusCode;
  }
  return 500;
}

function translate(error: unknown, request: FastifyRequest): ErrorBody {
  const requestId = request.id;

  if (error instanceof AppError) {
    return {
      success: false,
      error: { code: error.code, message: error.message, details: error.details },
      requestId,
    };
  }

  /**
   * Fastify rejected the request against the route schema before any handler
   * ran. Normalised to the same `VALIDATION_ERROR` / 422 shape a zod failure
   * produces, so a client renders form errors one way rather than two — the
   * framework's own shape is `{ instancePath, message }`, which is not what the
   * rest of this API returns.
   */
  if (isSchemaValidationError(error)) {
    return {
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: `Request validation failed${
          error.validationContext ? ` in the ${error.validationContext}` : ''
        }`,
        details: (error.validation ?? []).map((issue) => ({
          field:
            issue.params?.issue?.path?.join('.') ??
            issue.instancePath?.replace(/^\//, '').replace(/\//g, '.') ??
            '',
          message: issue.params?.issue?.message ?? issue.message ?? 'Invalid value',
        })),
      },
      requestId,
    };
  }

  // Route schema rejected the payload. Report every offending field at once —
  // a form that reveals its errors one at a time is a bad form.
  if (error instanceof ZodError) {
    return {
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: error.issues.map((i) => ({
          field: i.path.join('.'),
          message: i.message,
        })),
      },
      requestId,
    };
  }

  if (error instanceof mongoose.Error.ValidationError) {
    return {
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Document validation failed',
        details: Object.values(error.errors).map((e) => ({
          field: e.path,
          message: e.message,
        })),
      },
      requestId,
    };
  }

  if (error instanceof mongoose.Error.CastError) {
    return {
      success: false,
      error: {
        code: 'INVALID_ID',
        message: `Invalid value for ${error.path}`,
      },
      requestId,
    };
  }

  // 11000 — unique index violation. Name the field; "duplicate key" alone sends
  // the caller to the logs for something they could have been told.
  const mongoErr = error as { code?: number; keyPattern?: Record<string, unknown> };
  if (mongoErr.code === 11000) {
    const fields = Object.keys(mongoErr.keyPattern ?? {}).filter(
      (f) => f !== 'organizationId'
    );
    return {
      success: false,
      error: {
        code: 'DUPLICATE_KEY',
        message: fields.length
          ? `A record with this ${fields.join(' + ')} already exists`
          : 'A record with these values already exists',
        details: { fields },
      },
      requestId,
    };
  }

  // Anything past here is a bug. The client gets a generic message; the log gets
  // the truth (written by the caller of translate()).
  return {
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: env.isProduction
        ? 'Something went wrong. Please try again.'
        : messageOf(error),
    },
    requestId,
  };
}

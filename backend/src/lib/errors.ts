/**
 * Application errors carry an HTTP status and a stable machine code. The code is
 * what clients branch on; the message is for humans and may be reworded freely.
 */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;
  /** Distinguishes "we meant this" from an unhandled crash in the error handler. */
  readonly isOperational = true;

  constructor(message: string, statusCode = 400, code = 'BAD_REQUEST', details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Error.captureStackTrace?.(this, AppError);
  }

  static badRequest(message: string, details?: unknown): AppError {
    return new AppError(message, 400, 'BAD_REQUEST', details);
  }

  static unauthorized(message = 'Authentication required'): AppError {
    return new AppError(message, 401, 'UNAUTHORIZED');
  }

  static forbidden(message = 'Access denied'): AppError {
    return new AppError(message, 403, 'FORBIDDEN');
  }

  static notFound(message = 'Resource not found'): AppError {
    return new AppError(message, 404, 'NOT_FOUND');
  }

  static conflict(message: string, details?: unknown): AppError {
    return new AppError(message, 409, 'CONFLICT', details);
  }

  static unprocessable(message: string, details?: unknown): AppError {
    return new AppError(message, 422, 'UNPROCESSABLE_ENTITY', details);
  }

  static tooManyRequests(message = 'Too many requests'): AppError {
    return new AppError(message, 429, 'RATE_LIMITED');
  }

  static internal(message = 'Internal server error'): AppError {
    return new AppError(message, 500, 'INTERNAL_ERROR');
  }

  /** The tenant's plan does not include this, or they are over a limit. */
  static planLimit(message: string, details?: unknown): AppError {
    return new AppError(message, 402, 'PLAN_LIMIT_EXCEEDED', details);
  }

  /** The organization is suspended, cancelled, or past its trial. */
  static orgInactive(message: string, details?: unknown): AppError {
    return new AppError(message, 403, 'ORGANIZATION_INACTIVE', details);
  }
}

import pino from 'pino';
import { env } from '../config/env.js';

/**
 * Structured logs. In development they are pretty-printed; in production they
 * are newline-delimited JSON for whatever ships them.
 *
 * `redact` is not optional — request bodies flow through this logger and they
 * carry passwords, tokens and customer phone numbers.
 */
export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.body.password',
      'req.body.currentPassword',
      'req.body.newPassword',
      'req.body.refreshToken',
      'req.body.totp',
      'res.headers["set-cookie"]',
      '*.password',
      '*.refreshToken',
      '*.refreshTokens',
      '*.totpSecret',
    ],
    censor: '[redacted]',
  },
  ...(env.isProduction
    ? {}
    : {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss.l',
            ignore: 'pid,hostname',
          },
        },
      }),
});

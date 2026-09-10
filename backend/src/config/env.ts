import 'dotenv/config';
import { z } from 'zod';
import { isSupportedCountry, type CountryCode } from 'libphonenumber-js/max';

/**
 * Env is parsed once, at boot, and the process refuses to start if anything is
 * missing or malformed. A server that boots with a placeholder JWT secret and
 * only reveals it under load is worse than one that never boots.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
  MONGODB_MAX_POOL_SIZE: z.coerce.number().int().positive().default(50),
  MONGODB_MIN_POOL_SIZE: z.coerce.number().int().nonnegative().default(5),
  /**
   * Log every Mongo operation. Off by default even in development: the hook
   * fires per driver call, and a boot that builds indexes across every model
   * pushes hundreds of pretty-printed lines through the logger synchronously,
   * which stalls the event loop hard enough to trip load shedding.
   */
  MONGO_DEBUG: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),

  /**
   * Region a phone number typed without a country code is assumed to belong to.
   * Which country LeadBee sells into is a business fact, not an engineering one,
   * so it is configuration rather than a constant in the validator.
   */
  DEFAULT_PHONE_REGION: z
    .string()
    .trim()
    .toUpperCase()
    .refine((value): value is CountryCode => isSupportedCountry(value), {
      message: 'Must be a supported ISO 3166-1 alpha-2 country code, e.g. IN',
    })
    .default('IN'),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('30d'),

  PLATFORM_JWT_SECRET: z.string().min(32, 'PLATFORM_JWT_SECRET must be at least 32 characters'),
  PLATFORM_JWT_REFRESH_SECRET: z
    .string()
    .min(32, 'PLATFORM_JWT_REFRESH_SECRET must be at least 32 characters'),
  PLATFORM_JWT_EXPIRES_IN: z.string().default('30m'),
  PLATFORM_JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),

  PLATFORM_BOOTSTRAP_EMAIL: z.string().email().optional(),
  PLATFORM_BOOTSTRAP_PASSWORD: z.string().min(8).optional(),
  PLATFORM_BOOTSTRAP_NAME: z.string().default('Platform Owner'),

  CORS_ORIGINS: z.string().default(''),

  ALLOW_SELF_SERVE_SIGNUP: z
    .string()
    .default('true')
    .transform((v) => v === 'true'),
  TRIAL_DAYS: z.coerce.number().int().positive().default(14),

  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
  RATE_LIMIT_WINDOW: z.string().default('1 minute'),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  • ${i.path.join('.')}: ${i.message}`)
    .join('\n');
  // Not the logger — the logger needs env to exist.
  console.error(`\nInvalid environment configuration:\n${issues}\n`);
  process.exit(1);
}

const raw = parsed.data;

export const env = {
  ...raw,
  isProduction: raw.NODE_ENV === 'production',
  isDevelopment: raw.NODE_ENV === 'development',
  isTest: raw.NODE_ENV === 'test',
  corsOrigins: raw.CORS_ORIGINS.split(',')
    .map((o) => o.trim())
    .filter(Boolean),
} as const;

export type Env = typeof env;

import { createHmac, randomUUID } from 'node:crypto';
import jwt, { type SignOptions } from 'jsonwebtoken';
import { env } from '../config/env.js';
import { TOKEN_AUDIENCE } from '../config/constants.js';
import { AppError } from './errors.js';

/**
 * Two token realms, kept apart by construction.
 *
 * A tenant token and a platform token differ in **secret** and in **audience**.
 * Either alone would be enough to stop a tenant token addressing the control
 * plane; both together mean a mistake in one check is not sufficient to cross
 * the boundary. `verify` refuses a token whose `aud` does not match the realm
 * being asked for, even if the signature is valid.
 */

const ISSUER = 'leadbee';

export interface TenantTokenPayload {
  sub: string; // user id
  org: string; // organization id
  role: string;
  permissions: string[];
}

export interface PlatformTokenPayload {
  sub: string; // platform admin id
  role: string;
  permissions: string[];
}

/** Carries no organization, role or permission: an account session has none. */
export interface AccountTokenPayload {
  sub: string; // account id
}

/**
 * The account realm's keys, derived from the tenant secrets with a label.
 *
 * A distinct secret *and* a distinct audience, like the other two realms
 * (ARCH-7), without a second pair of variables every environment must set.
 * Derived rather than reused, so a tenant token can never verify here even if
 * the audience check were dropped.
 */
const deriveSecret = (secret: string, label: string): string =>
  createHmac('sha256', secret).update(`leadbee:${label}:v1`).digest('hex');

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

interface RealmConfig {
  accessSecret: string;
  refreshSecret: string;
  accessTtl: string;
  refreshTtl: string;
  audience: string;
}

const REALMS = {
  tenant: {
    accessSecret: env.JWT_SECRET,
    refreshSecret: env.JWT_REFRESH_SECRET,
    accessTtl: env.JWT_EXPIRES_IN,
    refreshTtl: env.JWT_REFRESH_EXPIRES_IN,
    audience: TOKEN_AUDIENCE.TENANT,
  },
  platform: {
    accessSecret: env.PLATFORM_JWT_SECRET,
    refreshSecret: env.PLATFORM_JWT_REFRESH_SECRET,
    accessTtl: env.PLATFORM_JWT_EXPIRES_IN,
    refreshTtl: env.PLATFORM_JWT_REFRESH_EXPIRES_IN,
    audience: TOKEN_AUDIENCE.PLATFORM,
  },
  account: {
    accessSecret: deriveSecret(env.JWT_SECRET, 'account-access'),
    refreshSecret: deriveSecret(env.JWT_REFRESH_SECRET, 'account-refresh'),
    accessTtl: env.JWT_EXPIRES_IN,
    refreshTtl: env.JWT_REFRESH_EXPIRES_IN,
    audience: TOKEN_AUDIENCE.ACCOUNT,
  },
} satisfies Record<string, RealmConfig>;

export type Realm = keyof typeof REALMS;

export function signTokenPair(
  realm: Realm,
  payload: TenantTokenPayload | PlatformTokenPayload | AccountTokenPayload
): TokenPair {
  const cfg = REALMS[realm];
  const common: SignOptions = { issuer: ISSUER, audience: cfg.audience };

  return {
    accessToken: jwt.sign(payload, cfg.accessSecret, {
      ...common,
      expiresIn: cfg.accessTtl as SignOptions['expiresIn'],
      jwtid: randomUUID(),
    }),
    // The refresh token carries only the subject. If it leaks, it cannot be read
    // for the bearer's role or permission set, and it is useless without also
    // matching a stored hash on the user row.
    //
    // `jwtid` makes every token unique. Without it, two issued for one subject
    // within the same second are byte-identical — so a rotation could hand back
    // the very token it consumed, and replaying that token would go unnoticed.
    refreshToken: jwt.sign({ sub: payload.sub }, cfg.refreshSecret, {
      ...common,
      expiresIn: cfg.refreshTtl as SignOptions['expiresIn'],
      jwtid: randomUUID(),
    }),
  };
}

export function verifyAccessToken<
  T extends TenantTokenPayload | PlatformTokenPayload | AccountTokenPayload,
>(
  realm: Realm,
  token: string
): T {
  const cfg = REALMS[realm];
  try {
    return jwt.verify(token, cfg.accessSecret, {
      issuer: ISSUER,
      audience: cfg.audience,
    }) as T;
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw new AppError('Access token expired', 401, 'TOKEN_EXPIRED');
    }
    throw AppError.unauthorized('Invalid access token');
  }
}

export function verifyRefreshToken(realm: Realm, token: string): { sub: string } {
  const cfg = REALMS[realm];
  try {
    return jwt.verify(token, cfg.refreshSecret, {
      issuer: ISSUER,
      audience: cfg.audience,
    }) as { sub: string };
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw new AppError('Refresh token expired', 401, 'REFRESH_TOKEN_EXPIRED');
    }
    throw AppError.unauthorized('Invalid refresh token');
  }
}

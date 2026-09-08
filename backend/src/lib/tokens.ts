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
} satisfies Record<string, RealmConfig>;

export type Realm = keyof typeof REALMS;

export function signTokenPair(
  realm: Realm,
  payload: TenantTokenPayload | PlatformTokenPayload
): TokenPair {
  const cfg = REALMS[realm];
  const common: SignOptions = { issuer: ISSUER, audience: cfg.audience };

  return {
    accessToken: jwt.sign(payload, cfg.accessSecret, {
      ...common,
      expiresIn: cfg.accessTtl as SignOptions['expiresIn'],
    }),
    // The refresh token carries only the subject. If it leaks, it cannot be read
    // for the bearer's role or permission set, and it is useless without also
    // matching a stored hash on the user row.
    refreshToken: jwt.sign({ sub: payload.sub }, cfg.refreshSecret, {
      ...common,
      expiresIn: cfg.refreshTtl as SignOptions['expiresIn'],
    }),
  };
}

export function verifyAccessToken<T extends TenantTokenPayload | PlatformTokenPayload>(
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

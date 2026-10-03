import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import jwt, { type JwtPayload } from 'jsonwebtoken';

vi.mock('dotenv/config', () => ({}));

describe('mobile session token lifetimes', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('MONGODB_URI', 'mongodb://localhost/leadbee-test');
    vi.stubEnv('JWT_SECRET', 'tenant-access-secret-for-token-tests-0001');
    vi.stubEnv('JWT_REFRESH_SECRET', 'tenant-refresh-secret-for-token-tests-001');
    vi.stubEnv('PLATFORM_JWT_SECRET', 'platform-access-secret-for-token-tests-01');
    vi.stubEnv('PLATFORM_JWT_REFRESH_SECRET', 'platform-refresh-secret-for-token-tests1');
    vi.stubEnv('JWT_REFRESH_EXPIRES_IN', undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('keeps tenant and account sessions refreshable for the 90-day idle window by default', async () => {
    const { signTokenPair } = await import('./tokens.js');
    const lifetimeSeconds = 90 * 24 * 60 * 60;

    for (const realm of ['tenant', 'account'] as const) {
      const pair = signTokenPair(realm, { sub: 'test-subject' });
      const payload = jwt.decode(pair.refreshToken) as JwtPayload;

      expect(payload.exp! - payload.iat!).toBe(lifetimeSeconds);
    }
  });
});

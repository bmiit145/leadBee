import { createHash } from 'node:crypto';
import { authenticator } from 'otplib';
import { Types } from 'mongoose';
import { PlatformAdmin, type IPlatformAdmin } from '../../models/PlatformAdmin.js';
import { AppError } from '../../lib/errors.js';
import { signTokenPair, verifyRefreshToken, type TokenPair } from '../../lib/tokens.js';

const MAX_SESSIONS = 3;
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface PlatformLoginResult {
  admin: IPlatformAdmin;
  tokens: TokenPair;
}

export const platformAuthService = {
  /**
   * Control-plane sign-in.
   *
   * Stricter than tenant login in three ways, because this credential unlocks
   * every tenant: failed attempts lock the account, sessions are capped lower,
   * and TOTP is enforced once enrolled.
   */
  async login(
    email: string,
    password: string,
    totp: string | undefined,
    ip: string
  ): Promise<PlatformLoginResult> {
    const admin = await PlatformAdmin.findOne({ email: email.toLowerCase().trim() })
      .select('+password +refreshTokens +totpSecret');

    const invalid = () => AppError.unauthorized('Invalid credentials');
    if (!admin || !admin.isActive) throw invalid();

    if (admin.isLocked()) {
      throw AppError.forbidden(
        'Account temporarily locked after repeated failed sign-ins. Try again shortly.'
      );
    }

    if (!(await admin.comparePassword(password))) {
      admin.failedLoginAttempts += 1;
      if (admin.failedLoginAttempts >= MAX_FAILED_ATTEMPTS) {
        admin.lockedUntil = new Date(Date.now() + LOCK_MINUTES * 60_000);
        admin.failedLoginAttempts = 0;
      }
      await admin.save();
      throw invalid();
    }

    if (admin.totpEnabled) {
      if (!totp) {
        throw new AppError('Two-factor code required', 401, 'TOTP_REQUIRED');
      }
      const valid = authenticator.check(totp, admin.totpSecret ?? '');
      if (!valid) {
        admin.failedLoginAttempts += 1;
        await admin.save();
        throw AppError.unauthorized('Invalid two-factor code');
      }
    }

    const tokens = signTokenPair('platform', {
      sub: admin._id.toString(),
      role: admin.role,
      permissions: admin.permissions(),
    });

    admin.refreshTokens.push(hashToken(tokens.refreshToken));
    if (admin.refreshTokens.length > MAX_SESSIONS) {
      admin.refreshTokens = admin.refreshTokens.slice(-MAX_SESSIONS);
    }
    admin.failedLoginAttempts = 0;
    admin.lockedUntil = undefined;
    admin.lastLoginAt = new Date();
    admin.lastLoginIp = ip;
    await admin.save();

    return { admin, tokens };
  },

  async refresh(refreshToken: string): Promise<PlatformLoginResult> {
    const payload = verifyRefreshToken('platform', refreshToken);
    if (!Types.ObjectId.isValid(payload.sub)) {
      throw AppError.unauthorized('Invalid refresh token');
    }

    const admin = await PlatformAdmin.findById(payload.sub).select('+refreshTokens');
    if (!admin || !admin.isActive) throw AppError.unauthorized('Account not found');

    const presented = hashToken(refreshToken);
    const index = admin.refreshTokens.indexOf(presented);
    if (index === -1) {
      // Replay of an already-rotated token. On the control plane this is treated
      // as compromise, not as a race: kill every session.
      admin.refreshTokens = [];
      await admin.save();
      throw AppError.unauthorized('Refresh token reuse detected. All sessions revoked.');
    }
    admin.refreshTokens.splice(index, 1);

    const tokens = signTokenPair('platform', {
      sub: admin._id.toString(),
      role: admin.role,
      permissions: admin.permissions(),
    });
    admin.refreshTokens.push(hashToken(tokens.refreshToken));
    await admin.save();

    return { admin, tokens };
  },

  async logout(adminId: Types.ObjectId, refreshToken?: string): Promise<void> {
    if (!refreshToken) return;
    await PlatformAdmin.updateOne(
      { _id: adminId },
      { $pull: { refreshTokens: hashToken(refreshToken) } }
    );
  },

  /** Begin TOTP enrolment. The secret is only confirmed once a code verifies. */
  async beginTotpEnrolment(
    adminId: Types.ObjectId
  ): Promise<{ secret: string; otpauthUrl: string }> {
    const admin = await PlatformAdmin.findById(adminId).select('+totpSecret');
    if (!admin) throw AppError.notFound('Account not found');
    if (admin.totpEnabled) {
      throw AppError.conflict('Two-factor is already enabled');
    }

    const secret = authenticator.generateSecret();
    admin.totpSecret = secret;
    // Still false: enrolment is not complete until a code round-trips, or a
    // mis-scanned QR would lock the admin out of their own console.
    admin.totpEnabled = false;
    await admin.save();

    return {
      secret,
      otpauthUrl: authenticator.keyuri(admin.email, 'LeadBee Platform', secret),
    };
  },

  async confirmTotpEnrolment(adminId: Types.ObjectId, code: string): Promise<void> {
    const admin = await PlatformAdmin.findById(adminId).select('+totpSecret');
    if (!admin?.totpSecret) throw AppError.badRequest('Start enrolment first');

    if (!authenticator.check(code, admin.totpSecret)) {
      throw AppError.badRequest('That code did not match. Check your authenticator app.');
    }
    admin.totpEnabled = true;
    await admin.save();
  },
};

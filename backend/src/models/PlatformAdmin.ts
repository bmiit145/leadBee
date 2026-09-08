import mongoose, { Schema, type Document, type Model } from 'mongoose';
import bcrypt from 'bcryptjs';
import { jsonTransform } from '../lib/toJSON.js';

/**
 * Staff of the platform itself — the people who run the superadmin console.
 *
 * A separate collection from `User` on purpose. The alternative, a `super_admin`
 * role on a row inside some tenant, means every tenant query has to remember to
 * exclude them and every permission check has a cross-tenant special case. That
 * pattern is how cross-tenant leaks happen. Here the two realms share no rows,
 * no secrets, and no token audience.
 */
export type PlatformRole = 'owner' | 'operator' | 'support';

/** What each platform role may do. `support` is read-mostly by design: the
 *  common case is answering a ticket, not changing a customer's plan. */
export const PLATFORM_ROLE_PERMISSIONS: Record<PlatformRole, string[]> = {
  owner: ['*'],
  operator: [
    'orgs.view', 'orgs.create', 'orgs.update', 'orgs.suspend', 'orgs.plan',
    'users.view', 'users.update', 'users.deactivate',
    'metrics.view', 'audit.view',
  ],
  support: ['orgs.view', 'users.view', 'metrics.view', 'audit.view'],
};

export interface IPlatformAdmin extends Document {
  _id: mongoose.Types.ObjectId;
  name: string;
  email: string;
  password: string;
  role: PlatformRole;
  isActive: boolean;

  /** TOTP enrolment. The console can be configured to require it; the secret is
   *  never selected by default so it cannot leak through a stray find(). */
  totpSecret?: string;
  totpEnabled: boolean;

  refreshTokens: string[];
  lastLoginAt?: Date;
  lastLoginIp?: string;
  failedLoginAttempts: number;
  lockedUntil?: Date;

  createdAt: Date;
  updatedAt: Date;

  comparePassword(candidate: string): Promise<boolean>;
  isLocked(): boolean;
  permissions(): string[];
}

const platformAdminSchema = new Schema<IPlatformAdmin>(
  {
    name: { type: String, required: true, trim: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: { type: String, required: true, minlength: 8, select: false },
    role: {
      type: String,
      enum: ['owner', 'operator', 'support'],
      default: 'support',
    },
    isActive: { type: Boolean, default: true },

    totpSecret: { type: String, select: false },
    totpEnabled: { type: Boolean, default: false },

    refreshTokens: { type: [String], default: [], select: false },
    lastLoginAt: { type: Date },
    lastLoginIp: { type: String },
    failedLoginAttempts: { type: Number, default: 0 },
    lockedUntil: { type: Date },
  },
  { timestamps: true }
);

platformAdminSchema.pre('save', async function () {
  if (!this.isModified('password')) return;
  // Cost 12: ~250ms on current hardware. Login is not a hot path and this is the
  // credential that unlocks every tenant.
  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
});

platformAdminSchema.methods.comparePassword = function (
  this: IPlatformAdmin,
  candidate: string
): Promise<boolean> {
  return bcrypt.compare(candidate, this.password);
};

platformAdminSchema.methods.isLocked = function (this: IPlatformAdmin): boolean {
  return Boolean(this.lockedUntil && this.lockedUntil.getTime() > Date.now());
};

platformAdminSchema.methods.permissions = function (this: IPlatformAdmin): string[] {
  return PLATFORM_ROLE_PERMISSIONS[this.role] ?? [];
};

platformAdminSchema.set('toJSON', {
  virtuals: true,
  transform: jsonTransform('password', 'refreshTokens', 'totpSecret'),
});

export const PlatformAdmin: Model<IPlatformAdmin> = mongoose.model<IPlatformAdmin>(
  'PlatformAdmin',
  platformAdminSchema
);

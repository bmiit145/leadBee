import mongoose, { Schema, type Document, type Model } from 'mongoose';
import { ROLES, type Role } from '../config/constants.js';
import { tenantPlugin } from '../lib/tenantPlugin.js';
import { tenantJsonTransform } from '../lib/toJSON.js';

/**
 * A person's membership of one organization.
 *
 * The person themselves is the `Account` this points at: it owns the name,
 * email, mobile number and the password they sign in with. This row owns what
 * differs per organization — role, permissions, designation, whether they are
 * active here, and the sessions of this membership.
 *
 * `name`, `email` and `phone` are a **copy** of the account's. Leads, tasks,
 * meetings and notifications populate them from here, so they stay; but they
 * are written only by `identity.service.ts`, which keeps every membership of a
 * person in step. There is no password on this row. See
 * docs/adr/0004-account-is-the-identity.md.
 *
 * Note what is *not* here either: a `super_admin` role. Platform staff live in
 * `PlatformAdmin`, in their own realm. See models/PlatformAdmin.ts.
 */
export interface IUser extends Document {
  _id: mongoose.Types.ObjectId;
  organizationId: mongoose.Types.ObjectId;
  accountId: mongoose.Types.ObjectId;
  name: string;
  email?: string;
  phone: string;
  role: Role;
  roleId?: mongoose.Types.ObjectId;
  /** Per-user grants layered on top of the role's set. */
  permissions: string[];
  /** Lead groupings this user works. Empty means "all of them". */
  projects: mongoose.Types.ObjectId[];
  /** Pre-selected grouping on the create-lead form. */
  defaultProject?: mongoose.Types.ObjectId;
  avatarUrl?: string;
  designation?: string;
  isActive: boolean;
  refreshTokens: string[];
  lastLoginAt?: Date;
  /** Expo push token, for follow-up and meeting reminders. */
  pushToken?: string;
  locale: string;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<IUser>(
  {
    accountId: { type: Schema.Types.ObjectId, ref: 'Account', required: true },
    name: { type: String, required: true, trim: true },
    email: {
      type: String,
      lowercase: true,
      trim: true,
      // An empty string is not a value — without this, several users with a
      // blank email collide on the sparse unique index.
      set: (value: string | null | undefined) => {
        if (value === null || value === undefined) return undefined;
        const normalized = value.trim().toLowerCase();
        return normalized === '' ? undefined : normalized;
      },
    },
    phone: { type: String, required: true, trim: true },
    role: {
      type: String,
      enum: Object.values(ROLES),
      default: ROLES.USER,
    },
    roleId: { type: Schema.Types.ObjectId, ref: 'Role' },
    permissions: { type: [String], default: [] },
    projects: { type: [{ type: Schema.Types.ObjectId, ref: 'Project' }], default: [] },
    defaultProject: { type: Schema.Types.ObjectId, ref: 'Project' },
    avatarUrl: { type: String, trim: true },
    designation: { type: String, trim: true },
    isActive: { type: Boolean, default: true },
    refreshTokens: { type: [String], default: [], select: false },
    lastLoginAt: { type: Date },
    pushToken: { type: String, trim: true, select: false },
    locale: { type: String, default: 'en' },
  },
  { timestamps: true }
);

userSchema.plugin(tenantPlugin);

// ─── Uniqueness is per tenant ─────────────────────────────────────────────────
// A person's email and mobile are globally unique on their `Account`; these keep
// the membership copies consistent inside one organization.
userSchema.index({ organizationId: 1, phone: 1 }, { unique: true });
userSchema.index(
  { organizationId: 1, email: 1 },
  { unique: true, partialFilterExpression: { email: { $type: 'string' } } }
);
// One membership per person per organization. Partial so that rows written
// before the account backfill do not collide on a missing value.
userSchema.index(
  { organizationId: 1, accountId: 1 },
  { unique: true, partialFilterExpression: { accountId: { $exists: true } } }
);
// Sign-in resolves "every organization this person belongs to" — by definition
// a cross-tenant read, so this index cannot lead with organizationId. A
// single-field index, which ARCH-5's compound-index rule does not cover; the
// trade-off is recorded in ADR-0004.
userSchema.index({ accountId: 1 });
userSchema.index({ organizationId: 1, isActive: 1, role: 1 });
userSchema.index({ organizationId: 1, name: 1 });

// tenantPlugin already installs a toJSON transform; this replaces it, so the
// tenant key has to be named again here or organizationId leaks back out.
// `password` stays in the list: rows from before the backfill may still carry one.
userSchema.set('toJSON', {
  virtuals: true,
  transform: tenantJsonTransform('password', 'refreshTokens', 'pushToken'),
});

export const User: Model<IUser> = mongoose.model<IUser>('User', userSchema);

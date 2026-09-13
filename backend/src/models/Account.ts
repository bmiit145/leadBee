import mongoose, { Schema, type Document, type Model } from 'mongoose';
import bcrypt from 'bcryptjs';
import { jsonTransform } from '../lib/toJSON.js';

/**
 * A person who has registered with LeadBee — before, and independent of, any
 * organization.
 *
 * **Not tenant-owned, on purpose** (BE-4). A tenant `User` cannot exist without
 * an `organizationId`, and LeadBee registers the person first and asks "join a
 * team or start your own" afterwards. So the identity has to live outside every
 * tenant, the same way `Organization` and `PlatformAdmin` do. It is therefore
 * exempt from ARCH-5's organizationId-leading indexes. See
 * docs/adr/0003-pre-tenant-accounts.md.
 *
 * An account never grants access to tenant data by itself. It becomes useful
 * only once it is linked to a tenant `User`, which is the join/create flow.
 */

export const ACCOUNT_STATUSES = {
  ACTIVE: 'active',
  SUSPENDED: 'suspended',
} as const;

export type AccountStatus = (typeof ACCOUNT_STATUSES)[keyof typeof ACCOUNT_STATUSES];

/** How an email came to be marked verified — an audit question, not a UI one. */
export type EmailVerifiedVia = 'code' | 'platform_admin';

/**
 * The outstanding registration attempt.
 *
 * Only hashes are stored. `tokenHash` binds a code to the registration attempt
 * that requested it, so a code proves "the person who submitted *these*
 * details owns the mailbox" — not merely "someone owns the mailbox".
 */
export interface PendingVerification {
  codeHash: string;
  tokenHash: string;
  expiresAt: Date;
  attempts: number;
  sentAt: Date;
}

export interface IAccount extends Document {
  _id: mongoose.Types.ObjectId;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  password: string;
  status: AccountStatus;

  emailVerifiedAt?: Date;
  emailVerifiedVia?: EmailVerifiedVia;
  verification?: PendingVerification;

  suspendedAt?: Date;
  suspendedReason?: string;
  suspendedBy?: mongoose.Types.ObjectId;

  /** Consent record. The form will not submit without it; the server stores when. */
  acceptedTermsAt: Date;
  signupIp?: string;
  signupUserAgent?: string;

  /** Written by platform staff. Never shown to the account holder. */
  internalNotes?: string;

  createdAt: Date;
  updatedAt: Date;
}

const pendingVerificationSchema = new Schema<PendingVerification>(
  {
    codeHash: { type: String, required: true },
    tokenHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    attempts: { type: Number, default: 0 },
    sentAt: { type: Date, required: true },
  },
  { _id: false }
);

const accountSchema = new Schema<IAccount>(
  {
    firstName: { type: String, required: true, trim: true, maxlength: 40 },
    lastName: { type: String, required: true, trim: true, maxlength: 40 },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 254,
    },
    // Indexed but not unique. Uniqueness would turn registration into an oracle
    // for "is this number already on LeadBee", and two people sharing a handset
    // is ordinary. The tenant `User` enforces per-organization uniqueness where
    // it actually matters: at sign-in.
    phone: { type: String, required: true, trim: true, index: true },
    password: { type: String, required: true, minlength: 8, select: false },
    status: {
      type: String,
      enum: Object.values(ACCOUNT_STATUSES),
      default: ACCOUNT_STATUSES.ACTIVE,
    },

    emailVerifiedAt: { type: Date },
    emailVerifiedVia: { type: String, enum: ['code', 'platform_admin'] },
    verification: { type: pendingVerificationSchema, select: false },

    suspendedAt: { type: Date },
    suspendedReason: { type: String, trim: true, maxlength: 500 },
    suspendedBy: { type: Schema.Types.ObjectId, ref: 'PlatformAdmin' },

    acceptedTermsAt: { type: Date, required: true },
    signupIp: { type: String },
    signupUserAgent: { type: String, maxlength: 300 },

    internalNotes: { type: String, trim: true, maxlength: 5000 },
  },
  { timestamps: true }
);

// The console lists newest first, filtered by status or verification. Each of
// those is a leading equality plus the sort.
accountSchema.index({ createdAt: -1 });
accountSchema.index({ status: 1, createdAt: -1 });
accountSchema.index({ emailVerifiedAt: 1, createdAt: -1 });

accountSchema.pre('save', async function () {
  if (!this.isModified('password')) return;
  // Cost matches the tenant `User`: the same person's credential, the same bar.
  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
});

accountSchema.virtual('name').get(function (this: IAccount) {
  return `${this.firstName} ${this.lastName}`.trim();
});

accountSchema.set('toJSON', {
  virtuals: true,
  transform: jsonTransform('password', 'verification'),
});

export const Account: Model<IAccount> = mongoose.model<IAccount>('Account', accountSchema);

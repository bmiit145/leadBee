import mongoose, { Schema, type Document, type Model } from 'mongoose';
import bcrypt from 'bcryptjs';
import { jsonTransform } from '../lib/toJSON.js';

/**
 * A person — the one identity they sign in with, whatever organizations they
 * belong to.
 *
 * **Not tenant-owned, on purpose** (BE-4). A person exists before, and across,
 * organizations: registered in the app with no team yet, or working for two
 * companies at once. Each organization they belong to holds a membership
 * (`User`) that points here. So this collection lives outside every tenant,
 * like `Organization` and `PlatformAdmin`, and is exempt from ARCH-5's
 * organizationId-leading indexes.
 *
 * The account owns the name, email, mobile number and password. Email and
 * mobile are each unique: one belongs to exactly one person.
 *
 * See docs/adr/0003-pre-tenant-accounts.md and docs/adr/0004-account-is-the-identity.md.
 */

export const ACCOUNT_STATUSES = {
  ACTIVE: 'active',
  SUSPENDED: 'suspended',
} as const;

export type AccountStatus = (typeof ACCOUNT_STATUSES)[keyof typeof ACCOUNT_STATUSES];

/** How an email came to be marked verified — an audit question, not a UI one. */
export type EmailVerifiedVia = 'code' | 'platform_admin';

/**
 * How the account came to exist. `registration` is the only kind that can be
 * disposable (see `identity.ts`): an organization or the backfill vouched for
 * the others.
 */
export type AccountSource = 'registration' | 'organization' | 'backfill';

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
  source: AccountSource;

  emailVerifiedAt?: Date;
  emailVerifiedVia?: EmailVerifiedVia;
  verification?: PendingVerification;

  suspendedAt?: Date;
  suspendedReason?: string;
  suspendedBy?: mongoose.Types.ObjectId;

  /** Consent record for self-registration. Absent for accounts an organization created. */
  acceptedTermsAt?: Date;
  signupIp?: string;
  signupUserAgent?: string;
  lastLoginAt?: Date;

  /**
   * Hashes of account-session refresh tokens — the session a person holds while
   * they belong to no organization. Membership sessions live on `User`.
   */
  refreshTokens: string[];

  /** Opens first at sign-in when the person has several organizations. Chosen by them. */
  defaultOrganizationId?: mongoose.Types.ObjectId;
  /** The organization a membership session last opened — the fallback when there is no default. */
  lastOrganizationId?: mongoose.Types.ObjectId;
  /**
   * How many organizations this person may own. Absent means the platform
   * default (`DEFAULT_OWNED_ORGANIZATION_LIMIT`); set by platform staff.
   */
  ownedOrganizationLimit?: number;

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
    // Not required: a membership name of one word ("Madhuri") has no last name,
    // and inventing one would be worse than leaving it empty.
    lastName: { type: String, trim: true, maxlength: 40, default: '' },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 254,
    },
    // Unique: a mobile number identifies one person, exactly like an email.
    // Registration therefore reveals whether a number is taken — a trade-off the
    // product chose in ADR-0004, bounded by rate limits.
    phone: { type: String, required: true, trim: true, unique: true },
    password: { type: String, required: true, minlength: 8, select: false },
    status: {
      type: String,
      enum: Object.values(ACCOUNT_STATUSES),
      default: ACCOUNT_STATUSES.ACTIVE,
    },
    source: {
      type: String,
      enum: ['registration', 'organization', 'backfill'],
      default: 'registration',
    },

    emailVerifiedAt: { type: Date },
    emailVerifiedVia: { type: String, enum: ['code', 'platform_admin'] },
    verification: { type: pendingVerificationSchema, select: false },

    suspendedAt: { type: Date },
    suspendedReason: { type: String, trim: true, maxlength: 500 },
    suspendedBy: { type: Schema.Types.ObjectId, ref: 'PlatformAdmin' },

    acceptedTermsAt: { type: Date },
    signupIp: { type: String },
    signupUserAgent: { type: String, maxlength: 300 },
    lastLoginAt: { type: Date },
    refreshTokens: { type: [String], default: [], select: false },
    defaultOrganizationId: { type: Schema.Types.ObjectId, ref: 'Organization' },
    lastOrganizationId: { type: Schema.Types.ObjectId, ref: 'Organization' },
    ownedOrganizationLimit: { type: Number, min: 0, max: 1000 },

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
  // Cost 12: this is the credential for every organization the person is in.
  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
});

accountSchema.virtual('name').get(function (this: IAccount) {
  return `${this.firstName} ${this.lastName ?? ''}`.trim();
});

accountSchema.set('toJSON', {
  virtuals: true,
  transform: jsonTransform('password', 'verification', 'refreshTokens'),
});

export const Account: Model<IAccount> = mongoose.model<IAccount>('Account', accountSchema);

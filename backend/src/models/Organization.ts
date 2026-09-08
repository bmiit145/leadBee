import mongoose, { Schema, type Document, type Model } from 'mongoose';
import {
  ACTIVE_ORG_STATUSES,
  ORG_STATUSES,
  ORG_TIERS,
  PLAN_LIMITS,
  PLANS,
  type OrgStatus,
  type OrgTier,
  type Plan,
} from '../config/constants.js';
import { jsonTransform } from '../lib/toJSON.js';

/**
 * The tenant root.
 *
 * Deliberately *not* tenant-scoped — it is the thing being scoped to, and the
 * platform console reads across all of them. Everything else in the system
 * carries `organizationId` pointing here.
 */
export interface IOrganization extends Document {
  _id: mongoose.Types.ObjectId;
  name: string;
  /** URL-safe tenant handle, unique across the platform. */
  slug: string;
  status: OrgStatus;
  plan: Plan;
  tier: OrgTier;

  /** Denormalised plan ceilings, copied on plan change so a limit check is a
   *  field read rather than a lookup. Re-synced by the plan-change service. */
  limits: {
    maxUsers: number;
    maxLeads: number;
    maxMonthlyApiCalls: number;
  };
  features: string[];

  /** Rolling counters, maintained on create/delete so the console does not have
   *  to `countDocuments` across every tenant to render a table. */
  usage: {
    users: number;
    leads: number;
    lastActivityAt?: Date;
  };

  trialEndsAt?: Date;
  suspendedAt?: Date;
  suspendedReason?: string;

  billingEmail?: string;
  contactPhone?: string;
  /** Free-form notes the platform team keeps on the account. Never exposed to
   *  the tenant. */
  internalNotes?: string;

  /** Set when `tier === 'dedicated'` — the connection router reads it. */
  dedicatedConnectionUri?: string;

  /** Which platform admin provisioned this org, when it was not self-serve. */
  provisionedBy?: mongoose.Types.ObjectId;
  signupSource: 'self_serve' | 'platform_provisioned';

  createdAt: Date;
  updatedAt: Date;

  isUsable(): boolean;
}

const organizationSchema = new Schema<IOrganization>(
  {
    name: { type: String, required: true, trim: true },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^[a-z0-9](?:[a-z0-9-]{1,48}[a-z0-9])$/, 'Invalid organization slug'],
    },
    status: {
      type: String,
      enum: Object.values(ORG_STATUSES),
      default: ORG_STATUSES.TRIALING,
      index: true,
    },
    plan: {
      type: String,
      enum: Object.values(PLANS),
      default: PLANS.TRIAL,
      index: true,
    },
    tier: {
      type: String,
      enum: Object.values(ORG_TIERS),
      default: ORG_TIERS.SHARED,
    },

    limits: {
      maxUsers: { type: Number, default: PLAN_LIMITS.trial.maxUsers },
      maxLeads: { type: Number, default: PLAN_LIMITS.trial.maxLeads },
      maxMonthlyApiCalls: { type: Number, default: PLAN_LIMITS.trial.maxMonthlyApiCalls },
    },
    features: { type: [String], default: () => [...PLAN_LIMITS.trial.features] },

    usage: {
      users: { type: Number, default: 0, min: 0 },
      leads: { type: Number, default: 0, min: 0 },
      lastActivityAt: { type: Date },
    },

    trialEndsAt: { type: Date },
    suspendedAt: { type: Date },
    suspendedReason: { type: String, trim: true },

    billingEmail: { type: String, trim: true, lowercase: true },
    contactPhone: { type: String, trim: true },
    internalNotes: { type: String, trim: true },

    dedicatedConnectionUri: { type: String, trim: true, select: false },

    provisionedBy: { type: Schema.Types.ObjectId, ref: 'PlatformAdmin' },
    signupSource: {
      type: String,
      enum: ['self_serve', 'platform_provisioned'],
      default: 'self_serve',
    },
  },
  { timestamps: true }
);

// The console's default view: newest tenants, filtered by status or plan.
organizationSchema.index({ status: 1, createdAt: -1 });
organizationSchema.index({ plan: 1, status: 1 });
organizationSchema.index({ name: 'text', slug: 'text' });
// Sweeps trials that lapsed without converting.
organizationSchema.index({ trialEndsAt: 1 }, { sparse: true });

/**
 * Whether the tenant may currently use the product. `past_due` is deliberately
 * still usable — locking a paying customer out the moment a card expires loses
 * more revenue than it protects.
 */
organizationSchema.methods.isUsable = function (this: IOrganization): boolean {
  if (!ACTIVE_ORG_STATUSES.includes(this.status)) return false;
  if (this.status === ORG_STATUSES.TRIALING && this.trialEndsAt) {
    return this.trialEndsAt.getTime() > Date.now();
  }
  return true;
};

organizationSchema.set('toJSON', {
  virtuals: true,
  transform: jsonTransform('dedicatedConnectionUri'),
});

export const Organization: Model<IOrganization> = mongoose.model<IOrganization>(
  'Organization',
  organizationSchema
);

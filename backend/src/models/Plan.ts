import mongoose, { Schema, type Document, type Model } from 'mongoose';
import { jsonTransform } from '../lib/toJSON.js';
import { grantSchema } from './grantSchema.js';
import type { FeatureGrant } from '../entitlements/types.js';

export const PLAN_STATUSES = {
  DRAFT: 'draft',
  ACTIVE: 'active',
  /** Still honoured for existing subscribers; not offered to new ones. */
  GRANDFATHERED: 'grandfathered',
  RETIRED: 'retired',
} as const;

export type PlanStatus = (typeof PLAN_STATUSES)[keyof typeof PLAN_STATUSES];

/** Statuses a *new* subscription may be created on. */
export const ASSIGNABLE_PLAN_STATUSES: PlanStatus[] = ['draft', 'active'];

/**
 * A versioned, sellable bundle of capabilities.
 *
 * **Immutable once subscribed.** Editing a live plan publishes a new `version`
 * rather than mutating the current one, and subscriptions pin the version they
 * were sold. Without that, one typo in an admin form silently rewrites the
 * contractual terms of every customer on the plan, with no record of what they
 * had. `planService.publishRevision()` is the only supported edit path.
 *
 * `key` is commercial metadata — a label and a sort order. **No business logic
 * may branch on it**; code asks `hasFeature(...)` instead.
 *
 * **Not tenant-scoped** — platform catalogue data. See backend/RULES.md BE-4.
 */
export interface IPlan extends Document {
  _id: mongoose.Types.ObjectId;
  key: string;
  version: number;
  name: string;
  description?: string;
  status: PlanStatus;
  /** Hidden plans exist for sales-led deals that should not appear in signup. */
  isPublic: boolean;
  /**
   * Display rank. Replaces the dashboard's hardcoded `PLAN_RANK` — ordering
   * plans is commercial policy and belongs on the server.
   */
  sortOrder: number;
  /**
   * Trial length for this plan. Replaces the single global `TRIAL_DAYS`
   * environment variable; `0` means no trial.
   */
  trialDays: number;
  grants: FeatureGrant[];

  createdBy?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const planSchema = new Schema<IPlan>(
  {
    key: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      match: [/^[a-z0-9](?:[a-z0-9_-]{0,48}[a-z0-9])$/, 'Invalid plan key'],
    },
    version: { type: Number, required: true, min: 1 },
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    status: {
      type: String,
      enum: Object.values(PLAN_STATUSES),
      default: PLAN_STATUSES.DRAFT,
      index: true,
    },
    isPublic: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 100 },
    trialDays: { type: Number, default: 0, min: 0 },
    grants: { type: [grantSchema], default: [] },

    createdBy: { type: Schema.Types.ObjectId, ref: 'PlatformAdmin' },
  },
  { timestamps: true }
);

// One document per (key, version); this is what makes pinning meaningful.
planSchema.index({ key: 1, version: -1 }, { unique: true });
planSchema.index({ status: 1, sortOrder: 1 });

planSchema.set('toJSON', { virtuals: true, transform: jsonTransform() });

export const Plan: Model<IPlan> = mongoose.model<IPlan>('Plan', planSchema);

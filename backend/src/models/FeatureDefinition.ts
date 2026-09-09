import mongoose, { Schema, type Document, type Model } from 'mongoose';
import { jsonTransform } from '../lib/toJSON.js';
import type { FeatureKind } from '../entitlements/types.js';

/**
 * The registry of capabilities the product can grant.
 *
 * This collection is what makes the plan builder data-driven: it lists the
 * checkboxes an admin sees. Rows are upserted at boot from the code manifests
 * (`entitlements/manifest.ts`), so shipping a new module makes its features
 * available to plans with no change to the plan system.
 *
 * **Not tenant-scoped** — platform catalogue data. See backend/RULES.md BE-4.
 */
export interface IFeatureDefinition extends Document {
  _id: mongoose.Types.ObjectId;
  /** Canonical namespaced key — `crm.leads`. Stable forever once shipped. */
  key: string;
  moduleKey: string;
  name: string;
  description?: string;
  kind: FeatureKind;

  /**
   * Mirrors into the legacy `organization.features` array under this name.
   * Present only for features that predate the entitlement system; new
   * features are read through `hasFeature`.
   */
  legacyFeatureKey?: string;
  /** Mirrors into the legacy `organization.limits` object under this name. */
  legacyLimitKey?: string;

  /**
   * Applied when a plan grants the feature without saying more. Keeps a plan
   * document from having to restate every default.
   */
  defaultLimit?: number | null;
  defaultConfig?: Record<string, unknown> | null;

  isActive: boolean;
  /** True when declared by a code manifest; false for admin-created keys. */
  isSystem: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

const featureDefinitionSchema = new Schema<IFeatureDefinition>(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      match: [/^[a-z0-9](?:[a-z0-9_.-]{0,78}[a-z0-9])$/, 'Invalid feature key'],
    },
    moduleKey: { type: String, required: true, trim: true, lowercase: true, index: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    kind: {
      type: String,
      required: true,
      enum: ['boolean', 'limit', 'config'] satisfies FeatureKind[],
    },

    legacyFeatureKey: { type: String, trim: true },
    legacyLimitKey: { type: String, trim: true },

    // `null` is meaningful here — "declared, and explicitly nothing" — so the
    // default must not be `undefined`, which Mongoose would strip.
    defaultLimit: { type: Number, default: null },
    defaultConfig: { type: Schema.Types.Mixed, default: null },

    isActive: { type: Boolean, default: true, index: true },
    isSystem: { type: Boolean, default: false },
    sortOrder: { type: Number, default: 100 },
  },
  { timestamps: true }
);

featureDefinitionSchema.index({ moduleKey: 1, sortOrder: 1, key: 1 });

featureDefinitionSchema.set('toJSON', { virtuals: true, transform: jsonTransform() });

export const FeatureDefinition: Model<IFeatureDefinition> =
  mongoose.model<IFeatureDefinition>('FeatureDefinition', featureDefinitionSchema);

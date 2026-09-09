import mongoose, { Schema, type Document, type Model } from 'mongoose';
import { jsonTransform } from '../lib/toJSON.js';

/**
 * A functional area of the product — CRM, Users & access, and whatever ships
 * next. Modules group features in the plan builder; an admin includes a module
 * in a plan and then picks which of its features are granted.
 *
 * **Not tenant-scoped.** This is platform catalogue data, identical for every
 * tenant, read by the control plane. It carries no `organizationId` and so does
 * not apply `tenantPlugin` — see backend/RULES.md BE-4.
 *
 * Rows are upserted at boot from `entitlements/manifest.ts`. Admin edits to
 * `name`, `description` and `sortOrder` survive re-registration; the manifest
 * owns `key` alone.
 */
export interface ICatalogModule extends Document {
  _id: mongoose.Types.ObjectId;
  key: string;
  name: string;
  description?: string;
  /** Reserved for a future Product layer. See ADR-0001. */
  productKey?: string;
  sortOrder: number;
  /**
   * False hides the module from the plan builder without deleting it — the way
   * a module is retired without orphaning the plans that still reference its
   * features.
   */
  isActive: boolean;
  /** True when a code manifest declares it; false for admin-created modules. */
  isSystem: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const catalogModuleSchema = new Schema<ICatalogModule>(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      match: [/^[a-z0-9](?:[a-z0-9_.-]{0,48}[a-z0-9])$/, 'Invalid module key'],
    },
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    productKey: { type: String, trim: true, lowercase: true },
    sortOrder: { type: Number, default: 100 },
    isActive: { type: Boolean, default: true, index: true },
    isSystem: { type: Boolean, default: false },
  },
  { timestamps: true }
);

catalogModuleSchema.index({ sortOrder: 1, key: 1 });

catalogModuleSchema.set('toJSON', { virtuals: true, transform: jsonTransform() });

export const CatalogModule: Model<ICatalogModule> = mongoose.model<ICatalogModule>(
  'CatalogModule',
  catalogModuleSchema
);

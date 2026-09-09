import mongoose, { Schema, type Document, type Model } from 'mongoose';
import { jsonTransform } from '../lib/toJSON.js';
import { grantSchema } from './grantSchema.js';
import type { FeatureGrant } from '../entitlements/types.js';

/**
 * An additive bundle attached on top of a plan.
 *
 * Add-ons exist so a customer who needs one extra capability, or more capacity,
 * does not force the creation of a bespoke plan that then has to be maintained
 * forever. They only ever *add*: features union, limits take the higher value.
 * Anything subtractive is an organization override instead.
 *
 * Unversioned by design. An add-on's terms are re-resolved from the current
 * document whenever a subscription changes, which is acceptable because an
 * add-on is a small increment rather than the contract itself — and the
 * resulting entitlements are still snapshotted, so nothing changes under a
 * tenant until someone re-resolves them.
 *
 * **Not tenant-scoped** — platform catalogue data. See backend/RULES.md BE-4.
 */
export interface IAddOn extends Document {
  _id: mongoose.Types.ObjectId;
  key: string;
  name: string;
  description?: string;
  isActive: boolean;
  grants: FeatureGrant[];
  createdAt: Date;
  updatedAt: Date;
}

const addOnSchema = new Schema<IAddOn>(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      match: [/^[a-z0-9](?:[a-z0-9_-]{0,48}[a-z0-9])$/, 'Invalid add-on key'],
    },
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    isActive: { type: Boolean, default: true, index: true },
    grants: { type: [grantSchema], default: [] },
  },
  { timestamps: true }
);

addOnSchema.set('toJSON', { virtuals: true, transform: jsonTransform() });

export const AddOn: Model<IAddOn> = mongoose.model<IAddOn>('AddOn', addOnSchema);

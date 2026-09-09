import { Schema } from 'mongoose';
import type { FeatureGrant } from '../entitlements/types.js';

/**
 * How a plan or add-on stores what it grants for one feature.
 *
 * Shared so that a plan grant and an add-on grant cannot drift into different
 * shapes — the resolver merges them together and would otherwise have to know
 * about two.
 *
 * `_id: false` because these are value objects addressed by `featureKey`;
 * per-entry ObjectIds would churn on every plan edit and mean nothing.
 */
export const grantSchema = new Schema<FeatureGrant>(
  {
    featureKey: { type: String, required: true, trim: true, lowercase: true },
    enabled: { type: Boolean, required: true, default: false },
    // `null` is a real value — "granted, with nothing further to say" — so these
    // default to null rather than being absent.
    limit: { type: Number, default: null },
    config: { type: Schema.Types.Mixed, default: null },
  },
  { _id: false }
);

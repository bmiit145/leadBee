import mongoose, { Schema, type Document, type Model } from 'mongoose';

/**
 * Per-tenant sequence counters behind `L-0001`-style display numbers.
 *
 * Not registered with `tenantPlugin`: `nextSequence()` passes `organizationId`
 * explicitly, and the counter is also touched during signup — before a tenant
 * scope exists — so an implicit scope would be an ordering hazard rather than a
 * safety net.
 */
export interface ICounter extends Document {
  organizationId: mongoose.Types.ObjectId;
  key: string;
  seq: number;
}

const counterSchema = new Schema<ICounter>({
  organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
  key: { type: String, required: true },
  seq: { type: Number, default: 0 },
});

// One counter per (tenant, key). Unique so a race cannot create two rows that
// then hand out duplicate numbers.
counterSchema.index({ organizationId: 1, key: 1 }, { unique: true });

export const Counter: Model<ICounter> = mongoose.model<ICounter>('Counter', counterSchema);

import mongoose, { Schema, type Document, type Model } from 'mongoose';
import { tenantPlugin } from '../lib/tenantPlugin.js';

/**
 * A single entry in one of a lead's conversation threads.
 *
 * The Lead Details screen shows three threads — "Time Line" (activity
 * comments), "Notes", and "Ask Query" — that are visually the same list with the
 * same composer. They are one collection keyed by `channel` rather than three
 * near-identical models. `resolved` is only meaningful on the `query` channel.
 */
export type LeadThreadChannel = 'timeline' | 'notes' | 'query';

export const LEAD_THREAD_CHANNELS: LeadThreadChannel[] = ['timeline', 'notes', 'query'];

export interface ILeadThreadItem extends Document {
  _id: mongoose.Types.ObjectId;
  organizationId: mongoose.Types.ObjectId;
  lead: mongoose.Types.ObjectId;
  channel: LeadThreadChannel;
  text: string;
  createdByUser: mongoose.Types.ObjectId;
  createdByName: string;
  resolved: boolean;
  /** Set when the entry has been edited, so the UI can mark it. */
  editedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const leadThreadItemSchema = new Schema<ILeadThreadItem>(
  {
    lead: { type: Schema.Types.ObjectId, ref: 'Lead', required: true },
    channel: { type: String, enum: LEAD_THREAD_CHANNELS, required: true },
    text: { type: String, required: true, trim: true },
    createdByUser: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    createdByName: { type: String, required: true, trim: true },
    resolved: { type: Boolean, default: false },
    editedAt: { type: Date },
  },
  { timestamps: true }
);

leadThreadItemSchema.plugin(tenantPlugin);

// The panel always reads one lead's one channel, newest first.
leadThreadItemSchema.index({ organizationId: 1, lead: 1, channel: 1, createdAt: -1 });
// Open-queries badge.
leadThreadItemSchema.index(
  { organizationId: 1, channel: 1, resolved: 1 },
  { partialFilterExpression: { channel: 'query' } }
);

export const LeadThreadItem: Model<ILeadThreadItem> = mongoose.model<ILeadThreadItem>(
  'LeadThreadItem',
  leadThreadItemSchema
);

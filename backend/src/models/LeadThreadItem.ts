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

/**
 * `comment` is written by a person. `activity` is written by LeadBee when
 * something happens to the lead — a stage change, a call, a meeting — so the
 * Time Line is the lead's history, not only what someone remembered to type.
 * Activity entries cannot be edited or deleted.
 */
export type LeadThreadKind = 'comment' | 'activity';

export const LEAD_ACTIVITY_EVENTS = [
  'lead_created',
  'stage_changed',
  'lead_reassigned',
  'lead_transfer_requested',
  'lead_transferred',
  'lead_transfer_declined',
  'lead_transfer_cancelled',
  'lead_restored',
  'call_logged',
  'call_updated',
  'call_deleted',
  'meeting_booked',
  'meeting_rescheduled',
  'meeting_completed',
  'meeting_cancelled',
  'meeting_reopened',
  'task_created',
  'task_completed',
] as const;

export type LeadActivityEvent = (typeof LEAD_ACTIVITY_EVENTS)[number];

export interface ILeadThreadItem extends Document {
  _id: mongoose.Types.ObjectId;
  organizationId: mongoose.Types.ObjectId;
  lead: mongoose.Types.ObjectId;
  channel: LeadThreadChannel;
  kind: LeadThreadKind;
  /** What happened, for `activity` entries — a stable code the app can style. */
  event?: LeadActivityEvent;
  /** Ids and values behind an activity (meeting id, stages). Never credentials. */
  meta?: Record<string, unknown>;
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
    kind: { type: String, enum: ['comment', 'activity'], default: 'comment' },
    event: { type: String, enum: LEAD_ACTIVITY_EVENTS },
    meta: { type: Schema.Types.Mixed },
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

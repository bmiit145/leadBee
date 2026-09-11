import mongoose, { Schema, type Document, type Model } from 'mongoose';
import { tenantPlugin } from '../lib/tenantPlugin.js';

/**
 * One entry in a user's in-app inbox, and the record a push is sent from.
 *
 * Stores *what happened* — a type, the entity, who did it and a display
 * subject — never rendered sentences. The app translates from `type`, so the
 * inbox reads in the user's language; only the OS-rendered push text is fixed
 * at send time. See docs/adr/0002-notifications.md.
 */
export const NOTIFICATION_TYPES = {
  lead_assigned: 'lead',
  task_assigned: 'task',
  meeting_assigned: 'meeting',
} as const;

export type NotificationType = keyof typeof NOTIFICATION_TYPES;
export type NotificationEntity = (typeof NOTIFICATION_TYPES)[NotificationType];

export const NOTIFICATION_TYPE_ORDER = Object.keys(NOTIFICATION_TYPES) as NotificationType[];

/** Inbox entries are a feed, not a record — they age out rather than pile up. */
const RETENTION_DAYS = 90;

export interface INotification extends Document {
  _id: mongoose.Types.ObjectId;
  organizationId: mongoose.Types.ObjectId;
  recipient: mongoose.Types.ObjectId;
  type: NotificationType;
  entityType: NotificationEntity;
  entityId: mongoose.Types.ObjectId;
  actor: mongoose.Types.ObjectId;
  actorName: string;
  /** What the row is about — a lead's contact name, a task's subject. */
  subject: string;
  /** When the thing itself happens, where that matters (a meeting, a due date). */
  at?: Date;
  readAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const notificationSchema = new Schema<INotification>(
  {
    recipient: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: NOTIFICATION_TYPE_ORDER, required: true },
    entityType: { type: String, enum: Object.values(NOTIFICATION_TYPES), required: true },
    entityId: { type: Schema.Types.ObjectId, required: true },
    actor: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    actorName: { type: String, required: true, trim: true },
    subject: { type: String, required: true, trim: true },
    at: { type: Date },
    readAt: { type: Date },
  },
  { timestamps: true }
);

notificationSchema.plugin(tenantPlugin);

// The inbox, newest first.
notificationSchema.index({ organizationId: 1, recipient: 1, createdAt: -1 });
// The unread badge.
notificationSchema.index({ organizationId: 1, recipient: 1, readAt: 1 });
// Retention. A TTL index must be declared on the date field alone, which is
// why this is the one index here that does not lead with organizationId.
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: RETENTION_DAYS * 24 * 60 * 60 });

export const Notification: Model<INotification> = mongoose.model<INotification>(
  'Notification',
  notificationSchema
);

import mongoose, { Schema, type Document, type Model } from 'mongoose';
import { tenantPlugin } from '../lib/tenantPlugin.js';
import { tenantJsonTransform } from '../lib/toJSON.js';

export const MEETING_TYPES = {
  OFFICE_VISIT: 'office_visit',
  SITE_VISIT: 'site_visit',
  CLIENT_OFFICE: 'client_office',
  PHONE_CALL: 'phone_call',
  // These two are distinct entries (not a generic "online") because the type
  // picker lists them by name.
  GOOGLE_MEET: 'google_meet',
  ZOOM: 'zoom',
} as const;

export type MeetingType = (typeof MEETING_TYPES)[keyof typeof MEETING_TYPES];

export const MEETING_TYPE_ORDER: MeetingType[] = [
  'office_visit',
  'site_visit',
  'client_office',
  'phone_call',
  'google_meet',
  'zoom',
];

export const MEETING_STATUSES = {
  SCHEDULED: 'scheduled',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  RESCHEDULED: 'rescheduled',
} as const;

export type MeetingStatus = (typeof MEETING_STATUSES)[keyof typeof MEETING_STATUSES];

export const MEETING_STATUS_ORDER: MeetingStatus[] = [
  'scheduled',
  'completed',
  'cancelled',
  'rescheduled',
];

export interface IMeetingComment {
  _id?: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  userName: string;
  text: string;
  createdAt: Date;
}

export interface IMeeting extends Document {
  _id: mongoose.Types.ObjectId;
  organizationId: mongoose.Types.ObjectId;
  meetingNumber: string;
  leadId: mongoose.Types.ObjectId;
  /** Date and start time combined, so ordering and overlap checks are one
   *  comparison rather than a date plus a time-of-day field. */
  scheduledAt: Date;
  durationMinutes: number;
  assignedTo: mongoose.Types.ObjectId[];
  meetingType: MeetingType;
  purpose?: mongoose.Types.ObjectId;
  /** Free-text notes posted one at a time from the "Meeting Purpose" composer —
   *  an editable comment thread rather than a single field. */
  comments: IMeetingComment[];
  notes?: string;
  /** Minutes before `scheduledAt` to remind, one entry per reminder the user has
   *  stacked (e.g. 5 AND 120 minutes before, both fire independently). */
  reminderMinutesBefore: number[];
  status: MeetingStatus;
  /** The task raised automatically when this meeting was booked. */
  linkedTaskId?: mongoose.Types.ObjectId;
  outcome?: string;
  createdBy: mongoose.Types.ObjectId;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  readonly endsAt: Date;
}

const meetingCommentSchema = new Schema<IMeetingComment>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    userName: { type: String, required: true, trim: true },
    text: { type: String, required: true, trim: true },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const meetingSchema = new Schema<IMeeting>(
  {
    meetingNumber: { type: String, required: true },
    leadId: { type: Schema.Types.ObjectId, ref: 'Lead', required: true },
    scheduledAt: { type: Date, required: true },
    durationMinutes: { type: Number, default: 30, min: 5 },
    assignedTo: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    meetingType: { type: String, enum: MEETING_TYPE_ORDER, required: true },
    purpose: { type: Schema.Types.ObjectId, ref: 'PurposeOfInquiry' },
    comments: { type: [meetingCommentSchema], default: [] },
    notes: { type: String, trim: true },
    reminderMinutesBefore: { type: [Number], default: [] },
    status: { type: String, enum: MEETING_STATUS_ORDER, default: 'scheduled' },
    linkedTaskId: { type: Schema.Types.ObjectId, ref: 'Task' },
    outcome: { type: String, trim: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

meetingSchema.plugin(tenantPlugin);

meetingSchema.index({ organizationId: 1, meetingNumber: 1 }, { unique: true });
// Calendar screen: one user's day/week.
meetingSchema.index({ organizationId: 1, assignedTo: 1, scheduledAt: 1 });
meetingSchema.index({ organizationId: 1, leadId: 1, scheduledAt: -1 });
meetingSchema.index({ organizationId: 1, status: 1, scheduledAt: 1 });

/** Virtual end time, for overlap checks and calendar rendering. */
meetingSchema.virtual('endsAt').get(function (this: IMeeting) {
  return new Date(this.scheduledAt.getTime() + this.durationMinutes * 60_000);
});

meetingSchema.set('toJSON', { virtuals: true, transform: tenantJsonTransform() });

export const Meeting: Model<IMeeting> = mongoose.model<IMeeting>('Meeting', meetingSchema);

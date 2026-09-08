import mongoose, { Schema, type Document, type Model } from 'mongoose';
import { tenantPlugin } from '../lib/tenantPlugin.js';
import { tenantJsonTransform } from '../lib/toJSON.js';

export const TASK_STATUSES = {
  PENDING: 'pending',
  IN_PROGRESS: 'in_progress',
  ON_HOLD: 'on_hold',
  IN_REVIEW: 'in_review',
  COMPLETED: 'completed',
} as const;

export type TaskStatus = (typeof TASK_STATUSES)[keyof typeof TASK_STATUSES];

export const TASK_STATUS_ORDER: TaskStatus[] = [
  'pending',
  'in_progress',
  'on_hold',
  'in_review',
  'completed',
];

/** Where a task came from. Auto-generated ones are not hand-created by a user. */
export type TaskOrigin = 'manual' | 'meeting';

export interface IChecklistItem {
  _id?: mongoose.Types.ObjectId;
  text: string;
  done: boolean;
}

export interface ITaskLabel {
  name: string;
  color: string;
}

export interface ITaskComment {
  _id?: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  userName: string;
  text: string;
  createdAt: Date;
}

export interface ITask extends Document {
  _id: mongoose.Types.ObjectId;
  organizationId: mongoose.Types.ObjectId;
  taskNumber: string;
  subject: string;
  description?: string;
  startDate: Date;
  endDate: Date;
  status: TaskStatus;
  assignedTo: mongoose.Types.ObjectId[];
  checklist: IChecklistItem[];
  labels: ITaskLabel[];
  images: string[];
  comments: ITaskComment[];
  leadId?: mongoose.Types.ObjectId;
  /** Set when this task was raised automatically alongside a meeting. */
  meetingId?: mongoose.Types.ObjectId;
  origin: TaskOrigin;
  createdBy: mongoose.Types.ObjectId;
  completedAt?: Date;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const checklistSchema = new Schema<IChecklistItem>(
  {
    text: { type: String, required: true, trim: true },
    done: { type: Boolean, default: false },
  },
  { _id: true }
);

const labelSchema = new Schema<ITaskLabel>(
  {
    name: { type: String, required: true, trim: true },
    color: { type: String, required: true, trim: true },
  },
  { _id: false }
);

const commentSchema = new Schema<ITaskComment>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    userName: { type: String, required: true, trim: true },
    text: { type: String, required: true, trim: true },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const taskSchema = new Schema<ITask>(
  {
    taskNumber: { type: String, required: true },
    subject: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    status: { type: String, enum: TASK_STATUS_ORDER, default: 'pending' },
    assignedTo: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    checklist: { type: [checklistSchema], default: [] },
    labels: { type: [labelSchema], default: [] },
    images: { type: [String], default: [] },
    comments: { type: [commentSchema], default: [] },
    leadId: { type: Schema.Types.ObjectId, ref: 'Lead' },
    meetingId: { type: Schema.Types.ObjectId, ref: 'Meeting' },
    origin: { type: String, enum: ['manual', 'meeting'], default: 'manual' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    completedAt: { type: Date },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

taskSchema.plugin(tenantPlugin);

taskSchema.index({ organizationId: 1, taskNumber: 1 }, { unique: true });
taskSchema.index({ organizationId: 1, assignedTo: 1, status: 1, endDate: 1 });
taskSchema.index({ organizationId: 1, createdBy: 1, status: 1 });
taskSchema.index({ organizationId: 1, leadId: 1, createdAt: -1 });
taskSchema.index({ organizationId: 1, endDate: 1, status: 1 });

/** Keeps completedAt honest without callers having to remember to set it. */
taskSchema.pre('save', function () {
  if (this.isModified('status')) {
    if (this.status === 'completed' && !this.completedAt) this.completedAt = new Date();
    if (this.status !== 'completed') this.completedAt = undefined;
  }
});

taskSchema.set('toJSON', { virtuals: true, transform: tenantJsonTransform() });

export const Task: Model<ITask> = mongoose.model<ITask>('Task', taskSchema);

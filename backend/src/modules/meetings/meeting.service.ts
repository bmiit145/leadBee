import { Types, type FilterQuery } from 'mongoose';
import { Meeting, type IMeeting, type MeetingStatus } from '../../models/Meeting.js';
import { Task } from '../../models/Task.js';
import { Lead } from '../../models/Lead.js';
import { AppError } from '../../lib/errors.js';
import { nextDisplayNumber } from '../../lib/counters.js';
import { pageParams } from '../../lib/pagination.js';
import type { Viewer } from '../leads/lead.service.js';

export interface MeetingFilters {
  status?: string;
  leadId?: string;
  assignedTo?: string;
  dateFrom?: string;
  dateTo?: string;
  scope?: 'today' | 'tomorrow' | 'upcoming' | 'past';
  page?: number;
  limit?: number;
}

function dayBounds(base: Date): { start: Date; end: Date } {
  const start = new Date(base);
  start.setHours(0, 0, 0, 0);
  const end = new Date(base);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

function scopeToRange(
  scope: MeetingFilters['scope']
): { $gte?: Date; $lte?: Date; $lt?: Date } | null {
  const now = new Date();
  if (scope === 'today') {
    const { start, end } = dayBounds(now);
    return { $gte: start, $lte: end };
  }
  if (scope === 'tomorrow') {
    const t = new Date(now);
    t.setDate(t.getDate() + 1);
    const { start, end } = dayBounds(t);
    return { $gte: start, $lte: end };
  }
  if (scope === 'upcoming') return { $gte: now };
  if (scope === 'past') return { $lt: now };
  return null;
}

/** Booking window, in minutes from midnight. 08:30 → 20:00. */
const DAY_START_MIN = 8 * 60 + 30;
const DAY_END_MIN = 20 * 60;

export type SlotState = 'free' | 'busy' | 'past';

export interface MeetingSlot {
  /** ISO start/end, so the client never re-derives times from strings. */
  start: string;
  end: string;
  state: SlotState;
  /** Meeting number occupying the slot, when busy. */
  busyWith?: string;
}

const POPULATE = [
  { path: 'leadId', select: 'leadNumber contactName contactPhone stage' },
  { path: 'assignedTo', select: 'name phone role avatarUrl' },
  { path: 'purpose', select: 'name' },
  { path: 'linkedTaskId', select: 'taskNumber subject status endDate' },
] as const;

export const meetingService = {
  /**
   * Slots for a day, marked free / busy / past.
   *
   * Availability is per-attendee: a slot is busy if it overlaps an existing
   * meeting for *any* of the people being booked, which is why the time picker
   * cannot be filled in before a date and assignees are known.
   */
  async getSlots(
    dateISO: string,
    durationMinutes: number,
    userIds: string[],
    excludeMeetingId?: string
  ): Promise<{ slots: MeetingSlot[]; availableCount: number; durationMinutes: number }> {
    const day = new Date(dateISO);
    if (Number.isNaN(day.getTime())) throw AppError.badRequest('Invalid date');

    const { start: dayStart, end: dayEnd } = dayBounds(day);

    const conflictQuery: FilterQuery<IMeeting> = {
      isActive: true,
      status: { $in: ['scheduled', 'rescheduled'] },
      scheduledAt: { $gte: dayStart, $lte: dayEnd },
    };
    if (userIds.length > 0) {
      conflictQuery.assignedTo = { $in: userIds.map((id) => new Types.ObjectId(id)) };
    }
    if (excludeMeetingId) {
      conflictQuery._id = { $ne: new Types.ObjectId(excludeMeetingId) };
    }

    const existing = await Meeting.find(conflictQuery)
      .select('meetingNumber scheduledAt durationMinutes')
      .lean();

    const booked = existing.map((m) => ({
      number: m.meetingNumber,
      from: m.scheduledAt.getTime(),
      to: m.scheduledAt.getTime() + m.durationMinutes * 60_000,
    }));

    const now = Date.now();
    const slots: MeetingSlot[] = [];

    for (
      let min = DAY_START_MIN;
      min + durationMinutes <= DAY_END_MIN;
      min += durationMinutes
    ) {
      const start = new Date(dayStart);
      start.setHours(0, min, 0, 0);
      const end = new Date(start.getTime() + durationMinutes * 60_000);

      let state: SlotState = 'free';
      let busyWith: string | undefined;

      if (end.getTime() <= now) {
        state = 'past';
      } else {
        // Overlap: starts before the other ends AND ends after it starts.
        const clash = booked.find(
          (b) => start.getTime() < b.to && end.getTime() > b.from
        );
        if (clash) {
          state = 'busy';
          busyWith = clash.number;
        }
      }

      slots.push({ start: start.toISOString(), end: end.toISOString(), state, busyWith });
    }

    return {
      slots,
      availableCount: slots.filter((s) => s.state === 'free').length,
      durationMinutes,
    };
  },

  /**
   * Books a meeting and raises its follow-up task in the same call.
   *
   * Scheduling a meeting always implies work — prepare, attend, record the
   * outcome — so the task is created alongside rather than left to the user to
   * remember. The pair is linked both ways (`meeting.linkedTaskId` /
   * `task.meetingId`) so cancelling one can clean up the other.
   */
  async create(data: Record<string, unknown>, viewer: Viewer): Promise<IMeeting> {
    const lead = await Lead.findOne({ _id: data.leadId as string, isActive: true });
    if (!lead) throw AppError.notFound('Lead not found');

    const meetingNumber = await nextDisplayNumber('meeting');
    const meeting = await Meeting.create({
      ...sanitize(data),
      meetingNumber,
      createdBy: viewer.userId,
    });

    // Assignees default to whoever booked it, so the task is never orphaned.
    const assignees =
      meeting.assignedTo && meeting.assignedTo.length > 0
        ? meeting.assignedTo
        : [viewer.userId];

    const taskNumber = await nextDisplayNumber('task');
    const task = await Task.create({
      taskNumber,
      subject: `Meeting: ${lead.contactName}`,
      description:
        `Auto-created for meeting ${meetingNumber} with ${lead.contactName} ` +
        `(${lead.contactPhone}).`,
      // The task window runs from now until the meeting ends — that is the
      // period in which the prep work actually has to happen.
      startDate: new Date(),
      endDate: new Date(
        meeting.scheduledAt.getTime() + meeting.durationMinutes * 60_000
      ),
      status: 'pending',
      assignedTo: assignees,
      leadId: meeting.leadId,
      meetingId: meeting._id,
      origin: 'meeting',
      createdBy: viewer.userId,
    });

    meeting.linkedTaskId = task._id;
    await meeting.save();

    return meeting.populate(POPULATE as unknown as string[]);
  },

  async list(filters: MeetingFilters, viewer: Viewer) {
    const query: FilterQuery<IMeeting> = { isActive: true };

    if (!viewer.isOrganizer) {
      query.assignedTo = viewer.userId;
    } else if (filters.assignedTo) {
      query.assignedTo = new Types.ObjectId(filters.assignedTo);
    }

    if (filters.status) query.status = filters.status;
    if (filters.leadId) query.leadId = new Types.ObjectId(filters.leadId);

    const range = scopeToRange(filters.scope);
    if (range) {
      query.scheduledAt = range;
    } else if (filters.dateFrom || filters.dateTo) {
      const bounds: Record<string, Date> = {};
      if (filters.dateFrom) bounds.$gte = new Date(filters.dateFrom);
      if (filters.dateTo) {
        const end = new Date(filters.dateTo);
        end.setHours(23, 59, 59, 999);
        bounds.$lte = end;
      }
      query.scheduledAt = bounds;
    }

    const { page, limit, skip } = pageParams(filters);

    const [data, total] = await Promise.all([
      Meeting.find(query)
        .populate(POPULATE as unknown as string[])
        .sort({ scheduledAt: 1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Meeting.countDocuments(query),
    ]);

    return { data, total, page, limit };
  },

  async getById(meetingId: string): Promise<IMeeting> {
    const meeting = await Meeting.findOne({ _id: meetingId, isActive: true }).populate(
      POPULATE as unknown as string[]
    );
    if (!meeting) throw AppError.notFound('Meeting not found');
    return meeting;
  },

  async update(meetingId: string, data: Record<string, unknown>): Promise<IMeeting> {
    const meeting = await Meeting.findOne({ _id: meetingId, isActive: true });
    if (!meeting) throw AppError.notFound('Meeting not found');

    const safe = sanitize(data);
    Object.assign(meeting, safe);
    await meeting.save();

    // Keep the companion task's window aligned when a meeting moves.
    if (meeting.linkedTaskId && (safe.scheduledAt || safe.durationMinutes)) {
      await Task.updateOne(
        { _id: meeting.linkedTaskId },
        {
          endDate: new Date(
            meeting.scheduledAt.getTime() + meeting.durationMinutes * 60_000
          ),
        }
      );
    }

    return meeting.populate(POPULATE as unknown as string[]);
  },

  /**
   * Completing or cancelling a meeting resolves its task too — otherwise every
   * past meeting leaves a permanently open task behind.
   */
  async setStatus(
    meetingId: string,
    status: MeetingStatus,
    outcome?: string
  ): Promise<IMeeting> {
    const meeting = await Meeting.findOne({ _id: meetingId, isActive: true });
    if (!meeting) throw AppError.notFound('Meeting not found');

    meeting.status = status;
    if (outcome) meeting.outcome = outcome;
    await meeting.save();

    if (meeting.linkedTaskId) {
      const task = await Task.findById(meeting.linkedTaskId);
      // Only auto-created tasks are touched, and only if still open — a task the
      // user has actively worked on is left alone.
      if (task && task.origin === 'meeting' && task.status !== 'completed') {
        if (status === 'completed') {
          task.status = 'completed';
          await task.save();
        } else if (status === 'cancelled') {
          task.isActive = false;
          await task.save();
        }
      }
    }

    return meeting.populate(POPULATE as unknown as string[]);
  },

  /** Posts one entry to the meeting's "Meeting Purpose" comment thread. */
  async addComment(meetingId: string, text: string, viewer: Viewer): Promise<IMeeting> {
    const meeting = await Meeting.findOne({ _id: meetingId, isActive: true });
    if (!meeting) throw AppError.notFound('Meeting not found');

    meeting.comments.push({
      userId: viewer.userId,
      userName: viewer.name,
      text,
      createdAt: new Date(),
    });
    await meeting.save();
    return meeting;
  },

  async remove(meetingId: string): Promise<void> {
    const meeting = await Meeting.findById(meetingId);
    if (!meeting) throw AppError.notFound('Meeting not found');
    meeting.isActive = false;
    await meeting.save();

    if (meeting.linkedTaskId) {
      await Task.updateOne(
        { _id: meeting.linkedTaskId, origin: 'meeting' },
        { isActive: false }
      );
    }
  },
};

function sanitize(data: Record<string, unknown>): Record<string, unknown> {
  const {
    meetingNumber: _meetingNumber,
    createdBy: _createdBy,
    linkedTaskId: _linkedTaskId,
    comments: _comments,
    organizationId: _organizationId,
    isActive: _isActive,
    ...safe
  } = data;

  if (typeof safe.scheduledAt === 'string') {
    safe.scheduledAt = new Date(safe.scheduledAt);
  }
  if (Array.isArray(safe.assignedTo)) {
    safe.assignedTo = (safe.assignedTo as string[]).map((id) => new Types.ObjectId(id));
  }
  for (const field of ['leadId', 'purpose'] as const) {
    if (typeof safe[field] === 'string') {
      safe[field] = new Types.ObjectId(safe[field] as string);
    }
  }
  return safe;
}

import { Types, type FilterQuery } from 'mongoose';
import {
  Meeting,
  type IMeeting,
  type MeetingStatus,
  type MeetingType,
} from '../../models/Meeting.js';
import { Task } from '../../models/Task.js';
import { Lead, type ILead } from '../../models/Lead.js';
import { PurposeOfInquiry } from '../../models/PurposeOfInquiry.js';
import { AppError } from '../../lib/errors.js';
import { nextDisplayNumber } from '../../lib/counters.js';
import { pageParams } from '../../lib/pagination.js';
import {
  addDays,
  calendarDayOf,
  dayBounds,
  dayRange,
  formatWhen,
  parseCalendarDay,
  zonedInstant,
} from '../../lib/zonedTime.js';
import { zoneOf } from '../../lib/viewer.js';
import {
  LEAD_STAGE_ORDER,
  VALID_LEAD_STAGE_TRANSITIONS,
} from '../../config/constants.js';
import { notificationService } from '../notifications/notification.service.js';
import { findVisibleLead, leadIsVisible, type Viewer } from '../leads/lead.service.js';
import { leadThreadService } from '../leads/leadThread.service.js';
import { assertActiveMembers } from '../work/members.js';
import { canManage, canWorkOn } from '../work/workAccess.js';

/**
 * The meeting list's tabs. `missed` is a meeting still marked scheduled (or
 * rescheduled) whose end time has passed without anyone completing or
 * cancelling it.
 */
export type MeetingTab =
  | 'all'
  | 'today'
  | 'tomorrow'
  | 'upcoming'
  | 'completed'
  | 'cancelled'
  | 'rescheduled'
  | 'missed';

export const MEETING_TABS: MeetingTab[] = [
  'all',
  'today',
  'tomorrow',
  'upcoming',
  'completed',
  'cancelled',
  'rescheduled',
  'missed',
];

export interface MeetingFilters {
  status?: string;
  leadId?: string;
  assignedTo?: string;
  dateFrom?: string;
  dateTo?: string;
  scope?: MeetingTab | 'past';
  /** Customer name, mobile or lead number, or the meeting number. */
  search?: string;
  meetingType?: string;
  purpose?: string;
  page?: number;
  limit?: number;
}

export interface MeetingInput {
  leadId?: string;
  scheduledAt?: string;
  durationMinutes?: number;
  assignedTo?: string[];
  meetingType?: string;
  purpose?: string;
  notes?: string;
  reminderMinutesBefore?: number[];
  /** Typed on the create form's "Meeting Purpose" composer before the meeting existed. */
  comments?: Array<{ text: string }>;
}

/** Booking window, in minutes from midnight in the user's zone. 08:30 → 20:00. */
const DAY_START_MIN = 8 * 60 + 30;
const DAY_END_MIN = 20 * 60;

/** A meeting still going to happen. Only these block a slot. */
const OPEN_STATUSES: MeetingStatus[] = ['scheduled', 'rescheduled'];

/** The longest a meeting may run — how far back an overlapping meeting can start. */
const MAX_DURATION_MS = 480 * 60_000;

/** A slot picked a moment before submitting is still "now", not the past. */
const PAST_GRACE_MS = 5 * 60_000;

export type SlotState = 'free' | 'busy' | 'past';

export interface MeetingSlot {
  /** ISO start/end, so the client never re-derives times from strings. */
  start: string;
  end: string;
  state: SlotState;
  /** Meeting number occupying the slot, when busy. */
  busyWith?: string;
}

/**
 * The lead is populated with what the meeting screens show about the customer:
 * deal value, priority, source and purpose, alongside who they are.
 */
const POPULATE = [
  {
    path: 'leadId',
    select:
      'leadNumber contactName contactPhone stage priority source sourceDetail interestedIn budgetMin budgetMax address',
  },
  { path: 'assignedTo', select: 'name phone role avatarUrl' },
  { path: 'createdBy', select: 'name role avatarUrl' },
  { path: 'purpose', select: 'name' },
  { path: 'linkedTaskId', select: 'taskNumber subject status endDate' },
] as const;

function assertNotPast(start: Date): void {
  if (Number.isNaN(start.getTime())) throw AppError.badRequest('Invalid meeting time');
  if (start.getTime() < Date.now() - PAST_GRACE_MS) {
    throw new AppError('A meeting cannot be scheduled in the past.', 400, 'MEETING_IN_PAST');
  }
}

/**
 * Nobody attends two meetings at once. The slot list only *shows* free time;
 * this is the rule, so two people booking the same slot, or an old app build,
 * cannot double-book an attendee.
 */
async function assertNoConflict(
  attendees: Types.ObjectId[],
  start: Date,
  durationMinutes: number,
  excludeMeetingId?: Types.ObjectId
): Promise<void> {
  const end = new Date(start.getTime() + durationMinutes * 60_000);
  const candidates = await Meeting.find({
    isActive: true,
    status: { $in: OPEN_STATUSES },
    assignedTo: { $in: attendees },
    scheduledAt: { $lt: end, $gte: new Date(start.getTime() - MAX_DURATION_MS) },
    ...(excludeMeetingId ? { _id: { $ne: excludeMeetingId } } : {}),
  })
    .select('meetingNumber scheduledAt durationMinutes')
    .lean();

  const clash = candidates.find(
    (m) => m.scheduledAt.getTime() + m.durationMinutes * 60_000 > start.getTime()
  );
  if (clash) {
    throw new AppError(
      `That time overlaps meeting ${clash.meetingNumber} for one of the attendees. Pick another slot.`,
      409,
      'MEETING_CONFLICT',
      { meetingNumber: clash.meetingNumber }
    );
  }
}

async function assertPurpose(purpose: string | undefined): Promise<Types.ObjectId | undefined> {
  if (!purpose) return undefined;
  const exists = Types.ObjectId.isValid(purpose)
    ? await PurposeOfInquiry.exists({ _id: purpose, isActive: true })
    : null;
  if (!exists) throw AppError.badRequest('That meeting purpose does not exist');
  return new Types.ObjectId(purpose);
}

/** Open it, comment, reschedule, complete or cancel: an attendee, its booker, an organizer, or the owner of its lead. */
async function assertCanWork(meeting: IMeeting, viewer: Viewer): Promise<void> {
  if (canWorkOn(meeting, viewer)) return;
  if (await leadIsVisible(idOf(meeting.leadId), viewer)) return;
  throw AppError.forbidden('Access denied');
}

function idOf(value: unknown): string {
  return typeof value === 'object' && value !== null && '_id' in value
    ? String((value as { _id: unknown })._id)
    : String(value);
}

/** User input goes into a RegExp; `.` and `*` would otherwise be operators. */
function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Everything about a meeting list except which tab is open: who may see what,
 * the lead, the member, the filters and the search. Shared by the list and the
 * tab counts, so a tab's number is exactly the rows it shows.
 */
async function baseQuery(filters: MeetingFilters, viewer: Viewer): Promise<FilterQuery<IMeeting>> {
  const query: FilterQuery<IMeeting> = { isActive: true };
  const clauses: FilterQuery<IMeeting>[] = [];

  if (filters.leadId) {
    // Everyone who can see a lead sees all of its meetings.
    if (!(await leadIsVisible(filters.leadId, viewer))) throw AppError.forbidden('Access denied');
    query.leadId = new Types.ObjectId(filters.leadId);
  } else if (!viewer.isOrganizer) {
    // Meetings they attend, and ones they booked for a colleague.
    clauses.push({ $or: [{ assignedTo: viewer.userId }, { createdBy: viewer.userId }] });
  } else if (filters.assignedTo) {
    query.assignedTo = new Types.ObjectId(filters.assignedTo);
  }

  if (filters.meetingType) query.meetingType = filters.meetingType as MeetingType;
  if (filters.purpose && Types.ObjectId.isValid(filters.purpose)) {
    query.purpose = new Types.ObjectId(filters.purpose);
  }

  let range: ReturnType<typeof dayRange>;
  try {
    range = dayRange(filters.dateFrom, filters.dateTo, zoneOf(viewer));
  } catch (error) {
    throw AppError.badRequest(error instanceof Error ? error.message : 'Invalid date filter');
  }
  if (range) clauses.push({ scheduledAt: range });

  const term = filters.search?.trim();
  if (term) {
    // The customer is on the lead, so the search finds the leads first. Visibility
    // is still the meeting's own rule above — a matching lead adds no access.
    const regex = new RegExp(escapeRegex(term), 'i');
    const leadIds = await Lead.distinct('_id', {
      $or: [{ contactName: regex }, { contactPhone: regex }, { leadNumber: regex }],
    });
    clauses.push({ $or: [{ leadId: { $in: leadIds } }, { meetingNumber: regex }] });
  }

  if (clauses.length > 0) query.$and = clauses;
  return query;
}

/** The condition one tab adds, in the viewer's time zone. */
function tabClause(tab: MeetingTab | 'past', viewer: Viewer, now: Date): FilterQuery<IMeeting> {
  const timeZone = zoneOf(viewer);
  switch (tab) {
    case 'today':
    case 'tomorrow': {
      const today = calendarDayOf(now, timeZone);
      const { start, end } = dayBounds(tab === 'tomorrow' ? addDays(today, 1) : today, timeZone);
      return { scheduledAt: { $gte: start, $lte: end } };
    }
    case 'upcoming':
      // Still going to happen: a cancelled future meeting is not upcoming.
      return { scheduledAt: { $gte: now }, status: { $in: OPEN_STATUSES } };
    case 'completed':
    case 'cancelled':
    case 'rescheduled':
      return { status: tab };
    case 'missed':
      return {
        status: { $in: OPEN_STATUSES },
        scheduledAt: { $lt: now },
        $expr: {
          $lt: [{ $add: ['$scheduledAt', { $multiply: ['$durationMinutes', 60_000] }] }, now],
        },
      };
    case 'past':
      return { scheduledAt: { $lt: now } };
    default:
      return {};
  }
}

function withClauses(
  base: FilterQuery<IMeeting>,
  extra: FilterQuery<IMeeting>[]
): FilterQuery<IMeeting> {
  const clauses = extra.filter((clause) => Object.keys(clause).length > 0);
  if (clauses.length === 0) return base;
  return { ...base, $and: [...((base.$and as FilterQuery<IMeeting>[]) ?? []), ...clauses] };
}

async function findActive(meetingId: string): Promise<IMeeting> {
  if (!Types.ObjectId.isValid(meetingId)) throw AppError.notFound('Meeting not found');
  const meeting = await Meeting.findOne({ _id: meetingId, isActive: true });
  if (!meeting) throw AppError.notFound('Meeting not found');
  return meeting;
}

/**
 * Booking a meeting with a lead that has not got that far moves it to
 * Meeting. A lead already past it — a proposal sent, an order in — stays put.
 */
async function advanceLeadToMeeting(lead: ILead, viewer: Viewer): Promise<void> {
  const current = LEAD_STAGE_ORDER.indexOf(lead.stage);
  const meeting = LEAD_STAGE_ORDER.indexOf('meeting');
  if (current >= meeting) return;
  if (!(VALID_LEAD_STAGE_TRANSITIONS[lead.stage] ?? []).includes('meeting')) return;

  const previous = lead.stage;
  lead.stage = 'meeting';
  await lead.save();
  await leadThreadService.recordActivity(
    lead._id,
    'stage_changed',
    `Moved from ${previous.replace(/_/g, ' ')} to meeting when a meeting was booked`,
    viewer,
    { from: previous, to: 'meeting' }
  );
}

export const meetingService = {
  /**
   * Slots for a day, marked free / busy / past, in the user's time zone.
   *
   * Availability is per-attendee: a slot is busy if it overlaps an open meeting
   * for *any* of the people being booked. With nobody chosen yet, the caller is
   * the attendee — never "everyone in the organization".
   */
  async getSlots(
    dateInput: string,
    durationMinutes: number,
    userIds: string[],
    excludeMeetingId: string | undefined,
    viewer: Viewer
  ): Promise<{ slots: MeetingSlot[]; availableCount: number; durationMinutes: number }> {
    const timeZone = zoneOf(viewer);
    const day = parseCalendarDay(dateInput, timeZone);
    if (!day) throw AppError.badRequest('Invalid date');

    const { start: dayStart, end: dayEnd } = dayBounds(day, timeZone);
    const attendees = userIds.filter((id) => Types.ObjectId.isValid(id));

    const existing = await Meeting.find({
      isActive: true,
      status: { $in: OPEN_STATUSES },
      scheduledAt: { $gte: new Date(dayStart.getTime() - MAX_DURATION_MS), $lte: dayEnd },
      assignedTo: {
        $in: attendees.length > 0 ? attendees.map((id) => new Types.ObjectId(id)) : [viewer.userId],
      },
      ...(excludeMeetingId ? { _id: { $ne: new Types.ObjectId(excludeMeetingId) } } : {}),
    })
      .select('meetingNumber scheduledAt durationMinutes')
      .lean();

    const booked = existing.map((m) => ({
      number: m.meetingNumber,
      from: m.scheduledAt.getTime(),
      to: m.scheduledAt.getTime() + m.durationMinutes * 60_000,
    }));

    const now = Date.now();
    const slots: MeetingSlot[] = [];

    for (let min = DAY_START_MIN; min + durationMinutes <= DAY_END_MIN; min += durationMinutes) {
      const start = zonedInstant(day, min, timeZone);
      const end = new Date(start.getTime() + durationMinutes * 60_000);

      let state: SlotState = 'free';
      let busyWith: string | undefined;

      if (end.getTime() <= now) {
        state = 'past';
      } else {
        // Overlap: starts before the other ends AND ends after it starts.
        const clash = booked.find((b) => start.getTime() < b.to && end.getTime() > b.from);
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
  async create(data: MeetingInput, viewer: Viewer): Promise<IMeeting> {
    const lead = await findVisibleLead(data.leadId ?? '', viewer);

    const scheduledAt = new Date(data.scheduledAt ?? '');
    assertNotPast(scheduledAt);
    const durationMinutes = data.durationMinutes ?? 30;

    // Attendees default to whoever booked it, so the meeting and its task are never orphaned.
    const attendees =
      data.assignedTo && data.assignedTo.length > 0
        ? await assertActiveMembers(data.assignedTo)
        : [viewer.userId];
    const purpose = await assertPurpose(data.purpose);
    await assertNoConflict(attendees, scheduledAt, durationMinutes);

    const meetingNumber = await nextDisplayNumber('meeting');
    const meeting = await Meeting.create({
      leadId: lead._id,
      scheduledAt,
      durationMinutes,
      assignedTo: attendees,
      meetingType: data.meetingType as MeetingType,
      purpose,
      notes: data.notes || undefined,
      reminderMinutesBefore: data.reminderMinutesBefore ?? [],
      comments: (data.comments ?? []).map((comment) => ({
        userId: viewer.userId,
        userName: viewer.name,
        text: comment.text,
        createdAt: new Date(),
      })),
      meetingNumber,
      createdBy: viewer.userId,
    });

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
      endDate: new Date(scheduledAt.getTime() + durationMinutes * 60_000),
      status: 'pending',
      assignedTo: attendees,
      leadId: lead._id,
      meetingId: meeting._id,
      origin: 'meeting',
      createdBy: viewer.userId,
    });

    meeting.linkedTaskId = task._id;
    await meeting.save();

    // One notification for the pair: the companion task is bookkeeping for
    // the meeting, and a second alert for it would be noise.
    await notificationService.notify({
      type: 'meeting_assigned',
      recipients: attendees,
      actor: viewer,
      entityId: meeting._id,
      subject: lead.contactName,
      at: scheduledAt,
    });

    await leadThreadService.recordActivity(
      lead._id,
      'meeting_booked',
      `${viewer.name} booked meeting ${meetingNumber} for ${formatWhen(scheduledAt, zoneOf(viewer))}`,
      viewer,
      { meetingId: meeting._id.toString() }
    );
    await advanceLeadToMeeting(lead, viewer);

    return meeting.populate(POPULATE as unknown as string[]);
  },

  async list(filters: MeetingFilters, viewer: Viewer) {
    const now = new Date();
    const query = withClauses(await baseQuery(filters, viewer), [
      filters.scope ? tabClause(filters.scope, viewer, now) : {},
      filters.status ? { status: filters.status } : {},
    ]);

    // Tabs about what already happened read newest first; the rest in the order
    // they will happen.
    const newestFirst = ['completed', 'cancelled', 'missed', 'past'].includes(filters.scope ?? '');
    const { page, limit, skip } = pageParams(filters);

    const [data, total] = await Promise.all([
      Meeting.find(query)
        .populate(POPULATE as unknown as string[])
        .sort({ scheduledAt: newestFirst ? -1 : 1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Meeting.countDocuments(query),
    ]);

    return { data, total, page, limit };
  },

  /** How many meetings each tab holds under the same filters, so the numbers match the rows. */
  async tabCounts(
    filters: Omit<MeetingFilters, 'scope' | 'status' | 'page' | 'limit'>,
    viewer: Viewer
  ): Promise<Record<MeetingTab, number>> {
    const base = await baseQuery(filters, viewer);
    const now = new Date();
    const counts = await Promise.all(
      MEETING_TABS.map((tab) => Meeting.countDocuments(withClauses(base, [tabClause(tab, viewer, now)])))
    );
    return Object.fromEntries(MEETING_TABS.map((tab, i) => [tab, counts[i] ?? 0])) as Record<
      MeetingTab,
      number
    >;
  },

  async getById(meetingId: string, viewer: Viewer): Promise<IMeeting> {
    const meeting = await findActive(meetingId);
    await assertCanWork(meeting, viewer);
    return meeting.populate(POPULATE as unknown as string[]);
  },

  /**
   * Edit or reschedule. Moving the time marks the meeting rescheduled, re-checks
   * that nobody is double-booked, moves its task, and tells the people already
   * on it; anyone newly added is told they were added.
   */
  async update(meetingId: string, data: MeetingInput, viewer: Viewer): Promise<IMeeting> {
    const meeting = await findActive(meetingId);
    await assertCanWork(meeting, viewer);
    if (!OPEN_STATUSES.includes(meeting.status)) {
      throw new AppError(
        'This meeting is closed. Reopen it before changing it.',
        409,
        'MEETING_CLOSED'
      );
    }

    const previousAttendees = new Set(meeting.assignedTo.map((id) => id.toString()));
    const previousStart = meeting.scheduledAt.getTime();
    const previousDuration = meeting.durationMinutes;

    if (data.assignedTo !== undefined) {
      meeting.assignedTo =
        data.assignedTo.length > 0 ? await assertActiveMembers(data.assignedTo) : [viewer.userId];
    }
    if (data.scheduledAt !== undefined) {
      const next = new Date(data.scheduledAt);
      if (next.getTime() !== previousStart) assertNotPast(next);
      meeting.scheduledAt = next;
    }
    if (data.durationMinutes !== undefined) meeting.durationMinutes = data.durationMinutes;
    if (data.meetingType !== undefined) meeting.meetingType = data.meetingType as MeetingType;
    if (data.purpose !== undefined) meeting.purpose = await assertPurpose(data.purpose);
    if (data.notes !== undefined) meeting.notes = data.notes || undefined;
    if (data.reminderMinutesBefore !== undefined) {
      meeting.reminderMinutesBefore = data.reminderMinutesBefore;
    }

    const moved =
      meeting.scheduledAt.getTime() !== previousStart ||
      meeting.durationMinutes !== previousDuration;
    const currentIds = meeting.assignedTo.map((id) => id.toString());
    const attendeesChanged =
      currentIds.length !== previousAttendees.size ||
      currentIds.some((id) => !previousAttendees.has(id));

    if (moved || attendeesChanged) {
      await assertNoConflict(
        meeting.assignedTo,
        meeting.scheduledAt,
        meeting.durationMinutes,
        meeting._id
      );
    }
    if (moved) meeting.status = 'rescheduled';
    await meeting.save();

    // The companion task follows its meeting: same people, same deadline.
    if (meeting.linkedTaskId && (moved || attendeesChanged)) {
      await Task.updateOne(
        { _id: meeting.linkedTaskId, origin: 'meeting' },
        {
          $set: {
            ...(moved
              ? {
                  endDate: new Date(
                    meeting.scheduledAt.getTime() + meeting.durationMinutes * 60_000
                  ),
                }
              : {}),
            ...(attendeesChanged ? { assignedTo: meeting.assignedTo } : {}),
          },
        }
      );
    }

    const lead = await Lead.findById(meeting.leadId).select('contactName').lean();
    const subject = lead?.contactName ?? meeting.meetingNumber;

    const added = meeting.assignedTo.filter((id) => !previousAttendees.has(id.toString()));
    if (added.length > 0) {
      await notificationService.notify({
        type: 'meeting_assigned',
        recipients: added,
        actor: viewer,
        entityId: meeting._id,
        subject,
        at: meeting.scheduledAt,
      });
    }

    if (moved) {
      await notificationService.notify({
        type: 'meeting_rescheduled',
        recipients: meeting.assignedTo.filter((id) => previousAttendees.has(id.toString())),
        actor: viewer,
        entityId: meeting._id,
        subject,
        at: meeting.scheduledAt,
      });
      await leadThreadService.recordActivity(
        meeting.leadId,
        'meeting_rescheduled',
        `${viewer.name} moved meeting ${meeting.meetingNumber} to ${formatWhen(meeting.scheduledAt, zoneOf(viewer))}`,
        viewer,
        { meetingId: meeting._id.toString() }
      );
    }

    return meeting.populate(POPULATE as unknown as string[]);
  },

  /**
   * Complete, cancel, or reopen. The companion task follows — completing a
   * meeting completes it, cancelling archives it, reopening brings it back —
   * so no past meeting leaves a permanently open task behind.
   */
  async setStatus(
    meetingId: string,
    status: MeetingStatus,
    outcome: string | undefined,
    viewer: Viewer
  ): Promise<IMeeting> {
    const meeting = await findActive(meetingId);
    await assertCanWork(meeting, viewer);

    const previous = meeting.status;
    const wasOpen = OPEN_STATUSES.includes(previous);
    const reopening = !wasOpen && OPEN_STATUSES.includes(status);

    if (reopening && meeting.scheduledAt.getTime() > Date.now()) {
      await assertNoConflict(meeting.assignedTo, meeting.scheduledAt, meeting.durationMinutes, meeting._id);
    }

    meeting.status = status;
    if (outcome) meeting.outcome = outcome;
    await meeting.save();

    if (previous === status) return meeting.populate(POPULATE as unknown as string[]);

    if (meeting.linkedTaskId) {
      const task = await Task.findById(meeting.linkedTaskId);
      // Only the auto-created task is touched — a task a person made is theirs.
      if (task && task.origin === 'meeting') {
        if (status === 'completed' && task.status !== 'completed') {
          task.status = 'completed';
          task.isActive = true;
          await task.save();
        } else if (status === 'cancelled' && task.status !== 'completed') {
          task.isActive = false;
          await task.save();
        } else if (reopening) {
          task.isActive = true;
          if (previous === 'completed' && task.status === 'completed') task.status = 'pending';
          await task.save();
        }
      }
    }

    const lead = await Lead.findById(meeting.leadId).select('contactName').lean();
    const subject = lead?.contactName ?? meeting.meetingNumber;
    const leadId = meeting.leadId;

    if (status === 'completed') {
      // A meeting held is contact made.
      await Lead.updateOne({ _id: leadId }, { $set: { lastContactedAt: new Date() } });
      await leadThreadService.recordActivity(
        leadId,
        'meeting_completed',
        `${viewer.name} completed meeting ${meeting.meetingNumber}` +
          (meeting.outcome ? ` — ${meeting.outcome}` : ''),
        viewer,
        { meetingId: meeting._id.toString() }
      );
    } else if (status === 'cancelled') {
      await notificationService.notify({
        type: 'meeting_cancelled',
        recipients: meeting.assignedTo,
        actor: viewer,
        entityId: meeting._id,
        subject,
        at: meeting.scheduledAt,
      });
      await leadThreadService.recordActivity(
        leadId,
        'meeting_cancelled',
        `${viewer.name} cancelled meeting ${meeting.meetingNumber}` +
          (outcome ? ` — ${outcome}` : ''),
        viewer,
        { meetingId: meeting._id.toString() }
      );
    } else if (reopening) {
      await leadThreadService.recordActivity(
        leadId,
        'meeting_reopened',
        `${viewer.name} reopened meeting ${meeting.meetingNumber}`,
        viewer,
        { meetingId: meeting._id.toString() }
      );
    }

    return meeting.populate(POPULATE as unknown as string[]);
  },

  /** Posts one entry to the meeting's "Meeting Purpose" comment thread. */
  async addComment(meetingId: string, text: string, viewer: Viewer): Promise<IMeeting> {
    const meeting = await findActive(meetingId);
    await assertCanWork(meeting, viewer);

    meeting.comments.push({
      userId: viewer.userId,
      userName: viewer.name,
      text,
      createdAt: new Date(),
    });
    await meeting.save();
    return meeting.populate(POPULATE as unknown as string[]);
  },

  /** Deleting is the booker's or an organizer's call; cancelling is the everyday path. */
  async remove(meetingId: string, viewer: Viewer): Promise<void> {
    const meeting = await findActive(meetingId);
    if (!canManage(meeting, viewer)) {
      throw AppError.forbidden('Only the person who booked this meeting, or an organizer, can delete it');
    }
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

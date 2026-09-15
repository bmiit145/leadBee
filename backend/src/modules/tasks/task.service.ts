import { Types, type FilterQuery } from 'mongoose';
import { Task, type ITask, type TaskStatus } from '../../models/Task.js';
import { Meeting } from '../../models/Meeting.js';
import { Lead } from '../../models/Lead.js';
import { AppError } from '../../lib/errors.js';
import { nextDisplayNumber } from '../../lib/counters.js';
import { pageParams } from '../../lib/pagination.js';
import { addDays, calendarDayOf, dayBounds, dayRange } from '../../lib/zonedTime.js';
import { zoneOf } from '../../lib/viewer.js';
import { notificationService } from '../notifications/notification.service.js';
import { findVisibleLead, leadIsVisible, type Viewer } from '../leads/lead.service.js';
import { leadThreadService } from '../leads/leadThread.service.js';
import { assertActiveMembers } from '../work/members.js';
import { canManage, canWorkOn } from '../work/workAccess.js';

export interface TaskFilters {
  status?: string;
  leadId?: string;
  assignedTo?: string;
  /** 'mine' = assigned to the viewer; 'assigned' = raised by the viewer for others. */
  bucket?: 'mine' | 'assigned';
  overdue?: boolean;
  /** Powers the Reminder screen's Today / Tomorrow tabs, against endDate. */
  scope?: 'today' | 'tomorrow';
  /** Inclusive endDate window — powers the calendar month view. */
  dateFrom?: string;
  dateTo?: string;
  /** Subject or task number, or the name, mobile or number of the task's lead. */
  search?: string;
  /** A label's name, exactly. */
  label?: string;
  page?: number;
  limit?: number;
}

export interface TaskLabelSummary {
  name: string;
  color: string;
  count: number;
}

export interface TaskInput {
  subject?: string;
  description?: string;
  startDate?: string;
  endDate?: string;
  status?: string;
  assignedTo?: string[];
  checklist?: Array<{ _id?: string; text: string; done?: boolean }>;
  labels?: Array<{ name: string; color: string }>;
  images?: string[];
  leadId?: string | null;
  /** Comments typed on the create form before the task existed. */
  comments?: Array<{ text: string }>;
}

/**
 * `meetingId` is populated deeply enough to render a full meeting card
 * client-side — the Reminder screen shows a meeting-linked task using the same
 * timeline card as the meeting itself, not a separate design.
 */
const POPULATE = [
  { path: 'assignedTo', select: 'name phone role avatarUrl' },
  { path: 'createdBy', select: 'name role avatarUrl' },
  {
    path: 'leadId',
    select: 'leadNumber contactName contactPhone stage nextFollowUpAt',
  },
  {
    path: 'meetingId',
    select: 'meetingNumber scheduledAt durationMinutes meetingType status leadId',
    populate: { path: 'leadId', select: 'leadNumber contactName contactPhone stage' },
  },
] as const;

function assertDateOrder(start: Date, end: Date): void {
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw AppError.badRequest('Invalid task dates');
  }
  if (end.getTime() < start.getTime()) {
    throw new AppError('The end date cannot be before the start date.', 400, 'INVALID_DATE_RANGE');
  }
}

/** Open it, comment, move its status: a participant, an organizer, or whoever owns its lead. */
async function assertCanWork(task: ITask, viewer: Viewer): Promise<void> {
  if (canWorkOn(task, viewer)) return;
  if (task.leadId && (await leadIsVisible(idOf(task.leadId), viewer))) return;
  throw AppError.forbidden('Access denied');
}

function idOf(value: unknown): string {
  return typeof value === 'object' && value !== null && '_id' in value
    ? String((value as { _id: unknown })._id)
    : String(value);
}

/**
 * The list's filter, shared with the tab counts so the two cannot disagree.
 * `withStatus: false` leaves the status out, which is what a per-status count needs.
 */
async function buildQuery(
  filters: TaskFilters,
  viewer: Viewer,
  withStatus = true
): Promise<FilterQuery<ITask>> {
  const query: FilterQuery<ITask> = { isActive: true };
  const timeZone = zoneOf(viewer);

  if (filters.leadId) {
    // Everyone who can see a lead sees all of its work, whoever it was given to.
    if (!(await leadIsVisible(filters.leadId, viewer))) throw AppError.forbidden('Access denied');
    query.leadId = new Types.ObjectId(filters.leadId);
  } else if (filters.bucket === 'mine') {
    query.assignedTo = viewer.userId;
  } else if (filters.bucket === 'assigned') {
    // Raised by me, for somebody else.
    query.createdBy = viewer.userId;
    query.assignedTo = { $ne: viewer.userId };
  } else if (!viewer.isOrganizer) {
    // Agents see anything they own or raised, nothing else.
    query.$or = [{ assignedTo: viewer.userId }, { createdBy: viewer.userId }];
  } else if (filters.assignedTo) {
    query.assignedTo = new Types.ObjectId(filters.assignedTo);
  }

  if (withStatus && filters.status) query.status = filters.status;

  if (filters.overdue) {
    query.endDate = { $lt: new Date() };
    query.status = { $ne: 'completed' };
  }

  if (filters.scope) {
    const today = calendarDayOf(new Date(), timeZone);
    const { start, end } = dayBounds(
      filters.scope === 'tomorrow' ? addDays(today, 1) : today,
      timeZone
    );
    query.endDate = { $gte: start, $lte: end };
    query.status = { $ne: 'completed' };
  }

  let range: ReturnType<typeof dayRange>;
  try {
    range = dayRange(filters.dateFrom, filters.dateTo, timeZone);
  } catch (error) {
    throw AppError.badRequest(error instanceof Error ? error.message : 'Invalid date filter');
  }
  if (range) query.endDate = range;

  if (filters.label) (query as Record<string, unknown>)['labels.name'] = filters.label;

  const term = filters.search?.trim();
  if (term) {
    const regex = new RegExp(escapeRegex(term), 'i');
    // "Search by customer name or number" means the task's lead too. Visibility
    // stays the task's own rule — a matching lead grants nothing.
    const leadIds = await Lead.distinct('_id', {
      $or: [{ contactName: regex }, { contactPhone: regex }, { leadNumber: regex }],
    });
    // Merged under $and so it cannot clobber the visibility $or above.
    query.$and = [
      ...((query.$and as object[]) ?? []),
      { $or: [{ subject: regex }, { taskNumber: regex }, { leadId: { $in: leadIds } }] },
    ];
  }

  return query;
}

export const taskService = {
  async create(data: TaskInput, viewer: Viewer): Promise<ITask> {
    const startDate = new Date(data.startDate ?? '');
    const endDate = new Date(data.endDate ?? '');
    assertDateOrder(startDate, endDate);

    // A task nobody owns is invisible in every "my tasks" view, so fall back to
    // the creator rather than allowing an unassigned task.
    const assignedTo =
      data.assignedTo && data.assignedTo.length > 0
        ? await assertActiveMembers(data.assignedTo)
        : [viewer.userId];

    // Linking a task to a lead is working that lead, so it needs the lead.
    const lead = data.leadId ? await findVisibleLead(data.leadId, viewer) : null;

    const taskNumber = await nextDisplayNumber('task');
    const task = await Task.create({
      subject: data.subject,
      description: data.description || undefined,
      startDate,
      endDate,
      status: data.status ?? 'pending',
      assignedTo,
      checklist: (data.checklist ?? []).map((item) => ({ text: item.text, done: item.done ?? false })),
      labels: data.labels ?? [],
      images: data.images ?? [],
      leadId: lead?._id,
      // The authorship of comments is the caller's, whatever the client sent.
      comments: (data.comments ?? []).map((comment) => ({
        userId: viewer.userId,
        userName: viewer.name,
        text: comment.text,
        createdAt: new Date(),
      })),
      taskNumber,
      createdBy: viewer.userId,
      origin: 'manual',
    });

    await notificationService.notify({
      type: 'task_assigned',
      recipients: assignedTo,
      actor: viewer,
      entityId: task._id,
      subject: task.subject,
      at: task.endDate,
    });

    if (lead) {
      await leadThreadService.recordActivity(
        lead._id,
        'task_created',
        `${viewer.name} created task ${task.taskNumber}: ${task.subject}`,
        viewer,
        { taskId: task._id.toString() }
      );
    }

    return task.populate(POPULATE as unknown as string[]);
  },

  async list(filters: TaskFilters, viewer: Viewer) {
    const query = await buildQuery(filters, viewer);
    const { page, limit, skip } = pageParams(filters);

    const [data, total] = await Promise.all([
      Task.find(query)
        .populate(POPULATE as unknown as string[])
        .sort({ endDate: 1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Task.countDocuments(query),
    ]);

    return { data, total, page, limit };
  },

  async getById(taskId: string, viewer: Viewer): Promise<ITask> {
    const task = await findActive(taskId);
    await assertCanWork(task, viewer);
    return task.populate(POPULATE as unknown as string[]);
  },

  /** Changing what the task is: its creator or an organizer. Assignees move its status. */
  async update(taskId: string, data: TaskInput, viewer: Viewer): Promise<ITask> {
    const task = await findActive(taskId);
    if (!canManage(task, viewer)) {
      throw AppError.forbidden('Only the person who created this task, or an organizer, can edit it');
    }

    if (data.subject !== undefined) task.subject = data.subject;
    if (data.description !== undefined) task.description = data.description || undefined;

    const startDate = data.startDate !== undefined ? new Date(data.startDate) : task.startDate;
    const endDate = data.endDate !== undefined ? new Date(data.endDate) : task.endDate;
    assertDateOrder(startDate, endDate);
    task.startDate = startDate;
    task.endDate = endDate;

    if (data.status !== undefined) task.status = data.status as TaskStatus;

    const previousAssignees = new Set(task.assignedTo.map((id) => id.toString()));
    if (data.assignedTo !== undefined) {
      task.assignedTo =
        data.assignedTo.length > 0 ? await assertActiveMembers(data.assignedTo) : [viewer.userId];
    }

    if (data.checklist !== undefined) {
      // Items keep their ids, so a tick made on another phone is not lost to a rename.
      task.set(
        'checklist',
        data.checklist.map((item) => ({
          ...(item._id && Types.ObjectId.isValid(item._id) ? { _id: new Types.ObjectId(item._id) } : {}),
          text: item.text,
          done: item.done ?? false,
        }))
      );
    }
    if (data.labels !== undefined) task.set('labels', data.labels);
    if (data.images !== undefined) task.images = data.images;

    if (data.leadId !== undefined) {
      task.leadId = data.leadId ? (await findVisibleLead(data.leadId, viewer))._id : undefined;
    }

    await task.save();

    // Only people newly added hear about it; re-saving a task must not re-alert
    // everyone already on it.
    if (data.assignedTo !== undefined) {
      await notificationService.notify({
        type: 'task_assigned',
        recipients: task.assignedTo.filter((id) => !previousAssignees.has(id.toString())),
        actor: viewer,
        entityId: task._id,
        subject: task.subject,
        at: task.endDate,
      });
    }

    return task.populate(POPULATE as unknown as string[]);
  },

  async setStatus(taskId: string, status: TaskStatus, viewer: Viewer): Promise<ITask> {
    const task = await findActive(taskId);
    await assertCanWork(task, viewer);

    const previous = task.status;
    task.status = status;
    await task.save();

    if (task.leadId && status === 'completed' && previous !== 'completed') {
      await leadThreadService.recordActivity(
        task.leadId,
        'task_completed',
        `${viewer.name} completed task ${task.taskNumber}: ${task.subject}`,
        viewer,
        { taskId: task._id.toString() }
      );
    }

    return task.populate(POPULATE as unknown as string[]);
  },

  async addComment(taskId: string, text: string, viewer: Viewer): Promise<ITask> {
    const task = await findActive(taskId);
    await assertCanWork(task, viewer);

    task.comments.push({
      userId: viewer.userId,
      userName: viewer.name,
      text,
      createdAt: new Date(),
    });
    await task.save();
    return task.populate(POPULATE as unknown as string[]);
  },

  /** Toggling an item is the common case, so it gets its own endpoint. */
  async toggleChecklistItem(taskId: string, itemId: string, viewer: Viewer): Promise<ITask> {
    const task = await findActive(taskId);
    await assertCanWork(task, viewer);

    const item = task.checklist.find((c) => String(c._id) === itemId);
    if (!item) throw AppError.notFound('Checklist item not found');

    item.done = !item.done;
    await task.save();
    return task.populate(POPULATE as unknown as string[]);
  },

  async remove(taskId: string, viewer: Viewer): Promise<void> {
    const task = await findActive(taskId);
    if (!canManage(task, viewer)) {
      throw AppError.forbidden('Only the person who created this task, or an organizer, can delete it');
    }
    task.isActive = false;
    await task.save();

    // A meeting must not keep pointing at a task that is gone.
    if (task.meetingId) {
      await Meeting.updateOne(
        { _id: task.meetingId, linkedTaskId: task._id },
        { $unset: { linkedTaskId: 1 } }
      );
    }
  },

  /**
   * The labels in use on tasks the viewer can see, with how many carry each —
   * what the filter offers. Labels are free text on each task, so this is read
   * from the tasks rather than kept as a separate list.
   */
  async labels(viewer: Viewer): Promise<TaskLabelSummary[]> {
    const match = await buildQuery({}, viewer, false);
    return Task.aggregate<TaskLabelSummary>([
      { $match: match },
      { $unwind: '$labels' },
      { $group: { _id: '$labels.name', color: { $first: '$labels.color' }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
      { $limit: 100 },
      { $project: { _id: 0, name: '$_id', color: 1, count: 1 } },
    ]);
  },

  /** Counts per status for the filter tabs — the same filter as `list`, minus the status. */
  async statusCounts(viewer: Viewer, filters: TaskFilters = {}): Promise<Record<string, number>> {
    const match = await buildQuery(filters, viewer, false);

    const rows = await Task.aggregate<{ _id: string; count: number }>([
      { $match: match },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);

    const counts: Record<string, number> = {};
    let total = 0;
    for (const { _id, count } of rows) {
      if (!_id) continue;
      counts[_id] = count;
      total += count;
    }
    return { ...counts, total };
  },
};

async function findActive(taskId: string): Promise<ITask> {
  if (!Types.ObjectId.isValid(taskId)) throw AppError.notFound('Task not found');
  const task = await Task.findOne({ _id: taskId, isActive: true });
  if (!task) throw AppError.notFound('Task not found');
  return task;
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

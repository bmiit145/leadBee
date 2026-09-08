import { Types, type FilterQuery } from 'mongoose';
import { Task, type ITask, type TaskStatus } from '../../models/Task.js';
import { AppError } from '../../lib/errors.js';
import { nextDisplayNumber } from '../../lib/counters.js';
import { pageParams } from '../../lib/pagination.js';
import type { Viewer } from '../leads/lead.service.js';

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
  search?: string;
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
    select: 'leadNumber contactName contactPhone stage nextFollowUpAt isBookmarked',
  },
  {
    path: 'meetingId',
    select: 'meetingNumber scheduledAt durationMinutes meetingType status leadId',
    populate: { path: 'leadId', select: 'leadNumber contactName contactPhone stage' },
  },
] as const;

export const taskService = {
  async create(data: Record<string, unknown>, viewer: Viewer): Promise<ITask> {
    const taskNumber = await nextDisplayNumber('task');

    // A task nobody owns is invisible in every "my tasks" view, so fall back to
    // the creator rather than allowing an unassigned task.
    const requested = data.assignedTo as string[] | undefined;
    const assignedTo =
      requested && requested.length > 0
        ? requested.map((id) => new Types.ObjectId(id))
        : [viewer.userId];

    const task = await Task.create({
      ...sanitize(data),
      taskNumber,
      assignedTo,
      createdBy: viewer.userId,
      origin: 'manual',
    });
    return task.populate(POPULATE as unknown as string[]);
  },

  async list(filters: TaskFilters, viewer: Viewer) {
    const query: FilterQuery<ITask> = { isActive: true };

    if (filters.bucket === 'mine') {
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

    if (filters.status) query.status = filters.status;
    if (filters.leadId) query.leadId = new Types.ObjectId(filters.leadId);

    if (filters.overdue) {
      query.endDate = { $lt: new Date() };
      query.status = { $ne: 'completed' };
    }

    if (filters.scope) {
      const base = new Date();
      if (filters.scope === 'tomorrow') base.setDate(base.getDate() + 1);
      const { start, end } = dayBounds(base);
      query.endDate = { $gte: start, $lte: end };
      query.status = { $ne: 'completed' };
    }

    if (filters.dateFrom || filters.dateTo) {
      const bounds: Record<string, Date> = {};
      if (filters.dateFrom) bounds.$gte = new Date(filters.dateFrom);
      if (filters.dateTo) {
        const end = new Date(filters.dateTo);
        end.setHours(23, 59, 59, 999);
        bounds.$lte = end;
      }
      query.endDate = bounds;
    }

    if (filters.search) {
      const regex = new RegExp(escapeRegex(filters.search), 'i');
      // Merged under $and so it cannot clobber the visibility $or above.
      query.$and = [
        ...((query.$and as object[]) ?? []),
        { $or: [{ subject: regex }, { taskNumber: regex }] },
      ];
    }

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

  async getById(taskId: string): Promise<ITask> {
    const task = await Task.findOne({ _id: taskId, isActive: true }).populate(
      POPULATE as unknown as string[]
    );
    if (!task) throw AppError.notFound('Task not found');
    return task;
  },

  async update(taskId: string, data: Record<string, unknown>): Promise<ITask> {
    const task = await Task.findOne({ _id: taskId, isActive: true });
    if (!task) throw AppError.notFound('Task not found');

    Object.assign(task, sanitize(data));
    await task.save();
    return task.populate(POPULATE as unknown as string[]);
  },

  async setStatus(taskId: string, status: TaskStatus): Promise<ITask> {
    const task = await Task.findOne({ _id: taskId, isActive: true });
    if (!task) throw AppError.notFound('Task not found');
    task.status = status;
    await task.save();
    return task.populate(POPULATE as unknown as string[]);
  },

  async addComment(taskId: string, text: string, viewer: Viewer): Promise<ITask> {
    const task = await Task.findOne({ _id: taskId, isActive: true });
    if (!task) throw AppError.notFound('Task not found');

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
  async toggleChecklistItem(taskId: string, itemId: string): Promise<ITask> {
    const task = await Task.findOne({ _id: taskId, isActive: true });
    if (!task) throw AppError.notFound('Task not found');

    const item = task.checklist.find((c) => String(c._id) === itemId);
    if (!item) throw AppError.notFound('Checklist item not found');

    item.done = !item.done;
    await task.save();
    return task.populate(POPULATE as unknown as string[]);
  },

  async remove(taskId: string): Promise<void> {
    const task = await Task.findById(taskId);
    if (!task) throw AppError.notFound('Task not found');
    task.isActive = false;
    await task.save();
  },

  /** Counts per status for the filter tabs, scoped the same way as `list`. */
  async statusCounts(viewer: Viewer): Promise<Record<string, number>> {
    const match: FilterQuery<ITask> = { isActive: true };
    if (!viewer.isOrganizer) {
      match.$or = [{ assignedTo: viewer.userId }, { createdBy: viewer.userId }];
    }

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

/** Server-owned fields a client must never set directly. */
function sanitize(data: Record<string, unknown>): Record<string, unknown> {
  const {
    taskNumber: _taskNumber,
    createdBy: _createdBy,
    comments: _comments,
    origin: _origin,
    meetingId: _meetingId,
    organizationId: _organizationId,
    isActive: _isActive,
    completedAt: _completedAt,
    ...safe
  } = data;

  for (const field of ['startDate', 'endDate'] as const) {
    if (typeof safe[field] === 'string') safe[field] = new Date(safe[field] as string);
  }
  if (Array.isArray(safe.assignedTo)) {
    safe.assignedTo = (safe.assignedTo as string[]).map((id) => new Types.ObjectId(id));
  }
  if (typeof safe.leadId === 'string') safe.leadId = new Types.ObjectId(safe.leadId);

  return safe;
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

import { Types } from 'mongoose';
import {
  Notification,
  NOTIFICATION_TYPES,
  type INotification,
  type NotificationType,
} from '../../models/Notification.js';
import { User } from '../../models/User.js';
import { AppError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { pageParams } from '../../lib/pagination.js';
import { sendExpoPush, type ExpoPushMessage } from '../../lib/expoPush.js';
import type { Viewer } from '../leads/lead.service.js';

export interface NotifyInput {
  type: NotificationType;
  /** Anyone who should hear about it. The actor is dropped — nobody is told
   *  about their own action — and duplicates collapse. */
  recipients: Array<Types.ObjectId | string | null | undefined>;
  actor: Viewer;
  entityId: Types.ObjectId;
  subject: string;
  at?: Date;
}

/**
 * Push text is fixed at send time, because the OS renders it. It is English:
 * the app's language choice lives on the device, not the account, so the server
 * has no reliable way to know it. The in-app inbox is translated from `type`.
 */
const PUSH_COPY: Record<NotificationType, (actorName: string, subject: string) => { title: string; body: string }> = {
  lead_assigned: (actorName, subject) => ({
    title: 'New lead assigned',
    body: `${actorName} assigned ${subject} to you`,
  }),
  task_assigned: (actorName, subject) => ({
    title: 'New task',
    body: `${actorName} assigned you: ${subject}`,
  }),
  meeting_assigned: (actorName, subject) => ({
    title: 'Meeting scheduled',
    body: `${actorName} added you to a meeting with ${subject}`,
  }),
};

export const notificationService = {
  /**
   * Records an inbox entry per recipient and pushes to those with a device.
   *
   * Never throws. A notification annotates the action that caused it; failing
   * to record one must not fail the assignment itself (ARCH-15). The insert is
   * awaited so the badge is right the moment the request returns; the push is
   * not, because a slow third party must not hold the response open.
   */
  async notify(input: NotifyInput): Promise<void> {
    try {
      const actorId = input.actor.userId.toString();
      const ids = [
        ...new Set(input.recipients.filter((id) => id != null).map((id) => String(id))),
      ].filter((id) => id !== actorId);
      if (ids.length === 0) return;

      // Scoped by the tenant plugin, so an id from another tenant finds nobody.
      const recipients = await User.find({ _id: { $in: ids }, isActive: true })
        .select('_id +pushToken')
        .lean();
      if (recipients.length === 0) return;

      const entityType = NOTIFICATION_TYPES[input.type];
      const created = await Notification.insertMany(
        recipients.map((user) => ({
          recipient: user._id,
          type: input.type,
          entityType,
          entityId: input.entityId,
          actor: input.actor.userId,
          actorName: input.actor.name,
          subject: input.subject,
          at: input.at,
        }))
      );

      const copy = PUSH_COPY[input.type](input.actor.name, input.subject);
      const messages: ExpoPushMessage[] = [];
      for (const user of recipients) {
        if (!user.pushToken) continue;
        const entry = created.find((doc) => doc.recipient.equals(user._id));
        messages.push({
          to: user.pushToken,
          ...copy,
          data: {
            entityType,
            entityId: input.entityId.toString(),
            // Lets a tapped push mark its inbox row read.
            ...(entry ? { notificationId: entry._id.toString() } : {}),
          },
        });
      }
      if (messages.length > 0) void deliver(messages);
    } catch (error) {
      logger.warn({ err: error, type: input.type }, 'notification not recorded');
    }
  },

  async list(
    viewer: Viewer,
    options: { page?: number; limit?: number; unreadOnly?: boolean } = {}
  ) {
    const filter: Record<string, unknown> = { recipient: viewer.userId };
    // `null` matches a missing field too, which is how an unread row looks.
    if (options.unreadOnly) filter.readAt = null;

    const { page, limit, skip } = pageParams(options);
    const [rows, total] = await Promise.all([
      Notification.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      Notification.countDocuments(filter),
    ]);

    return { data: rows.map((row) => row.toJSON()), total, page, limit };
  },

  async unreadCount(viewer: Viewer): Promise<number> {
    return Notification.countDocuments({ recipient: viewer.userId, readAt: null });
  },

  /**
   * Pinned to the caller as recipient, so another user's id — in this tenant
   * or any other — is simply not found. Marking an already-read row is a no-op.
   */
  async markRead(notificationId: string, viewer: Viewer): Promise<INotification> {
    const row = await Notification.findOne({ _id: notificationId, recipient: viewer.userId });
    if (!row) throw AppError.notFound('Notification not found');
    if (!row.readAt) {
      row.readAt = new Date();
      await row.save();
    }
    return row;
  },

  async markAllRead(viewer: Viewer): Promise<number> {
    const result = await Notification.updateMany(
      { recipient: viewer.userId, readAt: null },
      { $set: { readAt: new Date() } }
    );
    return result.modifiedCount;
  },
};

/** Sends, then forgets tokens Expo says no longer reach a device. */
async function deliver(messages: ExpoPushMessage[]): Promise<void> {
  try {
    const stale = await sendExpoPush(messages);
    if (stale.length > 0) {
      await User.updateMany({ pushToken: { $in: stale } }, { $unset: { pushToken: 1 } });
    }
  } catch (error) {
    logger.warn({ err: error }, 'push delivery follow-up failed');
  }
}

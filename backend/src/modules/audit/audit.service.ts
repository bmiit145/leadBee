import type { Types } from 'mongoose';
import { AuditLog } from '../../models/AuditLog.js';
import { logger } from '../../lib/logger.js';
import type { AuditAction } from '../../config/constants.js';
import type { Viewer } from '../leads/lead.service.js';

export interface AuditEntry {
  action: AuditAction;
  entityType: string;
  entityId: Types.ObjectId;
  actor: Viewer;
  /** Only the changed fields. Never a password, token or other credential. */
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  /** Where the request came from. Passed in, because services do not see HTTP. */
  origin?: { ip?: string; userAgent?: string };
}

/** A user agent is attacker-controlled free text; keep what identifies a client. */
const MAX_USER_AGENT = 300;

export const auditService = {
  /**
   * Appends one entry to the tenant's audit trail.
   *
   * Awaited, so the entry exists by the time the response reports the change,
   * but never thrown: the change is already saved, and failing the request now
   * would tell the caller it did not happen when it did. A lost entry is logged
   * at `error`, because a gap in an audit trail is something a person must
   * explain.
   */
  async record(entry: AuditEntry): Promise<void> {
    try {
      await AuditLog.create({
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        actorId: entry.actor.userId,
        actorName: entry.actor.name,
        actorRole: entry.actor.role,
        before: entry.before,
        after: entry.after,
        ip: entry.origin?.ip,
        userAgent: entry.origin?.userAgent?.slice(0, MAX_USER_AGENT),
      });
    } catch (error) {
      logger.error(
        { err: error, action: entry.action, entityId: entry.entityId.toString() },
        'audit entry not written'
      );
    }
  },
};

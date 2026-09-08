/**
 * Model barrel.
 *
 * Importing this registers every schema with Mongoose, which `populate()` needs
 * — a ref to a model that has not been imported yet throws at query time, and
 * that failure looks like a data bug rather than an import-order one.
 */

// Platform realm — not tenant-scoped.
export { Organization, type IOrganization } from './Organization.js';
export { PlatformAdmin, PLATFORM_ROLE_PERMISSIONS, type IPlatformAdmin, type PlatformRole } from './PlatformAdmin.js';
export { PlatformAuditLog, type IPlatformAuditLog } from './PlatformAuditLog.js';
export { Counter, type ICounter } from './Counter.js';

// Tenant realm — every one carries organizationId via tenantPlugin.
export { User, type IUser } from './User.js';
export { Role, type IRole } from './Role.js';
export { Lead, type ILead } from './Lead.js';
export { CallLog, type ICallLog } from './CallLog.js';
export { LeadThreadItem, LEAD_THREAD_CHANNELS, type ILeadThreadItem, type LeadThreadChannel } from './LeadThreadItem.js';
export { LeadDocument, type ILeadDocument, type LeadDocumentKind } from './LeadDocument.js';
export { Task, TASK_STATUSES, TASK_STATUS_ORDER, type ITask, type TaskStatus, type TaskOrigin } from './Task.js';
export {
  Meeting,
  MEETING_TYPES,
  MEETING_TYPE_ORDER,
  MEETING_STATUSES,
  MEETING_STATUS_ORDER,
  type IMeeting,
  type MeetingType,
  type MeetingStatus,
} from './Meeting.js';
export { Project, type IProject } from './Project.js';
export { PurposeOfInquiry, type IPurposeOfInquiry } from './PurposeOfInquiry.js';
export { QuickReply, type IQuickReply } from './QuickReply.js';
export { AuditLog, type IAuditLog } from './AuditLog.js';

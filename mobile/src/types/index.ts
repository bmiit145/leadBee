/**
 * Roles inside one organization.
 *
 * 'owner' replaces what was 'super_admin': in LeadBee, platform staff live in a
 * separate realm entirely and never appear as a tenant user, so the highest
 * role a tenant has is its own owner.
 */
export type UserRole = 'user' | 'partner' | 'manager' | 'admin' | 'owner';

/** A lead grouping — a campaign, branch or product line. */
export interface ProjectRef {
  _id: string;
  name: string;
  color?: string;
}

export const ADMIN_ROLES: UserRole[] = ['owner', 'admin', 'manager'];

export type OrgStatus = 'trialing' | 'active' | 'past_due' | 'suspended' | 'cancelled';
/**
 * A plan key is whatever the catalogue says it is.
 *
 * Deliberately a bare `string`, not a union: plans are created by operators at
 * runtime, so a compile-time union here would be wrong the moment one is added —
 * and it was one of the six places a new plan used to have to be declared.
 *
 * The app must never branch on this. Capability questions are answered by
 * `features`, which the server resolves. See docs/adr/0001-entitlement-system.md.
 */
export type Plan = string;

/**
 * The tenant this session belongs to.
 *
 * `features` gates optional functionality by plan; `limits` lets the app warn
 * before a create is refused with a 402 rather than after.
 */
export interface Organization {
  _id: string;
  name: string;
  slug: string;
  status: OrgStatus;
  plan: Plan;
  features: string[];
  limits: {
    maxUsers: number;
    maxLeads: number;
    maxMonthlyApiCalls: number;
  };
  usage: {
    users: number;
    leads: number;
    lastActivityAt?: string;
  };
  trialEndsAt?: string;
}

export interface User {
  _id: string;
  name: string;
  email?: string;
  phone: string;
  role: UserRole;
  roleId?: {
    _id: string;
    name: string;
    permissions?: string[];
  };
  projects?: ProjectRef[];
  permissions?: string[];
  avatarUrl?: string;
  designation?: string;
  locale?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * The person — one per human, whatever organizations they belong to. The app
 * holds this alone while they belong to none.
 */
export interface Account {
  _id: string;
  firstName: string;
  lastName: string;
  name: string;
  email: string;
  phone: string;
  emailVerifiedAt?: string;
}

/** One organization the signed-in person belongs to, as the switcher shows it. */
export interface OrganizationSummary {
  _id: string;
  name: string;
  slug: string;
  status: OrgStatus;
  plan: Plan;
  /** Their role in that organization. */
  role: string;
  /** False when their access there has been deactivated. */
  membershipActive: boolean;
  /** False when the organization is suspended, cancelled or its trial lapsed. */
  usable: boolean;
  isCurrent: boolean;
  isDefault: boolean;
  unreadNotifications: number;
}

export interface OrganizationsOverview {
  organizations: OrganizationSummary[];
  /** Organizations they own against the most they may own. Decided by the API. */
  ownership: { owned: number; limit: number; canCreate: boolean };
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface PaginatedResponse<T> {
  success: boolean;
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

export type LeadSource =
  | 'walk_in' | 'cold_call' | 'referral' | 'facebook' | 'instagram'
  | 'website' | '99acres' | 'magicbricks' | 'housing' | 'other';

export type LeadStage =
  | 'new' | 'assign_lead' | 'call_again' | 'follow_up' | 'qualified' | 'in_progress'
  | 'interested' | 'meeting' | 'proposal_sent' | 'pipeline' | 'postponed'
  | 'order_received' | 'drop';

export type LeadPriority = 'hot' | 'warm' | 'cold';

export type CallOutcome =
  | 'answered' | 'not_answered' | 'busy' | 'callback_requested'
  | 'not_interested' | 'interested' | 'converted';

export type ViewMode = 'admin' | 'agent';

export interface LatestCallLogSnippet {
  _id: string;
  outcome: CallOutcome;
  calledAt: string;
  calledByName: string;
  notes?: string;
}

export interface Lead {
  _id: string;
  leadNumber: string;
  contactName: string;
  contactPhone: string;
  contactSecondPhone?: string;
  contactEmail?: string;
  source: LeadSource;
  sourceDetail?: string;
  priority: LeadPriority;
  stage: LeadStage;
  lostReason?: string;
  /** The drop tag the reason names, when it names one. */
  dropReason?: string;
  project?: ProjectRef | string;
  interestedIn?: string;
  budgetMin?: number;
  budgetMax?: number;
  preferredConfig?: string;
  /** Client Details tab. */
  address?: string;
  gstNumber?: string;
  assignedTo?: User | string;
  assignedBy?: User | string;
  assignedAt?: string;
  lastContactedAt?: string;
  nextFollowUpAt?: string;
  /** One entry per stacked reminder (the reference app lets you add several). */
  reminderMinutesBefore: number[];
  isBookmarked: boolean;
  notes?: string;
  callCount: number;
  latestCallLog?: LatestCallLogSnippet;
  createdBy: User | string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CallLog {
  _id: string;
  /** Populated on the call lists, an id on a lead's own call history. */
  leadId: Lead | string;
  calledBy: User | string;
  calledByName: string;
  calledByRole: string;
  /** `app` placed it, `device` read it from the phone, `manual` predates tracking. */
  source?: 'app' | 'device' | 'manual';
  direction?: 'outgoing' | 'incoming' | 'missed' | 'rejected';
  phoneNumber?: string;
  calledAt: string;
  /** Seconds for a measured call; minutes on old manual rows. */
  duration?: number;
  /** A person's reading of the call — a measured call may have none. */
  outcome?: CallOutcome;
  notes?: string;
  nextFollowUpAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface LeadDashboardStats {
  /** One entry per LeadStage — the API builds this from the stage list, so it
   *  stays in step automatically when a stage is added. */
  byStage: Record<LeadStage, number>;
  byPriority: { hot: number; warm: number; cold: number };
  overdueFollowUps: number;
  total: number;
}

// ─── Lead Details tabs ──────────────────────────────────────────────────────

/** The three same-shaped threads on the Lead Details screen. */
export type LeadThreadChannel = 'timeline' | 'notes' | 'query';

export interface LeadThreadItem {
  _id: string;
  lead: string;
  channel: LeadThreadChannel;
  /** `activity` entries are written by LeadBee when something happens to the lead; they cannot be edited. */
  kind?: 'comment' | 'activity';
  /** What happened, on an activity entry — e.g. `stage_changed`, `meeting_booked`. */
  event?: string;
  text: string;
  createdByUser: string;
  createdByName: string;
  /** Only meaningful on the `query` channel. */
  resolved: boolean;
  createdAt: string;
  updatedAt: string;
}

export type LeadDocumentKind = 'document' | 'attachment';

export interface LeadDocument {
  _id: string;
  lead: string;
  kind: LeadDocumentKind;
  name: string;
  url: string;
  mimeType?: string;
  size?: number;
  uploadedByUser: string;
  uploadedByName: string;
  createdAt: string;
  updatedAt: string;
}

/** A file in the cross-lead Document library, with enough of its lead to label
 *  the row. `isActive` is false when the lead has since been deleted. */
export interface LibraryDocument extends Omit<LeadDocument, 'lead'> {
  lead:
    | { _id: string; leadNumber: string; contactName: string; contactPhone: string; isActive: boolean }
    | null;
}

export interface QuickReply {
  _id: string;
  createdByUser: string;
  shortcut: string;
  message: string;
  createdAt: string;
  updatedAt: string;
}

/** A tag offered when a lead is closed as lost. Organizer-curated. */
export interface LeadDropReason {
  _id: string;
  name: string;
  sortOrder: number;
}

// ─── Notifications ──────────────────────────────────────────────────────────

export type NotificationType =
  | 'lead_assigned'
  | 'task_assigned'
  | 'meeting_assigned'
  | 'meeting_rescheduled'
  | 'meeting_cancelled'
  | 'lead_transfer_requested'
  | 'lead_transfer_accepted'
  | 'lead_transfer_declined'
  | 'lead_transfer_cancelled';
export type NotificationEntity = 'lead' | 'task' | 'meeting' | 'lead_transfer';

// ─── Lead transfer ──────────────────────────────────────────────────────────

/** `pending` already accounts for expiry: the API reports a lapsed request as `expired`. */
export type LeadTransferStatus = 'pending' | 'accepted' | 'declined' | 'cancelled' | 'expired';

/** Why LeadBee closed a request nobody decided. */
export type LeadTransferCloseReason = 'owner_changed' | 'lead_removed' | 'recipient_inactive';

export type LeadTransferBox = 'received' | 'sent' | 'all';

/** A request to hand a lead to a colleague. Names are as they were when it was made. */
export interface LeadTransfer {
  _id: string;
  lead: string;
  leadNumber: string;
  contactName: string;
  fromUser: string;
  fromUserName: string;
  toUser: string;
  toUserName: string;
  requestedBy: string;
  requestedByName: string;
  reason: string;
  status: LeadTransferStatus;
  decidedBy?: string;
  decidedByName?: string;
  decidedAt?: string;
  decisionNote?: string;
  closeReason?: LeadTransferCloseReason;
  expiresAt: string;
  createdAt: string;
}

/** A colleague a lead can be handed to — all the API reveals about them. */
export interface TransferRecipient {
  _id: string;
  name: string;
  role: string;
  avatarUrl?: string;
}

/** An inbox entry. Carries the event, not a sentence — the app translates it. */
export interface AppNotification {
  _id: string;
  type: NotificationType;
  entityType: NotificationEntity;
  entityId: string;
  actorName: string;
  subject: string;
  at?: string;
  readAt?: string;
  createdAt: string;
}

// ─── Task ───────────────────────────────────────────────────────────────────

export type TaskStatus = 'pending' | 'in_progress' | 'on_hold' | 'in_review' | 'completed';
export type TaskOrigin = 'manual' | 'meeting';

export interface ChecklistItem {
  _id: string;
  text: string;
  done: boolean;
}

export interface TaskLabel {
  name: string;
  color: string;
}

export interface TaskComment {
  _id: string;
  userId: string;
  userName: string;
  text: string;
  createdAt: string;
}

/** Structurally identical to TaskComment; kept as its own name so Meeting's
 *  "Meeting Purpose" thread reads clearly at call sites. */
export type MeetingComment = TaskComment;

export interface Task {
  _id: string;
  taskNumber: string;
  subject: string;
  description?: string;
  startDate: string;
  endDate: string;
  status: TaskStatus;
  assignedTo: (User | string)[];
  checklist: ChecklistItem[];
  labels: TaskLabel[];
  images: string[];
  comments: TaskComment[];
  leadId?: Lead | string;
  meetingId?: Meeting | string;
  origin: TaskOrigin;
  createdBy: User | string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Meeting ────────────────────────────────────────────────────────────────

export type MeetingType = 'office_visit' | 'site_visit' | 'client_office' | 'phone_call' | 'google_meet' | 'zoom';
export type MeetingStatus = 'scheduled' | 'completed' | 'cancelled' | 'rescheduled';

export interface Meeting {
  _id: string;
  meetingNumber: string;
  leadId: Lead | string;
  scheduledAt: string;
  durationMinutes: number;
  assignedTo: (User | string)[];
  meetingType: MeetingType;
  purpose?: { _id: string; name: string } | string;
  comments: MeetingComment[];
  notes?: string;
  /** One entry per stacked reminder (e.g. 5 AND 120 minutes before). */
  reminderMinutesBefore: number[];
  status: MeetingStatus;
  linkedTaskId?: Task | string;
  outcome?: string;
  createdBy: User | string;
  createdAt: string;
  updatedAt: string;
}

export type SlotState = 'free' | 'busy' | 'past';

export interface MeetingSlot {
  start: string;
  end: string;
  state: SlotState;
  busyWith?: string;
}

export interface MeetingSlotsResponse {
  slots: MeetingSlot[];
  availableCount: number;
  durationMinutes: number;
}

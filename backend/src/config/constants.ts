/**
 * Domain vocabulary for LeadBee.
 *
 * The lead stages, sources, priorities, call outcomes and transition rules are
 * carried over unchanged from the reference lead workspace — the mobile UI
 * renders filter tabs straight off `LEAD_STAGE_ORDER`, so re-ordering or
 * renaming here changes the app.
 */

// ─── Tenant roles ─────────────────────────────────────────────────────────────
// Roles inside an organization. Platform admins are a separate realm entirely
// (see models/PlatformAdmin.ts) and never appear in this union.
export const ROLES = {
  USER: 'user',
  PARTNER: 'partner',
  MANAGER: 'manager',
  ADMIN: 'admin',
  OWNER: 'owner',
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

export const ROLE_ORDER: Role[] = ['user', 'partner', 'manager', 'admin', 'owner'];

/** Roles that see every lead in their organization, not just their own. */
export const ORGANIZER_ROLES: Role[] = ['owner', 'admin', 'manager'];

// ─── Permissions ──────────────────────────────────────────────────────────────
export const PERMISSIONS = {
  ALL: '*',
  USERS_MANAGE: 'users.manage',
  USERS_VIEW: 'users.view',
  ROLES_MANAGE: 'roles.manage',
  LEADS_VIEW: 'leads.view',
  LEADS_CREATE: 'leads.create',
  LEADS_EDIT: 'leads.edit',
  LEADS_DELETE: 'leads.delete',
  LEADS_ASSIGN: 'leads.assign',
  TASKS_VIEW: 'tasks.view',
  TASKS_MANAGE: 'tasks.manage',
  MEETINGS_VIEW: 'meetings.view',
  MEETINGS_MANAGE: 'meetings.manage',
  NOTES_VIEW: 'notes.view',
  NOTES_MANAGE: 'notes.manage',
  VISITS_VIEW: 'visits.view',
  VISITS_MANAGE: 'visits.manage',
  SETTINGS_MANAGE: 'settings.manage',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const DEFAULT_ROLE_PERMISSIONS: Record<Role, string[]> = {
  owner: ['*'],
  admin: ['*'],
  manager: [
    'users.view',
    'leads.view', 'leads.create', 'leads.edit', 'leads.assign',
    'tasks.view', 'tasks.manage',
    'meetings.view', 'meetings.manage',
    'notes.view', 'notes.manage',
    'visits.view', 'visits.manage',
  ],
  partner: [
    'leads.view', 'leads.create', 'leads.edit',
    'tasks.view', 'meetings.view', 'meetings.manage',
    'notes.view', 'notes.manage', 'visits.view',
  ],
  user: [
    'leads.view', 'leads.create', 'leads.edit',
    'tasks.view', 'meetings.view',
    'notes.view', 'notes.manage', 'visits.view',
  ],
};

// ─── Lead vocabulary ──────────────────────────────────────────────────────────
export const LEAD_SOURCES = {
  WALK_IN: 'walk_in',
  COLD_CALL: 'cold_call',
  REFERRAL: 'referral',
  FACEBOOK: 'facebook',
  INSTAGRAM: 'instagram',
  WEBSITE: 'website',
  NINETY_NINE_ACRES: '99acres',
  MAGIC_BRICKS: 'magicbricks',
  HOUSING: 'housing',
  OTHER: 'other',
} as const;

export type LeadSource = (typeof LEAD_SOURCES)[keyof typeof LEAD_SOURCES];

export const LEAD_SOURCE_ORDER: LeadSource[] = [
  'walk_in', 'cold_call', 'referral', 'facebook', 'instagram',
  'website', '99acres', 'magicbricks', 'housing', 'other',
];

export const LEAD_STAGES = {
  NEW: 'new',
  ASSIGN_LEAD: 'assign_lead',
  CALL_AGAIN: 'call_again',
  FOLLOW_UP: 'follow_up',
  IN_PROGRESS: 'in_progress',
  INTERESTED: 'interested',
  MEETING: 'meeting',
  PIPELINE: 'pipeline',
  POSTPONED: 'postponed',
  ORDER_RECEIVED: 'order_received',
  DROP: 'drop',
} as const;

export type LeadStage = (typeof LEAD_STAGES)[keyof typeof LEAD_STAGES];

/** Ordered for UI: the sequence the filter tabs are rendered in. */
export const LEAD_STAGE_ORDER: LeadStage[] = [
  'new',
  'assign_lead',
  'call_again',
  'follow_up',
  'in_progress',
  'interested',
  'meeting',
  'pipeline',
  'postponed',
  'order_received',
  'drop',
];

/** Stages that end the pipeline — nothing further is expected. */
export const TERMINAL_LEAD_STAGES: LeadStage[] = ['order_received', 'drop'];

export const LEAD_PRIORITIES = {
  HOT: 'hot',
  WARM: 'warm',
  COLD: 'cold',
} as const;

export type LeadPriority = (typeof LEAD_PRIORITIES)[keyof typeof LEAD_PRIORITIES];

export const LEAD_PRIORITY_ORDER: LeadPriority[] = ['hot', 'warm', 'cold'];

export const CALL_OUTCOMES = {
  ANSWERED: 'answered',
  NOT_ANSWERED: 'not_answered',
  BUSY: 'busy',
  CALLBACK_REQUESTED: 'callback_requested',
  NOT_INTERESTED: 'not_interested',
  INTERESTED: 'interested',
  CONVERTED: 'converted',
} as const;

export type CallOutcome = (typeof CALL_OUTCOMES)[keyof typeof CALL_OUTCOMES];

export const CALL_OUTCOME_ORDER: CallOutcome[] = [
  'answered', 'not_answered', 'busy', 'callback_requested',
  'not_interested', 'interested', 'converted',
];

/**
 * An agent picks the stage straight from a dropdown rather than walking a funnel,
 * so this guard is deliberately permissive: any active stage may reach any other.
 * Terminal stages are the exception — reopening a won or dropped lead is an
 * explicit act, not something that happens by mis-tap.
 */
export const VALID_LEAD_STAGE_TRANSITIONS: Record<LeadStage, LeadStage[]> =
  LEAD_STAGE_ORDER.reduce((acc, stage) => {
    acc[stage] = TERMINAL_LEAD_STAGES.includes(stage)
      ? ['new', 'follow_up']
      : LEAD_STAGE_ORDER.filter((candidate) => candidate !== stage);
    return acc;
  }, {} as Record<LeadStage, LeadStage[]>);

// ─── SaaS plans & tenancy ─────────────────────────────────────────────────────
export const ORG_STATUSES = {
  TRIALING: 'trialing',
  ACTIVE: 'active',
  PAST_DUE: 'past_due',
  SUSPENDED: 'suspended',
  CANCELLED: 'cancelled',
} as const;

export type OrgStatus = (typeof ORG_STATUSES)[keyof typeof ORG_STATUSES];

/** Statuses that still allow the tenant to sign in and use the product. */
export const ACTIVE_ORG_STATUSES: OrgStatus[] = ['trialing', 'active', 'past_due'];

export const PLANS = {
  TRIAL: 'trial',
  STARTER: 'starter',
  GROWTH: 'growth',
  ENTERPRISE: 'enterprise',
} as const;

export type Plan = (typeof PLANS)[keyof typeof PLANS];

export interface PlanLimits {
  maxUsers: number;
  maxLeads: number;
  /** -1 means unmetered. */
  maxMonthlyApiCalls: number;
  features: string[];
}

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  trial: {
    maxUsers: 3,
    maxLeads: 250,
    maxMonthlyApiCalls: 50_000,
    features: ['leads', 'tasks', 'meetings', 'notes'],
  },
  starter: {
    maxUsers: 10,
    maxLeads: 5_000,
    maxMonthlyApiCalls: 500_000,
    features: ['leads', 'tasks', 'meetings', 'notes', 'visits', 'quick_replies'],
  },
  growth: {
    maxUsers: 50,
    maxLeads: 50_000,
    maxMonthlyApiCalls: 5_000_000,
    features: ['leads', 'tasks', 'meetings', 'notes', 'visits', 'quick_replies', 'custom_roles', 'exports'],
  },
  enterprise: {
    maxUsers: -1,
    maxLeads: -1,
    maxMonthlyApiCalls: -1,
    features: ['leads', 'tasks', 'meetings', 'notes', 'visits', 'quick_replies', 'custom_roles', 'exports', 'sso', 'audit_log', 'dedicated_tier'],
  },
};

/** Where a tenant's data physically lives. See docs/MULTI-TENANCY.md. */
export const ORG_TIERS = {
  SHARED: 'shared',
  DEDICATED: 'dedicated',
} as const;

export type OrgTier = (typeof ORG_TIERS)[keyof typeof ORG_TIERS];

// ─── Audit ────────────────────────────────────────────────────────────────────
export const AUDIT_ACTIONS = {
  LEAD_CREATED: 'lead_created',
  LEAD_UPDATED: 'lead_updated',
  LEAD_DELETED: 'lead_deleted',
  LEAD_STAGE_CHANGED: 'lead_stage_changed',
  LEAD_ASSIGNED: 'lead_assigned',
  CALL_LOGGED: 'call_logged',
  MEETING_CREATED: 'meeting_created',
  MEETING_STATUS_CHANGED: 'meeting_status_changed',
  TASK_CREATED: 'task_created',
  TASK_STATUS_CHANGED: 'task_status_changed',
  NOTE_CREATED: 'note_created',
  NOTE_UPDATED: 'note_updated',
  NOTE_DELETED: 'note_deleted',
  USER_CREATED: 'user_created',
  USER_UPDATED: 'user_updated',
  USER_DEACTIVATED: 'user_deactivated',
  ORG_CREATED: 'org_created',
  ORG_STATUS_CHANGED: 'org_status_changed',
  ORG_PLAN_CHANGED: 'org_plan_changed',
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

// ─── Token audiences ──────────────────────────────────────────────────────────
// A tenant token carries `aud: leadbee:tenant` and is rejected outright by the
// platform routes, and vice versa. Separate secrets *and* separate audiences,
// so neither a secret leak nor a verification mistake alone crosses the realms.
export const TOKEN_AUDIENCE = {
  TENANT: 'leadbee:tenant',
  PLATFORM: 'leadbee:platform',
} as const;

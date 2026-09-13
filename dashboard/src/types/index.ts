export type OrgStatus = 'trialing' | 'active' | 'past_due' | 'suspended' | 'cancelled';
export type OrgTier = 'shared' | 'dedicated';
export type PlatformRole = 'owner' | 'operator' | 'support';

/**
 * A plan key is whatever the catalogue says it is.
 *
 * Deliberately a bare `string`, not a union. Plans are created by operators at
 * runtime, so a compile-time union here would be a lie the moment someone adds
 * one — and it was previously one of the six places a new plan had to be
 * declared. See docs/adr/0001-entitlement-system.md.
 */
export type PlanKey = string;

// ─── Entitlement catalogue ────────────────────────────────────────────────────

export type FeatureKind = 'boolean' | 'limit' | 'config';

/** `-1` means unlimited. `null` means the grant says nothing. */
export interface FeatureGrant {
  featureKey: string;
  enabled: boolean;
  limit?: number | null;
  config?: Record<string, unknown> | null;
}

export interface CatalogFeature {
  key: string;
  name: string;
  description?: string;
  kind: FeatureKind;
  defaultLimit: number | null;
  defaultConfig: Record<string, unknown> | null;
}

export interface CatalogModule {
  key: string;
  name: string;
  description?: string;
  sortOrder: number;
  features: CatalogFeature[];
}

export type PlanStatus = 'draft' | 'active' | 'grandfathered' | 'retired';

export interface PlanSummary {
  _id: string;
  key: PlanKey;
  version: number;
  name: string;
  description?: string;
  status: PlanStatus;
  isPublic: boolean;
  /** Server-owned display rank — replaces the old hardcoded `PLAN_RANK`. */
  sortOrder: number;
  trialDays: number;
  grants: FeatureGrant[];
  createdAt: string;
  updatedAt: string;
}

export interface PlanUsage {
  version: number;
  organizations: number;
}

export interface AddOn {
  _id: string;
  key: string;
  name: string;
  description?: string;
  isActive: boolean;
  grants: FeatureGrant[];
}

export interface Organization {
  _id: string;
  name: string;
  slug: string;
  status: OrgStatus;
  plan: PlanKey;
  tier: OrgTier;
  limits: {
    maxUsers: number;
    maxLeads: number;
    maxMonthlyApiCalls: number;
  };
  features: string[];
  usage: {
    users: number;
    leads: number;
    lastActivityAt?: string;
  };
  trialEndsAt?: string;
  suspendedAt?: string;
  suspendedReason?: string;
  billingEmail?: string;
  contactPhone?: string;
  internalNotes?: string;
  signupSource: 'self_serve' | 'platform_provisioned';
  createdAt: string;
  updatedAt: string;
}

export interface OrganizationDetail extends Organization {
  counts: { users: number; activeUsers: number; leads: number };
  owner?: {
    _id: string;
    name: string;
    email?: string;
    phone: string;
    lastLoginAt?: string;
  } | null;
}

export interface TenantUser {
  _id: string;
  name: string;
  phone: string;
  email?: string;
  role: string;
  designation?: string;
  isActive: boolean;
  lastLoginAt?: string;
  createdAt: string;
  /** The person behind this membership. Absent only on rows from before the backfill. */
  accountId?: string;
}

export interface PlatformAdmin {
  _id: string;
  name: string;
  email: string;
  role: PlatformRole;
  isActive: boolean;
  totpEnabled: boolean;
  lastLoginAt?: string;
  lastLoginIp?: string;
}

export interface PlatformMetrics {
  totals: { organizations: number; users: number; leads: number };
  byStatus: Record<string, number>;
  byPlan: Record<string, number>;
  recentSignups: number;
  expiringTrials: number;
  generatedAt: string;
}

export interface AuditEntry {
  _id: string;
  action: string;
  organizationId?: string;
  organizationName?: string;
  targetType?: string;
  targetId?: string;
  adminEmail: string;
  adminRole: string;
  reason?: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  ip?: string;
  createdAt: string;
}

// ─── Registered accounts ──────────────────────────────────────────────────────
// People who registered in the app, before belonging to any organization.
// See docs/adr/0003-pre-tenant-accounts.md.

export type AccountStatus = 'active' | 'suspended';
export type AccountVerificationFilter = 'verified' | 'unverified';

export interface Account {
  _id: string;
  name: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  status: AccountStatus;
  /** How the account came to exist: self-registration, an organization, or the backfill. */
  source: 'registration' | 'organization' | 'backfill';
  emailVerifiedAt: string | null;
  emailVerifiedVia: 'code' | 'platform_admin' | null;
  suspendedAt: string | null;
  suspendedReason: string | null;
  lastLoginAt: string | null;
  /** On list rows only: how many organizations, and the first few names. */
  organizations?: { count: number; names: string[] };
  createdAt: string;
  updatedAt: string;
}

/** One organization a person belongs to. */
export interface AccountMembership {
  _id: string;
  organization: { _id: string; name: string; slug: string; status: OrgStatus } | null;
  role: string;
  isActive: boolean;
  lastLoginAt: string | null;
  joinedAt: string;
}

export interface AccountActivityEntry {
  _id: string;
  action: string;
  adminEmail: string;
  adminRole: string;
  reason: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  createdAt: string;
}

export interface AccountDetail extends Account {
  acceptedTermsAt: string | null;
  signupIp: string | null;
  signupUserAgent: string | null;
  internalNotes: string;
  suspendedBy: { _id: string; name: string; email: string } | null;
  pendingVerification: {
    sentAt: string;
    expiresAt: string;
    attempts: number;
    maxAttempts: number;
    expired: boolean;
  } | null;
  memberships: AccountMembership[];
  activity: AccountActivityEntry[];
}

export interface AccountStats {
  total: number;
  verified: number;
  unverified: number;
  suspended: number;
  last7Days: number;
  last30Days: number;
  /** Accounts with at least one organization membership. */
  inOrganizations: number;
  generatedAt: string;
}

// ─── API envelopes ────────────────────────────────────────────────────────────

export interface ApiSingle<T> {
  success: true;
  data: T;
}

export interface ApiList<T> {
  success: true;
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ApiError {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  requestId: string;
}


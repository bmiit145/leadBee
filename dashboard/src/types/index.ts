export type OrgStatus = 'trialing' | 'active' | 'past_due' | 'suspended' | 'cancelled';
export type Plan = 'trial' | 'starter' | 'growth' | 'enterprise';
export type OrgTier = 'shared' | 'dedicated';
export type PlatformRole = 'owner' | 'operator' | 'support';

export interface Organization {
  _id: string;
  name: string;
  slug: string;
  status: OrgStatus;
  plan: Plan;
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

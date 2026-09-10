import { api } from './api';
import type {
  AddOn,
  ApiList,
  ApiSingle,
  AuditEntry,
  CatalogModule,
  FeatureGrant,
  Organization,
  OrganizationDetail,
  OrgStatus,
  PlanKey,
  PlanStatus,
  PlanSummary,
  PlanUsage,
  PlatformAdmin,
  PlatformMetrics,
  TenantUser,
} from '@/types';

export interface OrgListParams {
  page?: number;
  limit?: number;
  status?: OrgStatus;
  plan?: PlanKey;
  search?: string;
  sort?: 'newest' | 'oldest' | 'name' | 'users' | 'leads';
}

export interface PlanPayload {
  name: string;
  description?: string;
  status?: PlanStatus;
  isPublic?: boolean;
  sortOrder?: number;
  trialDays?: number;
  grants: FeatureGrant[];
}

export interface OrganizationUpdatePayload {
  organizationName?: string;
  slug?: string;
  billingEmail?: string | null;
  contactPhone?: string | null;
  ownerName?: string;
  ownerPhone?: string;
  ownerEmail?: string | null;
}

export interface OrganizationUserUpdatePayload {
  name?: string;
  phone?: string;
  email?: string | null;
  designation?: string | null;
  role?: string;
  password?: string;
}

export const platformService = {
  // ─── Auth ───────────────────────────────────────────────────────────────────
  async login(email: string, password: string, totp?: string) {
    const { data } = await api.post<
      ApiSingle<{ admin: PlatformAdmin; accessToken: string; refreshToken: string }>
    >('/auth/login', { email, password, ...(totp ? { totp } : {}) });
    return data.data;
  },

  async me() {
    const { data } = await api.get<
      ApiSingle<{ admin: PlatformAdmin; permissions: string[] }>
    >('/auth/me');
    return data.data;
  },

  async logout(refreshToken?: string) {
    await api.post('/auth/logout', { refreshToken });
  },

  async beginTotp() {
    const { data } = await api.post<ApiSingle<{ secret: string; otpauthUrl: string }>>(
      '/auth/totp/begin'
    );
    return data.data;
  },

  async confirmTotp(code: string) {
    await api.post('/auth/totp/confirm', { code });
  },

  // ─── Metrics ────────────────────────────────────────────────────────────────
  async metrics() {
    const { data } = await api.get<ApiSingle<PlatformMetrics>>('/metrics');
    return data.data;
  },

  // ─── Organizations ──────────────────────────────────────────────────────────
  async listOrganizations(params: OrgListParams) {
    const { data } = await api.get<ApiList<Organization>>('/organizations', { params });
    return data;
  },

  async getOrganization(id: string) {
    const { data } = await api.get<ApiSingle<OrganizationDetail>>(`/organizations/${id}`);
    return data.data;
  },

  async createOrganization(payload: {
    organizationName: string;
    slug?: string;
    ownerName: string;
    ownerPhone: string;
    ownerEmail: string;
    ownerPassword: string;
    plan?: PlanKey;
    status?: OrgStatus;
  }) {
    const { data } = await api.post<
      ApiSingle<{ organization: Organization; owner: TenantUser }>
    >('/organizations', payload);
    return data.data;
  },

  async updateOrganization(id: string, payload: OrganizationUpdatePayload) {
    const { data } = await api.patch<ApiSingle<OrganizationDetail>>(
      `/organizations/${id}`,
      payload
    );
    return data.data;
  },

  async setOrganizationStatus(id: string, status: OrgStatus, reason?: string) {
    const { data } = await api.patch<ApiSingle<Organization>>(
      `/organizations/${id}/status`,
      { status, ...(reason ? { reason } : {}) }
    );
    return data.data;
  },

  async setOrganizationPlan(id: string, plan: PlanKey) {
    const { data } = await api.patch<ApiSingle<Organization>>(
      `/organizations/${id}/plan`,
      { plan }
    );
    return data.data;
  },

  async setInternalNotes(id: string, internalNotes: string) {
    const { data } = await api.patch<ApiSingle<Organization>>(
      `/organizations/${id}/notes`,
      { internalNotes }
    );
    return data.data;
  },

  // ─── Tenant users ───────────────────────────────────────────────────────────
  async listOrganizationUsers(id: string, params: { page?: number; limit?: number } = {}) {
    const { data } = await api.get<ApiList<TenantUser>>(`/organizations/${id}/users`, {
      params,
    });
    return data;
  },

  async updateOrganizationUser(
    orgId: string,
    userId: string,
    payload: OrganizationUserUpdatePayload
  ) {
    const { data } = await api.patch<ApiSingle<TenantUser>>(
      `/organizations/${orgId}/users/${userId}`,
      payload
    );
    return data.data;
  },

  async setUserActive(orgId: string, userId: string, isActive: boolean) {
    const { data } = await api.patch<ApiSingle<TenantUser>>(
      `/organizations/${orgId}/users/${userId}/active`,
      { isActive }
    );
    return data.data;
  },

  // ─── Audit ──────────────────────────────────────────────────────────────────
  async auditLog(params: { organizationId?: string; page?: number; limit?: number } = {}) {
    const { data } = await api.get<ApiList<AuditEntry>>('/audit', { params });
    return data;
  },

  // ─── Entitlement catalogue ──────────────────────────────────────────────────
  // The plan builder renders whatever `/catalog` returns, so a module shipped in
  // a backend release gains its checkboxes with no change here.

  async catalog() {
    const { data } = await api.get<ApiSingle<CatalogModule[]>>('/catalog');
    return data.data;
  },

  async listPlans(allVersions = false) {
    const { data } = await api.get<ApiSingle<PlanSummary[]>>('/plans', {
      params: allVersions ? { allVersions: true } : {},
    });
    return data.data;
  },

  async getPlan(key: string, version?: number) {
    const { data } = await api.get<ApiSingle<{ plan: PlanSummary; usage: PlanUsage[] }>>(
      `/plans/${key}`,
      { params: version ? { version } : {} }
    );
    return data.data;
  },

  async createPlan(payload: PlanPayload & { key: string }) {
    const { data } = await api.post<ApiSingle<PlanSummary>>('/plans', payload);
    return data.data;
  },

  /** Publishes version + 1. Existing subscribers stay on the version they hold. */
  async publishPlanRevision(key: string, payload: PlanPayload) {
    const { data } = await api.post<ApiSingle<PlanSummary>>(
      `/plans/${key}/revisions`,
      payload
    );
    return data.data;
  },

  async setPlanStatus(key: string, version: number, status: PlanStatus) {
    const { data } = await api.patch<ApiSingle<PlanSummary>>(
      `/plans/${key}/versions/${version}/status`,
      { status }
    );
    return data.data;
  },

  async listAddOns() {
    const { data } = await api.get<ApiSingle<AddOn[]>>('/addons');
    return data.data;
  },

  async setOrganizationEntitlements(
    id: string,
    payload: { addOnKeys?: string[]; overrides?: FeatureGrant[] }
  ) {
    const { data } = await api.patch<ApiSingle<Organization>>(
      `/organizations/${id}/entitlements`,
      payload
    );
    return data.data;
  },
};

/**
 * Query keys, centralised.
 *
 * Invalidation is the thing that goes wrong quietly — a mutation that updates
 * one list but not the tile above it. Keeping the keys in one place makes the
 * relationships visible.
 */
export const queryKeys = {
  me: ['platform', 'me'] as const,
  metrics: ['platform', 'metrics'] as const,
  organizations: (params: OrgListParams) => ['platform', 'organizations', params] as const,
  organization: (id: string) => ['platform', 'organization', id] as const,
  organizationUsers: (id: string, page: number) =>
    ['platform', 'organization', id, 'users', page] as const,
  audit: (params: Record<string, unknown>) => ['platform', 'audit', params] as const,
  catalog: ['platform', 'catalog'] as const,
  plans: (allVersions = false) => ['platform', 'plans', allVersions] as const,
  plan: (key: string, version?: number) => ['platform', 'plan', key, version] as const,
  addOns: ['platform', 'addons'] as const,
};

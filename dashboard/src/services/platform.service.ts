import { api } from './api';
import type {
  ApiList,
  ApiSingle,
  AuditEntry,
  Organization,
  OrganizationDetail,
  OrgStatus,
  Plan,
  PlatformAdmin,
  PlatformMetrics,
  TenantUser,
} from '@/types';

export interface OrgListParams {
  page?: number;
  limit?: number;
  status?: OrgStatus;
  plan?: Plan;
  search?: string;
  sort?: 'newest' | 'oldest' | 'name' | 'users' | 'leads';
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
    plan?: Plan;
    status?: OrgStatus;
  }) {
    const { data } = await api.post<
      ApiSingle<{ organization: Organization; owner: TenantUser }>
    >('/organizations', payload);
    return data.data;
  },

  async setOrganizationStatus(id: string, status: OrgStatus, reason?: string) {
    const { data } = await api.patch<ApiSingle<Organization>>(
      `/organizations/${id}/status`,
      { status, ...(reason ? { reason } : {}) }
    );
    return data.data;
  },

  async setOrganizationPlan(id: string, plan: Plan) {
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
};

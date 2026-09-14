import api from './api';
import { storage } from '../utils/storage';
import { ApiResponse, Organization, OrganizationsOverview, User } from '../types';

interface TenantSessionResponse {
  session: 'tenant';
  user: User;
  organization: Organization;
  accessToken: string;
  refreshToken: string;
}

/** Stores the tokens a switch or create returned; they replace the current session. */
async function adoptSession(
  payload: TenantSessionResponse
): Promise<{ user: User; organization: Organization }> {
  if (!payload.accessToken || !payload.refreshToken) {
    throw new Error('Missing tokens in response');
  }
  await storage.setTokens(payload.accessToken, payload.refreshToken, 'tenant');
  return { user: payload.user, organization: payload.organization };
}

/**
 * The organizations a signed-in member belongs to: listing them, moving
 * between them, choosing a default, and creating another.
 *
 * Switch and create send this device's refresh token, so the API can end the
 * session held in the organization being left rather than leave it live.
 */
export const organizationsService = {
  async overview(): Promise<OrganizationsOverview> {
    const { data } = await api.get<ApiResponse<OrganizationsOverview>>('/auth/organizations');
    return data.data;
  },

  async switchTo(organizationId: string): Promise<{ user: User; organization: Organization }> {
    const refreshToken = await storage.getRefreshToken();
    const { data } = await api.post<ApiResponse<TenantSessionResponse>>(
      '/auth/switch-organization',
      { organizationId, ...(refreshToken ? { refreshToken } : {}) }
    );
    return adoptSession(data.data);
  },

  /** `null` clears the default; sign-in then opens the organization used last. */
  async setDefault(organizationId: string | null): Promise<OrganizationsOverview> {
    const { data } = await api.put<ApiResponse<OrganizationsOverview>>(
      '/auth/default-organization',
      { organizationId }
    );
    return data.data;
  },

  async create(details: {
    organizationName: string;
    slug?: string;
  }): Promise<{ user: User; organization: Organization }> {
    const refreshToken = await storage.getRefreshToken();
    const { data } = await api.post<ApiResponse<TenantSessionResponse>>('/auth/organizations', {
      ...details,
      ...(refreshToken ? { refreshToken } : {}),
    });
    return adoptSession(data.data);
  },
};

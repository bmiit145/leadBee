import api from './api';
import { storage } from '../utils/storage';
import { ApiResponse, Organization, User } from '../types';

export interface HandleAvailability {
  slug: string;
  available: boolean;
  /** `too_short` when the input cannot be a handle yet. */
  reason?: string;
}

interface OrganizationCreated {
  session: 'tenant';
  user: User;
  organization: Organization;
  accessToken: string;
  refreshToken: string;
}

/**
 * Getting a signed-in person into an organization.
 *
 * Only "create" exists so far; "join" is still to be built (KNOWN-GAPS 6.2).
 */
export const onboardingService = {
  async isHandleAvailable(slug: string): Promise<HandleAvailability> {
    const { data } = await api.get<ApiResponse<HandleAvailability>>('/signup/slug-available', {
      params: { slug },
    });
    return data.data;
  },

  /**
   * Creates an organization owned by the signed-in person and switches this
   * device to it. The API ends the account session in the same step, so the
   * returned tenant tokens replace it.
   */
  async createOrganization(details: {
    organizationName: string;
    slug?: string;
  }): Promise<{ user: User; organization: Organization }> {
    const { data } = await api.post<ApiResponse<OrganizationCreated>>(
      '/accounts/organizations',
      details
    );
    const created = data.data;
    if (!created.accessToken || !created.refreshToken) {
      throw new Error('Missing tokens in response');
    }
    await storage.setTokens(created.accessToken, created.refreshToken, 'tenant');
    return { user: created.user, organization: created.organization };
  },
};

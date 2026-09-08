import api, { apiErrorCode } from './api';
import { storage } from '../utils/storage';
import { User, ApiResponse, AuthTokens, Organization } from '../types';

interface LoginResponse {
  user: User;
  organization: Organization;
  accessToken: string;
  refreshToken: string;
}

export interface MeResponse {
  user: User;
  organization: Organization;
  isOrganizer: boolean;
}

/** One of the organizations a phone number belongs to, offered for selection. */
export interface OrgChoice {
  _id: string;
  name: string;
  slug: string;
}

/**
 * Thrown when a phone number belongs to more than one organization and the
 * caller has not said which. The login screen catches this and shows a picker.
 *
 * Not an error condition in the usual sense — it is the API asking a question,
 * so it carries the choices rather than just a message.
 */
export class OrganizationSelectionRequired extends Error {
  readonly organizations: OrgChoice[];

  constructor(organizations: OrgChoice[]) {
    super('This phone number belongs to more than one organization.');
    this.name = 'OrganizationSelectionRequired';
    this.organizations = organizations;
  }
}

export const authService = {
  /**
   * Sign in with phone and password.
   *
   * `organizationId` is only needed when the same phone exists in several
   * tenants — the overwhelming minority — so the login screen does not ask for
   * it up front and only shows a picker if the API says it must.
   */
  async login(
    phone: string,
    password: string,
    organizationId?: string
  ): Promise<LoginResponse> {
    try {
      const { data } = await api.post<ApiResponse<LoginResponse>>('/auth/login', {
        phone,
        password,
        ...(organizationId ? { organizationId } : {}),
      });

      if (!data.data.accessToken || !data.data.refreshToken) {
        throw new Error('Missing tokens in response');
      }

      await storage.setTokens(data.data.accessToken, data.data.refreshToken);
      return data.data;
    } catch (error: any) {
      if (apiErrorCode(error) === 'ORGANIZATION_SELECTION_REQUIRED') {
        const organizations =
          error?.response?.data?.error?.details?.organizations ?? [];
        throw new OrganizationSelectionRequired(organizations);
      }
      throw error;
    }
  },

  async getMe(): Promise<MeResponse> {
    const { data } = await api.get<ApiResponse<MeResponse>>('/auth/me');
    return data.data;
  },

  async refresh(): Promise<AuthTokens> {
    const refreshToken = await storage.getRefreshToken();
    if (!refreshToken) throw new Error('No refresh token available');

    try {
      const { data } = await api.post<ApiResponse<LoginResponse>>('/auth/refresh', {
        refreshToken,
      });

      if (!data.data.accessToken || !data.data.refreshToken) {
        throw new Error('Missing tokens in refresh response');
      }

      const tokens = {
        accessToken: data.data.accessToken,
        refreshToken: data.data.refreshToken,
      };
      await storage.setTokens(tokens.accessToken, tokens.refreshToken);
      return tokens;
    } catch (error: any) {
      // Only a definitive rejection clears the session; a network blip must not
      // sign a field user out.
      const status = error?.response?.status;
      if (status === 400 || status === 401 || status === 403) {
        await storage.clearTokens();
      }
      throw error;
    }
  },

  async logout(): Promise<void> {
    try {
      const refreshToken = await storage.getRefreshToken();
      // Best effort: tell the server to drop this session so the refresh token
      // stops working. A failure here must not block the local sign-out.
      await api.post('/auth/logout', { refreshToken }).catch(() => undefined);
    } finally {
      await storage.clearTokens();
    }
  },

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    await api.post<ApiResponse<null>>('/auth/change-password', {
      currentPassword,
      newPassword,
    });
  },

  async updateDefaultProject(defaultProjectId?: string | null): Promise<User> {
    const { data } = await api.put<ApiResponse<User>>('/auth/default-project', {
      defaultProjectId: defaultProjectId ?? null,
    });
    return data.data;
  },

  async registerPushToken(pushToken: string): Promise<void> {
    await api.post('/auth/push-token', { pushToken }).catch(() => undefined);
  },

  async isAuthenticated(): Promise<boolean> {
    const token = await storage.getAccessToken();
    return !!token;
  },
};

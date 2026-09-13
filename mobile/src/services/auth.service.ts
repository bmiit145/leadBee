import api, { apiErrorCode, sessionPaths } from './api';
import { storage, type SessionKind } from '../utils/storage';
import { User, ApiResponse, AuthTokens, Organization, Account } from '../types';

interface TenantLoginResponse {
  /** Absent from APIs that predate account sessions, which issued only these. */
  session?: 'tenant';
  user: User;
  organization: Organization;
  accessToken: string;
  refreshToken: string;
}

interface AccountLoginResponse {
  session: 'account';
  account: Account;
  organization: null;
  accessToken: string;
  refreshToken: string;
}

/**
 * What a sign-in opened: a membership in an organization, or — for someone who
 * belongs to none yet — their account alone.
 */
export type LoginResult =
  | { session: 'tenant'; user: User; organization: Organization }
  | { session: 'account'; account: Account };

export interface MeResponse {
  user: User;
  organization: Organization;
  isOrganizer: boolean;
}

export interface AccountMeResponse {
  account: Account;
  /** Above zero once someone has added this person to an organization. */
  organizationCount: number;
}

/** One of the organizations an account belongs to, offered for selection. */
export interface OrgChoice {
  _id: string;
  name: string;
  slug: string;
}

/**
 * Thrown when the account belongs to more than one organization and the
 * caller has not said which. The login screen catches this and shows a picker.
 *
 * Not an error condition in the usual sense — it is the API asking a question,
 * so it carries the choices rather than just a message.
 */
export class OrganizationSelectionRequired extends Error {
  readonly organizations: OrgChoice[];

  constructor(organizations: OrgChoice[]) {
    super('This account belongs to more than one organization.');
    this.name = 'OrganizationSelectionRequired';
    this.organizations = organizations;
  }
}

export const authService = {
  /**
   * Sign in with an email or mobile number and the account's password.
   *
   * `organizationId` is only needed when the account belongs to several
   * organizations — the minority — so the login screen does not ask for it up
   * front and only shows a picker if the API says it must. Someone who belongs
   * to no organization gets an account session. A suspended account (403
   * `ACCOUNT_SUSPENDED`) or an unconfirmed registration (403
   * `EMAIL_NOT_VERIFIED`) surfaces as the API's message.
   */
  async login(
    identifier: string,
    password: string,
    organizationId?: string
  ): Promise<LoginResult> {
    try {
      const { data } = await api.post<ApiResponse<TenantLoginResponse | AccountLoginResponse>>(
        '/auth/login',
        {
          identifier,
          password,
          ...(organizationId ? { organizationId } : {}),
        }
      );

      const payload = data.data;
      if (!payload.accessToken || !payload.refreshToken) {
        throw new Error('Missing tokens in response');
      }

      if (payload.session === 'account') {
        await storage.setTokens(payload.accessToken, payload.refreshToken, 'account');
        return { session: 'account', account: payload.account };
      }

      await storage.setTokens(payload.accessToken, payload.refreshToken, 'tenant');
      return { session: 'tenant', user: payload.user, organization: payload.organization };
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

  /** The signed-in person, on an account session. */
  async getAccountMe(): Promise<AccountMeResponse> {
    const { data } = await api.get<ApiResponse<AccountMeResponse>>('/accounts/me');
    return data.data;
  },

  async getSessionKind(): Promise<SessionKind> {
    return storage.getSessionKind();
  },

  async refresh(): Promise<AuthTokens> {
    const refreshToken = await storage.getRefreshToken();
    if (!refreshToken) throw new Error('No refresh token available');

    try {
      const { refresh } = sessionPaths(await storage.getSessionKind());
      const { data } = await api.post<ApiResponse<AuthTokens>>(refresh, { refreshToken });

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
      const [refreshToken, kind] = await Promise.all([
        storage.getRefreshToken(),
        storage.getSessionKind(),
      ]);
      // Best effort: tell the server to drop this session so the refresh token
      // stops working. A failure here must not block the local sign-out.
      await api.post(sessionPaths(kind).logout, { refreshToken }).catch(() => undefined);
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

  /**
   * Updates the signed-in user's own name, email and designation.
   *
   * Resolves to nothing on purpose: the response carries `roleId` unpopulated,
   * so callers re-read the session with `reloadSession` instead of trusting it.
   * Phone is not accepted — it is the sign-in identifier.
   */
  async updateProfile(changes: { name: string; email: string; designation: string }): Promise<void> {
    await api.put<ApiResponse<unknown>>('/auth/me', changes);
  },

  async registerPushToken(pushToken: string): Promise<void> {
    await api.post('/auth/push-token', { pushToken }).catch(() => undefined);
  },

  async isAuthenticated(): Promise<boolean> {
    const token = await storage.getAccessToken();
    return !!token;
  },
};

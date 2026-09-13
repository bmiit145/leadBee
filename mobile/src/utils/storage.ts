import * as SecureStore from 'expo-secure-store';

const KEYS = {
  ACCESS_TOKEN: 'moto_access_token',
  REFRESH_TOKEN: 'moto_refresh_token',
  SESSION_KIND: 'moto_session_kind',
  USER: 'moto_user_data',
  PROJECT_CACHE: 'moto_project_cache',
} as const;

/**
 * Which realm the stored tokens belong to.
 *
 * `tenant` is a membership session. `account` is held by someone signed in who
 * belongs to no organization yet; its tokens refresh at a different endpoint
 * and reach only their own account.
 */
export type SessionKind = 'tenant' | 'account';

export const storage = {
  async getAccessToken(): Promise<string | null> {
    return SecureStore.getItemAsync(KEYS.ACCESS_TOKEN);
  },

  async setAccessToken(token: string): Promise<void> {
    await SecureStore.setItemAsync(KEYS.ACCESS_TOKEN, token);
  },

  async getRefreshToken(): Promise<string | null> {
    return SecureStore.getItemAsync(KEYS.REFRESH_TOKEN);
  },

  async setRefreshToken(token: string): Promise<void> {
    await SecureStore.setItemAsync(KEYS.REFRESH_TOKEN, token);
  },

  /** Absent on installs signed in before account sessions existed, which were all tenant. */
  async getSessionKind(): Promise<SessionKind> {
    return (await SecureStore.getItemAsync(KEYS.SESSION_KIND)) === 'account' ? 'account' : 'tenant';
  },

  async setUser(user: any): Promise<void> {
    if (!user) {
      await SecureStore.deleteItemAsync(KEYS.USER);
    } else {
      await SecureStore.setItemAsync(KEYS.USER, JSON.stringify(user));
    }
  },

  async getUser(): Promise<any | null> {
    const data = await SecureStore.getItemAsync(KEYS.USER);
    return data ? JSON.parse(data) : null;
  },

  /** `kind` is given when a session starts; a rotation leaves it unchanged. */
  async setTokens(accessToken: string, refreshToken: string, kind?: SessionKind): Promise<void> {
    await Promise.all([
      SecureStore.setItemAsync(KEYS.ACCESS_TOKEN, accessToken),
      SecureStore.setItemAsync(KEYS.REFRESH_TOKEN, refreshToken),
      ...(kind ? [SecureStore.setItemAsync(KEYS.SESSION_KIND, kind)] : []),
    ]);
  },

  async clearTokens(): Promise<void> {
    await Promise.all([
      SecureStore.deleteItemAsync(KEYS.ACCESS_TOKEN),
      SecureStore.deleteItemAsync(KEYS.REFRESH_TOKEN),
      SecureStore.deleteItemAsync(KEYS.SESSION_KIND),
      SecureStore.deleteItemAsync(KEYS.USER),
    ]);
  },

  async setProjectCache(cache: any): Promise<void> {
    await SecureStore.setItemAsync(KEYS.PROJECT_CACHE, JSON.stringify(cache));
  },

  async getProjectCache(): Promise<any | null> {
    const data = await SecureStore.getItemAsync(KEYS.PROJECT_CACHE);
    return data ? JSON.parse(data) : null;
  },

  async clearProjectCache(): Promise<void> {
    await SecureStore.deleteItemAsync(KEYS.PROJECT_CACHE);
  },
};

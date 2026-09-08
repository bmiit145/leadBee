import * as SecureStore from 'expo-secure-store';

const KEYS = {
  ACCESS_TOKEN: 'moto_access_token',
  REFRESH_TOKEN: 'moto_refresh_token',
  USER: 'moto_user_data',
  PROJECT_CACHE: 'moto_project_cache',
} as const;

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

  async setTokens(accessToken: string, refreshToken: string): Promise<void> {
    await Promise.all([
      SecureStore.setItemAsync(KEYS.ACCESS_TOKEN, accessToken),
      SecureStore.setItemAsync(KEYS.REFRESH_TOKEN, refreshToken),
    ]);
  },

  async clearTokens(): Promise<void> {
    await Promise.all([
      SecureStore.deleteItemAsync(KEYS.ACCESS_TOKEN),
      SecureStore.deleteItemAsync(KEYS.REFRESH_TOKEN),
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

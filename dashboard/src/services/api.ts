import axios, {
  AxiosError,
  type AxiosInstance,
  type InternalAxiosRequestConfig,
} from 'axios';
import type { ApiError } from '@/types';

const ACCESS_KEY = 'leadbee.platform.access';
const REFRESH_KEY = 'leadbee.platform.refresh';

export const tokenStore = {
  get access(): string | null {
    return localStorage.getItem(ACCESS_KEY);
  },
  get refresh(): string | null {
    return localStorage.getItem(REFRESH_KEY);
  },
  set(access: string, refresh: string): void {
    localStorage.setItem(ACCESS_KEY, access);
    localStorage.setItem(REFRESH_KEY, refresh);
  },
  clear(): void {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
  },
};

export const api: AxiosInstance = axios.create({
  baseURL: '/api/v1/platform',
  timeout: 30_000,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = tokenStore.access;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

/**
 * Refresh-on-401, with a single-flight guard.
 *
 * Without the guard, a page that fires six queries on mount would send six
 * refresh requests the moment the access token expires. Five of them would
 * present an already-rotated token — which the API treats as replay and
 * responds to by revoking every session. So the first 401 starts one refresh
 * and everyone else waits on it.
 */
let refreshInFlight: Promise<string> | null = null;

async function refreshAccessToken(): Promise<string> {
  const refreshToken = tokenStore.refresh;
  if (!refreshToken) throw new Error('No refresh token');

  // Bare axios, not `api` — going through the instance would re-enter this
  // interceptor and loop.
  const { data } = await axios.post<{
    success: true;
    data: { accessToken: string; refreshToken: string };
  }>('/api/v1/platform/auth/refresh', { refreshToken });

  tokenStore.set(data.data.accessToken, data.data.refreshToken);
  return data.data.accessToken;
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<ApiError>) => {
    const original = error.config as InternalAxiosRequestConfig & {
      _retried?: boolean;
    };

    const isAuthRoute = original?.url?.includes('/auth/');
    if (
      error.response?.status === 401 &&
      original &&
      !original._retried &&
      !isAuthRoute
    ) {
      original._retried = true;
      try {
        refreshInFlight ??= refreshAccessToken().finally(() => {
          refreshInFlight = null;
        });
        const token = await refreshInFlight;
        original.headers.Authorization = `Bearer ${token}`;
        return api(original);
      } catch {
        tokenStore.clear();
        // Hard redirect rather than a router navigate: the auth store and every
        // cached query are stale at this point, and a full reload is the only
        // way to be sure none of it survives.
        window.location.href = '/login';
        return Promise.reject(error);
      }
    }

    return Promise.reject(error);
  }
);

/** The API's message for a failed request, or a sensible fallback. */
export function errorMessage(error: unknown, fallback = 'Something went wrong'): string {
  if (axios.isAxiosError<ApiError>(error)) {
    return error.response?.data?.error?.message ?? error.message ?? fallback;
  }
  if (error instanceof Error) return error.message;
  return fallback;
}

/** The API's stable machine code, for branching on specific failures. */
export function errorCode(error: unknown): string | undefined {
  if (axios.isAxiosError<ApiError>(error)) {
    return error.response?.data?.error?.code;
  }
  return undefined;
}

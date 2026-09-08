import { Platform } from 'react-native';
import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { storage } from '../utils/storage';

/**
 * The LeadBee API client.
 *
 * The base URL is resolved once, at module load, from `EXPO_PUBLIC_API_URL`.
 * The app this was ported from also allowed Firebase Remote Config to override
 * it at runtime; that has been removed here — it carried a dependency on
 * another product's Firebase project, and an API endpoint that can be
 * repointed remotely is a redirection risk that a lead CRM does not need.
 */

const DEFAULT_API_BASE_URL =
  // The Android emulator reaches the host machine at 10.0.2.2, never localhost.
  Platform.OS === 'android'
    ? 'http://10.0.2.2:4000/api/v1'
    : 'http://localhost:4000/api/v1';

const resolveApiBaseUrl = (): string => {
  const configuredUrl = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (!configuredUrl) return DEFAULT_API_BASE_URL;

  if (Platform.OS === 'android') {
    return configuredUrl
      .replace('://localhost', '://10.0.2.2')
      .replace('://127.0.0.1', '://10.0.2.2');
  }

  return configuredUrl;
};

export const API_BASE_URL = resolveApiBaseUrl();

const SENSITIVE_KEYS = new Set([
  'password',
  'currentPassword',
  'newPassword',
  'refreshToken',
  'accessToken',
  'authorization',
]);

/** Requests are logged in development; credentials must never ride along. */
const sanitizeForLog = (value: any): any => {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(sanitizeForLog);
  if (typeof value !== 'object') return value;

  return Object.keys(value).reduce((acc: Record<string, any>, key) => {
    if (SENSITIVE_KEYS.has(key)) {
      acc[key] = '[REDACTED]';
      return acc;
    }
    acc[key] = sanitizeForLog(value[key]);
    return acc;
  }, {});
};

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
});

// Dedicated client for the refresh call: going through `api` would re-enter the
// response interceptor and loop.
const refreshApi = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
  headers: { 'Content-Type': 'application/json' },
});

// ─── Single-flight refresh ───────────────────────────────────────────────────
// A screen that fires five queries at mount would otherwise send five refresh
// requests the moment the access token expires. Four of them would present an
// already-rotated token, which the API treats as replay — and responds to by
// revoking every session. So the first 401 does the refresh and the rest queue.
let isRefreshing = false;
let failedQueue: Array<{
  resolve: (value?: unknown) => void;
  reject: (reason?: unknown) => void;
}> = [];

const processQueue = (error: Error | null, token: string | null = null) => {
  failedQueue.forEach((prom) => {
    if (error) prom.reject(error);
    else prom.resolve(token);
  });
  failedQueue = [];
};

api.interceptors.request.use(
  async (config: InternalAxiosRequestConfig) => {
    if (__DEV__) {
      console.log(`🚀 [API] ${config.method?.toUpperCase()} ${config.baseURL}${config.url}`);
    }

    const token = await storage.getAccessToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// ─── Forced logout ───────────────────────────────────────────────────────────
// The auth store registers a callback on mount so the interceptor can push the
// user to the login screen the moment a refresh is refused.
let _forcedLogoutCallback: (() => void) | null = null;

export const setForcedLogoutCallback = (fn: () => void) => {
  _forcedLogoutCallback = fn;
};

// ─── Organization state ──────────────────────────────────────────────────────
// The API answers 403 ORGANIZATION_INACTIVE when a tenant is suspended or its
// trial has lapsed. That is not an auth failure — clearing tokens would send
// the user to a login screen that then rejects them with the same message and
// no explanation. The store shows a dedicated screen instead.
let _orgInactiveCallback: ((message: string) => void) | null = null;

export const setOrgInactiveCallback = (fn: (message: string) => void) => {
  _orgInactiveCallback = fn;
};

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<any>) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & {
      _retry?: boolean;
    };

    const code = error.response?.data?.error?.code;

    if (error.response?.status === 403 && code === 'ORGANIZATION_INACTIVE') {
      _orgInactiveCallback?.(
        error.response?.data?.error?.message ?? 'This organization is not active.'
      );
      return Promise.reject(error);
    }

    if (error.response?.status === 401 && originalRequest && !originalRequest._retry) {
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        }).then((token) => {
          originalRequest.headers.Authorization = `Bearer ${token}`;
          return api(originalRequest);
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        const refreshToken = await storage.getRefreshToken();
        if (!refreshToken) throw new Error('No refresh token');

        const { data } = await refreshApi.post('/auth/refresh', { refreshToken });
        const { accessToken, refreshToken: newRefreshToken } = data.data;
        await storage.setTokens(accessToken, newRefreshToken);

        processQueue(null, accessToken);
        originalRequest.headers.Authorization = `Bearer ${accessToken}`;
        return api(originalRequest);
      } catch (refreshError) {
        processQueue(refreshError as Error, null);
        const refreshStatus = (refreshError as AxiosError).response?.status;

        // Only a definitive rejection ends the session. A timeout or a 502 means
        // the network is having a bad moment, and signing the user out of a
        // field app over that is worse than letting them retry.
        const shouldForceLogout =
          refreshStatus === 400 || refreshStatus === 401 || refreshStatus === 403;

        if (shouldForceLogout) {
          await storage.clearTokens();
          _forcedLogoutCallback?.();
        } else if (__DEV__) {
          console.warn('⚠️ Refresh failed without logout (transient):', refreshStatus);
        }

        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    if (__DEV__ && error.response) {
      console.log('❌ [API]', error.response.status, sanitizeForLog(error.response.data));
    }

    return Promise.reject(error);
  }
);

/** The API's message for a failed request, or a sensible fallback. */
export function apiErrorMessage(error: any, fallback = 'Something went wrong'): string {
  return (
    error?.response?.data?.error?.message ??
    error?.response?.data?.message ??
    error?.message ??
    fallback
  );
}

/** The API's stable machine code, for branching on specific failures. */
export function apiErrorCode(error: any): string | undefined {
  return error?.response?.data?.error?.code;
}

export default api;

import { isAxiosError } from 'axios';

type Translate = (key: string, options?: Record<string, unknown>) => string;

export interface SignInErrorView {
  /** `warning` when nothing is wrong with what was typed — the account or organization is. */
  tone: 'error' | 'warning';
  title: string;
  message: string;
  /** Only after a wrong password: it is retyped from scratch, the identifier stays. */
  clearPassword: boolean;
}

interface ApiErrorBody {
  error?: { code?: string; details?: { status?: string } };
}

/**
 * Every way a sign-in can fail, as something a person can act on.
 *
 * Decided by the API's stable error `code` and HTTP status — never by matching
 * its English message — so the wording is translated and can change freely.
 * Deliberately says nothing that tells an unknown email from a wrong password:
 * both are "incorrect details", as the API intends.
 *
 * | Case | Status / code |
 * | --- | --- |
 * | Wrong email, mobile or password | 401 |
 * | Account suspended by LeadBee | 403 `ACCOUNT_SUSPENDED` |
 * | Registered, email never confirmed | 403 `EMAIL_NOT_VERIFIED` |
 * | Organization suspended / not active | 403 `ORGANIZATION_INACTIVE` |
 * | Access deactivated in the organization(s) | 403 other |
 * | Too many attempts | 429 `RATE_LIMITED` (+ `Retry-After`) |
 * | Input the API rejected | 400 / 422 |
 * | Server fault or overload | 5xx |
 * | Request timed out | no response, `ECONNABORTED` / `ETIMEDOUT` |
 * | Server never reached | no response |
 *
 * Choosing among several organizations (409) is not a failure; the login screen
 * handles it before this is reached.
 */
export function describeSignInError(error: unknown, t: Translate): SignInErrorView {
  const view = (
    key: string,
    tone: SignInErrorView['tone'] = 'error',
    options?: Record<string, unknown>,
    clearPassword = false
  ): SignInErrorView => ({
    tone,
    title: t(`signInErrors.${key}Title`),
    message: t(`signInErrors.${key}`, options),
    clearPassword,
  });

  // Not an HTTP failure at all — a bug or an unexpected response shape.
  if (!isAxiosError<ApiErrorBody>(error)) return view('unknown');

  const response = error.response;
  if (!response) {
    const timedOut = error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT';
    return view(timedOut ? 'timeout' : 'offline');
  }

  const code = response.data?.error?.code;
  const status = response.status;

  if (status === 401) return view('invalidCredentials', 'error', undefined, true);

  if (status === 403) {
    switch (code) {
      case 'ACCOUNT_SUSPENDED':
        return view('suspended', 'warning');
      case 'EMAIL_NOT_VERIFIED':
        return view('emailNotVerified', 'warning');
      case 'ORGANIZATION_INACTIVE':
        return view(
          response.data?.error?.details?.status === 'suspended'
            ? 'organizationSuspended'
            : 'organizationInactive',
          'warning'
        );
      default:
        return view('accessDeactivated', 'warning');
    }
  }

  if (status === 429) {
    const seconds = Number(response.headers?.['retry-after']);
    return Number.isFinite(seconds) && seconds > 0
      ? view('rateLimited', 'warning', { seconds: Math.ceil(seconds) })
      : view('rateLimitedNoTime', 'warning');
  }

  if (status === 400 || status === 422) return view('invalidInput');
  if (status >= 500) return view('serverError');
  return view('unknown');
}

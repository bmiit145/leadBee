/**
 * Deploy-time configuration for the control plane.
 *
 * `VITE_*` values are inlined into the bundle at build time, which makes this
 * Tier 0 configuration in the sense of `docs/standards/CONFIGURATION-AND-PLANS.md`:
 * it changes by redeploy, never at runtime. Nothing secret may live here — the
 * bundle ships to the browser and is trivially readable.
 */

/**
 * Origin of the LeadBee API: scheme and host only, no path, no trailing slash.
 *
 * Empty means "same origin", which is exactly what local development wants —
 * the Vite dev server proxies `/api` to the backend, so the browser never makes
 * a cross-origin request.
 *
 * A deployed build has no such proxy. A `vercel.json` rewrite cannot stand in
 * for one either: rewrites are static and cannot differ between Preview and
 * Production, so a single rewrite could not point staging at the staging API.
 * Every deployed environment therefore sets this to its own API origin.
 */
const configured = import.meta.env.VITE_API_ORIGIN?.trim() ?? '';

// A trailing slash here becomes `https://api.example.com//api/v1`, which is the
// classic way to turn a working deploy into a wall of 404s.
const apiOrigin = configured.replace(/\/+$/, '');

/**
 * Fail the build's first paint rather than every request.
 *
 * Left unset in production, every call would resolve against the dashboard's
 * own domain — where there is no API — and return the SPA's `index.html` with a
 * 200, so axios would report a JSON parse failure rather than a misconfigured
 * deploy. This mirrors the backend's stance in `config/env.ts`: refusing to
 * start beats revealing the problem later under load.
 */
if (import.meta.env.PROD && !apiOrigin) {
  throw new Error(
    'VITE_API_ORIGIN is required in a production build. Set it to the API origin ' +
      'for this environment (for example https://api.example.com) in the hosting ' +
      "provider's environment variables, then redeploy."
  );
}

if (apiOrigin && !/^https?:\/\//.test(apiOrigin)) {
  throw new Error(
    `VITE_API_ORIGIN must be an absolute origin including the scheme; received "${apiOrigin}".`
  );
}

/** `https://api.example.com`, or `''` for same-origin development. */
export const API_ORIGIN = apiOrigin;

/** Versioned API root. Tenant routes hang off this; the control plane does not. */
export const API_BASE_URL = `${apiOrigin}/api/v1`;

/** Everything this app calls lives under the platform realm. */
export const PLATFORM_BASE_URL = `${API_BASE_URL}/platform`;

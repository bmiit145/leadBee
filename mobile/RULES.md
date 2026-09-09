# Mobile Rules — `mobile/`

Expo SDK 57 · React Native · expo-router · TanStack Query. **Tenant users only.**

Read first: [Architecture Rules](../docs/standards/ARCHITECTURE-RULES.md) ·
[Engineering Standards](../docs/standards/ENGINEERING-STANDARDS.md) ·
[Configuration and Plans](../docs/standards/CONFIGURATION-AND-PLANS.md)

Rule ID prefix: `MOB`.

---

## What this app is

### MOB-1 — The mobile app is the tenant realm only · MUST · Enforced

It talks to `/api/v1/*` with a tenant token and must never hold a platform
token or call `/api/v1/platform/*`.

### MOB-2 — The app never decides what it is allowed to do · MUST · Enforced

Permissions and `features` shape the UI — hide a tab, disable a button. They
are never the enforcement. Every action is authorised server-side
([CFG-8](../docs/standards/CONFIGURATION-AND-PLANS.md#cfg-8--the-client-never-decides-entitlement--must--enforced)).

Assume a modified client. A hidden button must be a rejected request, not just
a hidden button.

---

## Structure

### MOB-3 — Routing is file-based · MUST · Enforced

```
app/                      routes only — a screen and its layout
  (auth)/ (leads)/        route groups
  lead/[id].tsx           dynamic segments
src/
  services/  components/  hooks/  utils/  types/  i18n/
```

Business logic does not live in `app/`. A route file composes; it does not
implement.

### MOB-4 — All network access goes through the shared client · MUST · Enforced

[`src/services/api.ts`](./src/services/api.ts) owns the base URL, auth header,
refresh and redaction. A second axios instance would bypass all four.

The one deliberate exception is the dedicated refresh client, which exists
precisely because routing refresh through the main instance re-enters the
response interceptor and loops.

---

## Authentication

### MOB-5 — Refresh is single-flight · MUST · Enforced

A screen firing five queries at mount would otherwise send five refreshes; four
would present an already-rotated token, which the API treats as replay and
answers by revoking **every** session. The first 401 refreshes; the rest queue.

### MOB-6 — Only a definitive rejection ends a session · MUST · Enforced

Force logout on `400`/`401`/`403` from refresh. A timeout, a 502 or a network
error must **not** sign the user out.

**Why.** This is a field app used on mobile networks. Signing an agent out
mid-visit because a tunnel blipped is worse than letting them retry.

### MOB-7 — Inactive organizations are not auth failures · MUST · Enforced

`403 ORGANIZATION_INACTIVE` routes to a dedicated screen. Clearing tokens would
send the user to a login screen that rejects them with the same message and no
explanation.

### MOB-8 — Credentials never reach a log · MUST · Enforced

`sanitizeForLog` redacts passwords and tokens recursively before anything is
written. Adding a new credential-bearing field means adding its key to
`SENSITIVE_KEYS`.

### MOB-9 — Tokens live in secure storage · MUST

Access and refresh tokens go to `expo-secure-store` (Keychain / Keystore),
never plain `AsyncStorage`, which is world-readable on a rooted device.

---

## Configuration

### MOB-10 — `EXPO_PUBLIC_*` is build-time, not runtime · MUST · Enforced

These values are **inlined into the bundle**. Changing `.env` does nothing
until Metro restarts and the bundle is rebuilt — a fact that has already cost
debugging time.

Anything that must vary per environment after shipping comes from the API, not
from the bundle.

### MOB-11 — Nothing in `EXPO_PUBLIC_*` is a secret · MUST · Enforced

The bundle ships to devices and is trivially readable. There are no client
secrets — only public endpoints.

### MOB-12 — The API base URL is honoured exactly as configured · MUST · Enforced

An explicitly configured `EXPO_PUBLIC_API_URL` is used verbatim.

This previously rewrote `localhost` → `10.0.2.2` on *any* Android, which is
correct only on the emulator — `10.0.2.2` is unroutable from a real handset, so
every physical-device setup silently broke. The emulator convenience now lives
in the fallback default, which applies only when nothing is configured.

### MOB-13 — The API endpoint is never remotely repointable · MUST · Enforced

Firebase Remote Config was removed deliberately: an API URL that can be changed
from outside the app is a redirection risk. OTA updates via `expo-updates` are
retained; remote endpoint override is not.

---

## Offline and network

### MOB-14 — Every screen tolerates a bad network · MUST

Loading, error and empty are designed states, with a retry affordance. This app
is used in basements and lifts.

### MOB-15 — Never block the UI on a background write · SHOULD

Reminders, bookmarks and call logs should feel instant. Where an optimistic
update is used, a failure must be visible and reversible — silent data loss is
worse than a spinner.

---

## Localisation

### MOB-16 — User-facing strings come from `i18n`, never inline · MUST · Enforced

The app ships Gujarati and English. A hardcoded English string is invisible to
translation and will ship untranslated.

### MOB-17 — Locale-format dates, numbers and currency · MUST · Enforced

Never hand-concatenate. `1,00,000` and `100,000` are both correct depending on
locale.

### MOB-18 — Brand and product strings are part of the product · SHOULD · Target

The login screen still renders the predecessor product's branding — a property
logo and "મિલ્કત વ્યવસ્થાપન સિસ્ટમ" ("Property Management System") — while the
profile screen correctly reads "LeadBee — Lead management, done properly".

Leftover branding from the port is a defect, not cosmetics: it is the first
screen a customer sees.

---

## Release

### MOB-19 — Native config changes require a new build · MUST · Enforced

Permissions, plugins, icons and `app.json` changes are **not** deliverable over
OTA. Only the JS bundle is. Shipping a native change as an OTA update produces
a mismatched binary.

### MOB-20 — Gradle output stays out of the bundler's watch path · MUST · Enforced

Metro's Windows fallback watcher dies with `ENOENT` when Gradle deletes a
directory mid-crawl. [`metro.config.js`](./metro.config.js) excludes Gradle's
output directories — including those under `node_modules`, where Expo's own
Gradle plugins build.

Exclude Gradle's *subdirectories* (`build/classes`, `build/intermediates`,
`.cxx`, `.gradle`), never `build/` wholesale — packages such as
`expo-constants` ship their real JS in `build/`, and blocking it breaks module
resolution.

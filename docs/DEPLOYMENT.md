# Deployment

How the three surfaces are hosted, what each one needs configured, and the one
value that has to agree across all of them.

## Topology

| Surface | Host | Artifact | Reaches the API by |
| --- | --- | --- | --- |
| `backend/` | Always-on Node host (Render, Railway, Fly, VPS) | long-running `node dist/server.js` | — |
| `dashboard/` | **Vercel** | static SPA in `dist/` | cross-origin to `VITE_API_ORIGIN` |
| `mobile/` | **EAS Build** → App Store / Play, OTA via EAS Update | native binary | `EXPO_PUBLIC_API_URL` |

There are three environments: **development** (local), **staging** (preview
builds and the Vercel Preview environment) and **production**. Each has its own
API. Nothing in staging may point at production.

### Why the API is not on Vercel

The API is a stateful long-running process, not a function. It keeps a Mongoose
connection pool, an `AsyncLocalStorage` tenant scope, an in-memory rate-limit
store, an event-loop-delay load shedder (`@fastify/under-pressure`) and a
graceful-shutdown lifecycle. Each of those assumes a process that outlives a
single request. Putting it behind serverless invocations would exhaust Mongo
connections, reset rate limits every cold start, and make readiness meaningless.

Vercel hosts the dashboard, which is static files and nothing else.

---

## 1. The value that must agree everywhere

One origin, written into four places. Get this wrong and the symptom is always
the same: requests resolving against the wrong host.

| Where | Key | Value | Includes `/api/v1`? |
| --- | --- | --- | --- |
| Vercel (dashboard) | `VITE_API_ORIGIN` | `https://api.example.com` | **No** — origin only |
| EAS (mobile) | `EXPO_PUBLIC_API_URL` | `https://api.example.com/api/v1` | **Yes** |
| Backend host | `CORS_ORIGINS` | the dashboard's origin(s) | n/a |
| DNS | — | `api.example.com` → backend host | n/a |

The two clients differ on purpose: the dashboard appends `/api/v1/platform`
itself (`dashboard/src/config/env.ts`), while the mobile client uses its value
verbatim (`MOB-12`).

All three are checked rather than trusted:

- `vite build` **fails** if `VITE_API_ORIGIN` is unset.
- The API **refuses to boot** in production if `CORS_ORIGINS` is empty or
  contains a non-`https` origin.
- A staging or production app build **throws at launch** if
  `EXPO_PUBLIC_API_URL` is unset, rather than silently using the emulator
  default.

---

## 2. Backend — always-on Node host

### Requirements

- **Node 20+**.
- **MongoDB as a replica set.** Not optional: organization provisioning runs a
  multi-document transaction, which needs an oplog. Atlas gives you this on any
  tier. A standalone `mongod` will fail provisioning at runtime, not at boot.

### Build and run

```bash
pnpm install --frozen-lockfile   # from the REPOSITORY ROOT, not backend/
pnpm --filter @leadbee/backend build
pnpm --filter @leadbee/backend start
```

`backend/` is a pnpm workspace member, so it has no lockfile of its own and
must be installed from the root. `pnpm@10.28.0` is pinned in
`package.json#packageManager`; a host that picks its own pnpm version can
resolve a different tree from the committed lockfile.

Do not deploy this to a serverless platform. It is a long-running process:
`server.ts` calls `app.listen()` and registers a graceful-shutdown hook, and
the connection pool, tenant `AsyncLocalStorage` scope, rate-limit store and
load shedder all assume a process that outlives a single request. A serverless
build will go green and then serve nothing, because there is no function
entrypoint.

`PORT` and `HOST` come from the environment; the host's injected `PORT` is
honoured. `trustProxy` is already on, so client IPs and protocol survive the
load balancer — which the rate limiter depends on for its IP fallback.

### Health checks

| Path | Meaning | Point the platform's health check at |
| --- | --- | --- |
| `GET /api/v1/health` | liveness — process is up | restart checks |
| `GET /api/v1/health/ready` | readiness — dependencies are reachable; 503 when not | traffic/rollout gating |

Use liveness for restarts and readiness for traffic. Restarting on readiness
turns a transient database blip into a crash loop; the split exists for exactly
that reason.

### Environment

Copy `backend/.env.example` and set every value. The process validates env at
boot and exits rather than starting half-configured.

Production-specific notes:

- `NODE_ENV=production` — also removes `/docs`; OpenAPI is not served publicly.
- `JWT_SECRET`, `JWT_REFRESH_SECRET`, `PLATFORM_JWT_SECRET`,
  `PLATFORM_JWT_REFRESH_SECRET` — four **distinct** secrets, 32+ chars each.
  The tenant/platform split is a security boundary (`ARCH-3`); reusing one
  value across realms silently collapses it.
- `CORS_ORIGINS` — every dashboard origin, comma-separated, absolute `https`,
  no trailing slash. The mobile app needs no entry: native requests send no
  `Origin` header.
- `PLATFORM_BOOTSTRAP_*` — used only by `npm run seed`. Unset them after the
  first platform admin exists.

### After the first deploy

```bash
npm run seed           # platform owner only; refuses the demo tenant when NODE_ENV=production
npm run sync-indexes
```

### Known limit

The rate-limit store is in-memory, so limits are **per instance**. That is
correct for one node and wrong behind a load balancer — move to the Redis store
before scaling out horizontally (`backend/src/plugins/security.ts`).

---

## 3. Dashboard — Vercel

### Project settings

This is a monorepo, so the project must be scoped to the subdirectory:

| Setting | Value |
| --- | --- |
| Root Directory | `dashboard` |
| Framework Preset | Vite |
| Build Command | `pnpm build` (from `vercel.json`) |
| Output Directory | `dist` (from `vercel.json`) |

`dashboard/vercel.json` covers the rest: the SPA fallback so deep links like
`/organizations/abc` reach `index.html` instead of 404ing, immutable caching for
content-hashed assets, and security headers (HSTS, `X-Frame-Options: DENY`,
`nosniff`, referrer and permissions policy).

### Environment variables

Set `VITE_API_ORIGIN` **per Vercel environment**:

| Vercel environment | Value |
| --- | --- |
| Production | `https://api.example.com` |
| Preview | `https://api.staging.example.com` |

`VITE_*` values are inlined into the bundle at build time, so changing one
requires a **redeploy**, not just a restart. There is nothing secret here — the
bundle is public.

### Reproducing the Vercel build locally

`pnpm build` proves the code compiles, but it uses *your* shell's environment
and ignores `vercel.json`. To exercise what Vercel will actually run — the same
env values, the same build command, the same output layout — build with the
Vercel CLI instead:

```bash
cd dashboard
npx vercel login                          # once, interactive
npx vercel link                           # once — pick the dashboard project

npx vercel pull --environment=production  # fetch that env's real variables
npx vercel build --prod                   # build exactly as Vercel would
```

`vercel pull` writes the environment into `.vercel/.env.production.local`, and
`vercel build` emits `.vercel/output/`. Both are gitignored. Swap
`--environment=preview` and drop `--prod` to rehearse a preview deploy against
the staging API.

This is the step that catches a missing `VITE_API_ORIGIN` *before* it reaches
production, because it builds with the variables the environment really has
rather than the ones you happen to have exported.

To ship the artifact you just verified, rather than rebuilding on their
machine:

```bash
npx vercel deploy --prebuilt --prod
```

### Why there is no `/api` rewrite

A `vercel.json` rewrite proxying `/api` to the backend would keep the dashboard
same-origin and avoid CORS. It was not used because rewrites are **static**:
one destination for every environment, so Preview could not point at the
staging API. Per-environment variables are the only mechanism that separates
them, so the dashboard calls the API cross-origin.

That is safe here because the control plane authenticates with **bearer tokens
in `localStorage`**, not cookies — there is no `SameSite` or third-party-cookie
exposure. If auth ever moves to cookies, this decision has to be revisited.

The cost is that the backend's `CORS_ORIGINS` must name each dashboard domain.
Vercel generates a unique URL per deployment; add a **stable** preview alias
(for example `dashboard-staging.example.com`) and list that, rather than trying
to track per-commit URLs.

---

## 4. Mobile — EAS Build and EAS Update

`mobile/eas.json` defines three profiles, each bound to the EAS environment of
the same name and to an update channel:

| Profile | Artifact | Distribution | Channel | EAS environment |
| --- | --- | --- | --- | --- |
| `development` | apk, dev client | internal | `development` | development |
| `preview` | apk | internal | `preview` | preview |
| `production` | **aab** | store | `production` | production |
| `production-apk` | **apk** | internal | `production` | production |

`production-apk` exists because Google Play requires an **app bundle** for new
apps and will reject an APK, while an APK is the only thing you can hand
someone to install directly. It `extends` `production`, so it is a real
production build in every other respect — same production API, same
`production` update channel, same signing key — and differs only in the
artifact it emits and in being distributed by EAS link rather than prepared for
the store. Use it for client demos, device QA of the production configuration,
and anywhere Play is not the delivery route.

`autoIncrement` is inherited rather than switched off, so each APK gets a higher
`versionCode` than the last and installs over the previous one. That shares one
counter with the store profile, which only leaves gaps in the sequence — Play
requires each upload to be higher than the last, not consecutive.

One caveat when both routes are live: Play App Signing re-signs the uploaded
bundle, so a Play install and a sideloaded `production-apk` are signed
differently and Android will not upgrade one into the other. Testers switching
between them have to uninstall first.

`appVersionSource: "remote"` means EAS owns the build number and the
`production` profile auto-increments it. Do not bump it by hand in `app.json`.

### One-time environment setup

`EXPO_PUBLIC_*` values are inlined at build time and are public, so they are
plaintext, not secrets:

```bash
cd mobile

eas env:create --environment production \
  --name EXPO_PUBLIC_API_URL --value https://api.example.com/api/v1 --visibility plaintext

eas env:create --environment preview \
  --name EXPO_PUBLIC_API_URL --value https://api.staging.example.com/api/v1 --visibility plaintext
```

Verify what a profile will actually build with:

```bash
eas env:list --environment production
eas config --platform android --profile production
```

`EXPO_PUBLIC_ENVIRONMENT` is set by the profile itself in `eas.json` and needs
no EAS variable.

### Build and submit

```bash
eas build --profile preview    --platform all         # internal QA

eas build --profile production --platform all         # store: aab + ipa
eas submit --profile production --platform all

eas build --profile production-apk --platform android # installable .apk
```

`production-apk` is Android-only by design. Passing `--platform all` to it
still produces an iOS build, but `buildType` does not apply there and iOS
cannot be sideloaded this way, so name the platform explicitly.

### Updates: OTA or a new build?

`expo-updates` is configured and points at
`https://u.expo.dev/<projectId>` with `runtimeVersion` pinned to `1.0.0`.

- **JavaScript, styles and bundled assets** → ship over the air.
- **Native code or native config** — a new native dependency, an SDK upgrade,
  anything in `app.json` that affects the build — → **new build**. An update
  cannot add native capability to an installed binary.

```bash
eas update --channel preview    --message "..." --environment preview
eas update --channel production --message "..." --environment production
```

`runtimeVersion` is the compatibility boundary: an update only reaches builds
with a matching runtime version. Changing it is a deliberate decision that cuts
off existing installs from future updates — not an incidental edit.

Release builds apply updates on restart, so QA should expect **up to two cold
launches**: one to download, the next to run it.

---

## 5. First-deploy checklist

1. Provision MongoDB **as a replica set**; note the connection string.
2. Deploy the backend; set every variable in `backend/.env.example`, with
   `NODE_ENV=production`. Leave `CORS_ORIGINS` for step 5.
3. Point DNS at it (`api.example.com`) and confirm
   `GET /api/v1/health/ready` returns 200.
4. `npm run seed`, then unset `PLATFORM_BOOTSTRAP_*`.
5. Create the Vercel project with Root Directory `dashboard`; set
   `VITE_API_ORIGIN` for Production and Preview; deploy; then add the resulting
   domains to the backend's `CORS_ORIGINS` and restart the API.
6. Sign in to the dashboard as the platform owner. A failure here is almost
   always step 5 — check the browser console for a CORS rejection.
7. `eas env:create` for each environment, then
   `eas build --profile preview` and install it on a real device.
8. Promote to `--profile production` and submit.

## 6. Rotating a JWT secret

Changing `JWT_SECRET` or `PLATFORM_JWT_SECRET` invalidates every issued token
in that realm: mobile users are signed out and must log in again, and dashboard
sessions are dropped at the next refresh. The two realms rotate independently —
rotating the platform secret does not touch tenant sessions. Rotate during a
quiet window and expect a login spike.

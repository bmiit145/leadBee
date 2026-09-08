# LeadBee

A multi-tenant SaaS lead-management platform. Three surfaces, one API.

| Surface | Stack | Audience |
| --- | --- | --- |
| `backend/` | Fastify 5 · Mongoose 8 · TypeScript | everyone |
| `dashboard/` | Vite · React 19 · MUI · Tailwind 4 | **superadmin only** — the control plane |
| `mobile/` | Expo · React Native | tenant users — the lead workspace |

## Quick start

Requires Node 20+ and a MongoDB **replica set** (a single-node one is fine —
transactions need an oplog, and organization provisioning uses one).

```bash
# 1. MongoDB, as a single-node replica set
mongod --dbpath <dir> --replSet rs0 --bind_ip 127.0.0.1

# 2. API
cd backend
cp .env.example .env          # then set real secrets
npm install
npm run init-rs               # one-time: initiates rs0
npm run seed                  # platform owner + a demo tenant
npm run dev                   # http://localhost:4000/docs

# 3. Control plane
cd ../dashboard
npm install
npm run dev                   # http://localhost:5173

# 4. Mobile
cd ../mobile
npm install
npx expo start
```

### Seeded credentials (development only)

| Who | Sign in with |
| --- | --- |
| Platform owner | `owner@leadbee.io` / `ChangeMe!2024` → the dashboard |
| Tenant owner | phone `9000000001` / `Password@123` → the app |
| Tenant manager | phone `9000000002` / `Password@123` |
| Tenant agent | phone `9000000003` / `Password@123` |

The seed refuses to create the demo tenant when `NODE_ENV=production`.

## Verifying it works

```bash
cd backend
npm run routes    # builds the app, prints all 75 routes — no database needed
npm run smoke     # 52 assertions end-to-end against a live database
```

`npm run smoke` is the one that matters. It drives real requests through the
full Fastify lifecycle and asserts, among other things, that a tenant holding a
valid token and the exact id of another tenant's lead cannot read, update or
delete it.

## How tenancy works

Shared collections, `organizationId` on every tenant-owned document, isolation
enforced in the data layer rather than in each service:

1. `organizationId` is **never** read from client input — only from the verified JWT.
2. An `AsyncLocalStorage` scope carries it for the whole request.
3. A global Mongoose plugin injects it into every query, update and aggregation.
4. A tenant model queried with no scope **throws** rather than returning rows.

Cross-tenant reads exist (the control plane needs them) and must say so:

```ts
await withoutTenantScope('platform metrics', () => Organization.find());
```

`grep -r withoutTenantScope backend/src` is the audit surface. It should stay short.

Full detail, including the path to sharding and per-tenant databases, is in
[docs/MULTI-TENANCY.md](./docs/MULTI-TENANCY.md). Architecture is in
[docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md).

## Two authentication realms

Deliberately separate — different secrets **and** different token audiences, so
a tenant token cannot address the control plane even if one check is wrong.

| Realm | Login | Reaches |
| --- | --- | --- |
| Tenant | phone + password | `/api/v1/*` |
| Platform | email + password + optional TOTP | `/api/v1/platform/*` |

`PlatformAdmin` is its own collection. There is no "superadmin row inside a
tenant" — that pattern is how cross-tenant leaks happen.

## Onboarding

Both paths call one `provision()`, so tenants cannot drift into different shapes:

- **Self-serve** — `POST /api/v1/signup` creates a trialing org and signs the
  owner straight in. Gated by `ALLOW_SELF_SERVE_SIGNUP`.
- **Platform-provisioned** — the console's "Provision tenant" flow, for
  sales-led accounts, which start `active` rather than trialing.

## What LeadBee deliberately does not have

The product this was ported from was a property-management system with a lead
module inside it. LeadBee is the lead module, standing alone. Dropped entirely:
properties, projects-as-inventory, sured prices, areas, property visits and
property notes.

Three consequences worth knowing:

- **`Visit` and `Note` are gone.** Both were property-scoped in the original
  (`propertyId`, `suredPrice`, `propertyStatusUpdate`); neither was ever a lead
  feature. Lead notes live in `LeadThreadItem` on the `notes` channel.
- **`Project` survives, re-scoped.** The lead list filters by it, so removing it
  would have changed the UI. It is now a generic grouping — campaign, branch,
  product line — with no inventory attached.
- **Firebase Remote Config and Play in-app updates are gone.** They depended on
  the other product's Firebase project, and an API URL that can be repointed
  remotely is a redirection risk. `expo-updates` OTA is retained.

Retained, behaviour for behaviour: leads, the eleven stages and their transition
rules, call logs, the three lead threads (timeline / notes / query), documents
and attachments, tasks, meetings with slot availability and auto-raised tasks,
purposes, quick replies, reminders and bookmarks.

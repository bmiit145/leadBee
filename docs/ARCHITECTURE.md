# LeadBee — Architecture

A multi-tenant SaaS lead-management platform. Three deliverables share one API:

| Surface | Stack | Audience |
| --- | --- | --- |
| `backend/` | Fastify 5 + Mongoose 8 + TypeScript | everyone |
| `dashboard/` | Vite + React 19 + MUI + Tailwind | **superadmin only** — the control plane |
| `mobile/` | Expo + React Native | tenant users — the lead workspace |

## 1. Tenancy model

Shared collections, `organizationId` on every tenant-owned document, isolation
enforced in the data layer rather than in each service.

```
Organization (tenant)
   └── User            (organizationId)
         └── Lead      (organizationId)
               ├── CallLog, LeadThreadItem, LeadDocument
               ├── Meeting → Task
               └── Note, Visit
```

The scaling ladder, in the order it actually gets climbed:

1. **Shared collections + `organizationId`** — where we are. One replica set
   carries every tenant. Correct to ~10k orgs on commodity hardware.
2. **Tenant-aware authorization** — `organizationId` is never accepted from a
   client. It is derived from the JWT, pushed into an `AsyncLocalStorage`
   context, and injected by a global Mongoose plugin into *every* query. See
   [MULTI-TENANCY.md](./MULTI-TENANCY.md).
3. **Sharding on `organizationId`** — every index is already compound and leads
   with `organizationId`, so `sh.shardCollection` on a hashed `organizationId`
   is a config change, not a migration. Queries stay single-shard because they
   always carry the shard key.
4. **Dedicated isolation for exceptional tenants** — `Organization.tier` is
   `shared | dedicated`. A dedicated tenant resolves to its own Mongoose
   connection through the connection router; application code is unchanged.

Steps 3 and 4 are *designed for* today, not implemented today. The work to
enable them is config plus an ops runbook, which is the point.

## 2. Request lifecycle

```
request
  → security plugins (helmet, cors, compression, rate limit)
  → auth plugin       verifies JWT, loads user, merges permissions
  → tenant plugin     resolves organizationId, checks org is active,
                      opens an AsyncLocalStorage scope
  → route handler     (JSON-schema validated in/out)
  → service           plain functions; never see organizationId
  → Mongoose          tenant plugin injects organizationId into the filter
```

A service that forgets to scope a query is still safe: the Mongoose plugin adds
the filter, and a query that somehow escapes the tenant context throws rather
than returning cross-tenant rows. **Fail closed, not open.**

## 3. Two authentication realms

They are deliberately separate, with different secrets and different token
audiences, so a tenant token can never address the control plane.

| Realm | Login | Token audience | Reaches |
| --- | --- | --- | --- |
| Tenant | phone + password | `leadbee:tenant` | `/api/v1/*` |
| Platform | email + password + TOTP | `leadbee:platform` | `/api/v1/platform/*` |

`PlatformAdmin` is its own collection. There is no "superadmin user row inside a
tenant" — that pattern is how cross-tenant leaks happen.

## 4. Backend layout

```
backend/src/
  config/      env (zod-validated), constants, database
  lib/         tenant context, errors, logger, pagination, counters
  models/      Mongoose schemas — all tenant models carry organizationId
  plugins/     Fastify plugins: mongoose, auth, tenant, rbac, errors, ...
  modules/     vertical slices; each = routes + schemas + service
  scripts/     seed, index sync, migrations
```

Each module owns `*.routes.ts` (Fastify route definitions + JSON schema),
`*.schema.ts` (TypeBox/zod shapes), and `*.service.ts` (business logic, no
Fastify types). Controllers are folded into routes — Fastify's handler *is* the
controller, and a separate layer buys nothing here.

## 5. What LeadBee deliberately drops from its predecessor

Property, Project, SuredPrice, Area, and every screen and endpoint that served
them. LeadBee is a lead CRM; the property vertical is out of scope.

Retained, verbatim in behaviour: leads, lead stages and transitions, call logs,
lead threads (timeline / notes / query), lead documents, tasks, meetings,
purposes, quick replies, notes, visits, reminders, bookmarks.

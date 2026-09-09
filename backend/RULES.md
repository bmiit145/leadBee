# Backend Rules — `backend/`

Fastify 5 · Mongoose 8 · TypeScript. Rules specific to this surface.

Read first: [Architecture Rules](../docs/standards/ARCHITECTURE-RULES.md) ·
[Engineering Standards](../docs/standards/ENGINEERING-STANDARDS.md) ·
[Configuration and Plans](../docs/standards/CONFIGURATION-AND-PLANS.md)

Rule ID prefix: `BE`.

---

## Module layout

### BE-1 — A module is three files · MUST · Enforced

```
modules/<domain>/
  <domain>.routes.ts    HTTP: schema, guards, status codes
  <domain>.schema.ts    zod shapes, in and out
  <domain>.service.ts   business logic — no Fastify types
```

No `controller.ts`. Fastify's handler is the controller; a fourth layer buys
nothing here.

### BE-2 — Services receive a `Viewer`, never a request · MUST · Enforced

```ts
// wrong — drags HTTP into the domain
async function listLeads(request: FastifyRequest) { … }

// right
async function listLeads(filters: LeadFilters, viewer: Viewer) { … }
```

A service importing from `fastify` is a blocker.

### BE-3 — Services never mention `organizationId` · MUST · Enforced

The Mongoose plugin injects it. A service that filters by it manually is
either redundant or defeating the mechanism that makes isolation reliable.

---

## Models

### BE-4 — Tenant-owned models apply `tenantPlugin` · MUST · Enforced

A new collection holding tenant data applies the plugin. That single line adds
the field, stamps it on write, filters every read, and strips it from output.

Anything not tenant-owned — `Organization`, `PlatformAdmin`,
`PlatformAuditLog` — must say so in a comment explaining why.

### BE-5 — Stamp required fields in `pre('validate')`, not `pre('save')` · MUST · Enforced

Mongoose runs validation **before** user `save` hooks. A required field filled
in on save fails validation first, so every create errors with "Path
`organizationId` is required".

### BE-6 — `.lean()` reads must still be serialised · MUST · Target

`.lean()` returns plain objects and bypasses `toJSON`, so `organizationId` and
`__v` leak into responses. ~22 call sites do this today, including
`GET /api/v1/leads`.

New lean reads pass results through the shared serialiser before returning.
Do not solve it by dropping `.lean()` — it is there for good reason on hot
list paths.

### BE-7 — `insertMany` hooks are callback-style · MUST · Enforced

Mongoose still drives this one with `next` first. Returning early without
calling it hangs every bulk insert — silently, with no error, forever. Always
call `next()`, including in the error path.

### BE-8 — Never `estimatedDocumentCount` on a tenant collection · MUST · Enforced

It ignores filters and counts every tenant. Use `countDocuments`; models expose
`assertFilterableCount()` so the mistake throws rather than under-reporting.

### BE-9 — Compound indexes lead with `organizationId` · MUST · Enforced

See [ARCH-5](../docs/standards/ARCHITECTURE-RULES.md#arch-5--tenant-owned-indexes-lead-with-organizationid--must--enforced).
Adding an index that does not is a blocker unless the model is one of the
documented exemptions.

---

## Routes

### BE-10 — Every route declares a zod schema · MUST · Enforced

Request *and* response. The schema is the validation, the serialiser and the
OpenAPI entry. A route without one is undocumented and unvalidated at once.

### BE-11 — Every route declares its guard explicitly · MUST · Enforced

`authenticateTenant` or `authenticatePlatform`, plus `requirePermission(...)`
or `requireOrganizer`. Never rely on a parent scope having added one —
inherited auth is invisible at the call site and breaks on refactor.

Genuinely public routes (`/health`, `/auth/login`, `/signup`) carry a comment
saying so.

### BE-12 — Throw `AppError`, never craft error responses inline · MUST · Enforced

The error plugin owns the envelope, the status mapping and the `requestId`.
Hand-built error bodies drift from the contract.

---

## Configuration

### BE-13 — `process.env` is read in exactly one place · MUST · Enforced

Only [`config/env.ts`](./src/config/env.ts). Everything else imports `env`.

**Why.** A `process.env.FOO` deep in a service is invisible to the boot-time
validation and fails in production instead of at startup.

### BE-14 — Boot fails loudly on invalid configuration · MUST · Enforced

The process exits rather than starting with a placeholder secret. A server that
boots wrong and only reveals it under load is worse than one that never boots.

### BE-15 — New settings default to Tier 1, not the environment · MUST · Target

Before adding to `env.ts`, apply the
[tier test](../docs/standards/CONFIGURATION-AND-PLANS.md#1-the-configuration-tiers).
If a non-engineer would ever change it, it is a platform setting or plan
attribute — not an environment variable.

---

## Transactions and counters

### BE-16 — Multi-document invariants use a session · MUST · Enforced

Organization provisioning creates an org, an owner and roles together. Partial
success produces a tenant nobody can log into. This is why deployment requires
a replica set.

### BE-17 — Human-facing sequence numbers come from the counter · MUST · Enforced

`L-0040`, meeting numbers and similar are allocated through `lib/counters.ts`,
per tenant. Never `count() + 1` — it races, and it reuses numbers after a
delete.

---

## Scripts

### BE-18 — Destructive scripts refuse to run in production · MUST · Enforced

The seed refuses to create the demo tenant when `NODE_ENV=production`. Any new
script that writes or deletes carries the same guard.

### BE-19 — Scripts open their own scope · MUST · Enforced

Outside a request there is no tenant context, so a script must wrap its work in
`runInTenantScope()` or `withoutTenantScope('reason', …)`. Both await inside the
scope, because a Mongoose query is lazy and would otherwise execute after the
scope closed.

# Architecture Rules

System invariants. Breaking one of these is not a style disagreement — it is
how multi-tenant SaaS products leak one customer's data to another.

Rule ID prefix: `ARCH`. Severity and status labels: see [README](./README.md).

---

## 1. Tenant isolation

### ARCH-1 — `organizationId` is never accepted from client input · MUST · Enforced

It is read from the verified JWT and nowhere else. Not from a body, a query
string, a path parameter, or a header.

**Why.** Any input-derived tenant key is a horizontal privilege escalation
waiting for someone to change a number in a request.

**Verify.** A request schema that names `organizationId` is a review blocker.

### ARCH-2 — Isolation lives in the data layer, not in services · MUST · Enforced

The tenant predicate is injected by the global Mongoose plugin
([`lib/tenantPlugin.ts`](../../backend/src/lib/tenantPlugin.ts)). Services do
not filter by tenant, because a service that *can* forget will eventually
forget.

**Corollary.** A service function that mentions `organizationId` in a query
filter is either wrong or is doing something that needs `ARCH-4`.

### ARCH-3 — Absent tenant scope fails closed · MUST · Enforced

A tenant-owned model queried with no scope on the async context **throws**.

**Why.** The alternatives are returning every tenant's rows (a breach) or
silently returning none (a phantom bug that surfaces in production). A stack
trace is strictly better than both.

Never "fix" this throw by widening the query. Fix the missing scope.

### ARCH-4 — Cross-tenant access is explicit, justified and greppable · MUST · Enforced

The only way out of tenant scope is:

```ts
await withoutTenantScope('platform metrics', () => Organization.find());
```

The reason string is mandatory and appears in logs. `grep -r withoutTenantScope
backend/src` is the audit surface and is expected to stay short.

**Review rule.** Every *new* call site must be justified in the PR description.
A reviewer who cannot explain why a call is cross-tenant should block it.

### ARCH-5 — Tenant-owned indexes lead with `organizationId` · MUST · Enforced

Every compound index on a tenant-owned collection starts with
`organizationId`.

**Why.** It keeps queries single-shard and makes
`sh.shardCollection` on a hashed `organizationId` a configuration change rather
than a migration. Losing this property silently forecloses the scaling path.

**Exempt.** `Organization` (it *is* the tenant), `PlatformAdmin`,
`PlatformAuditLog`, and TTL indexes, which must be declared on the date field
alone.

### ARCH-6 — The tenant key is not echoed to clients · MUST · Target

`organizationId` and `__v` are stripped by the shared `toJSON` transform.

**Known violation.** `.lean()` returns plain objects and bypasses `toJSON`
entirely, so ~22 call sites currently leak `organizationId` in list responses
(`/api/v1/leads` among them). This is a contract break, not a breach — the
query is still tenant-scoped, so a caller only ever sees their own id.

New `.lean()` reads must run results through the shared serialiser. See
[BE-6](../../backend/RULES.md#be-6--lean-reads-must-still-be-serialised--must--target).

---

## 2. Authentication realms

### ARCH-7 — Tenant and platform are separate realms · MUST · Enforced

They differ in **secret** *and* in **audience** (`leadbee:tenant` vs
`leadbee:platform`).

**Why.** Either mechanism alone would stop a tenant token addressing the
control plane. Both together mean a single mistake — a leaked secret, or one
verification call with the wrong parameters — is not sufficient to cross the
boundary.

### ARCH-8 — There is no superadmin row inside a tenant · MUST · Enforced

`PlatformAdmin` is its own collection. Platform privilege is never modelled as
a role on a tenant `User`.

**Why.** "Superadmin as a tenant role" is the single most common origin of
cross-tenant data leaks in multi-tenant products: every tenant-scoped query
then needs a special case, and one missing special case is a breach.

### ARCH-9 — Authorisation is recomputed, never trusted from the token · MUST · Enforced

Permissions are resolved from the database on each request rather than read
from the JWT claim.

**Why.** It buys immediate revocation instead of "revoked, but still works
until the access token expires". The cost is one indexed read.

If this ever shows up in a profile, cache it per `(userId, roleId)` with a
short TTL. Do **not** go back to trusting the token.

---

## 3. Layering

### ARCH-10 — Request flow is one-directional · MUST · Enforced

```
route (HTTP + schema)  →  service (business logic)  →  model (persistence)
```

- Routes own HTTP: status codes, validation, serialisation. Fastify's handler
  *is* the controller; there is no separate controller layer.
- Services are plain functions. They **must not** import Fastify types, touch
  `request`/`reply`, or know about HTTP.
- Models own persistence and schema-level invariants.

A service that needs the caller's identity receives a `Viewer`, not a request.

### ARCH-11 — Modules are vertical slices · SHOULD · Enforced

A module owns `*.routes.ts`, `*.schema.ts` and `*.service.ts`. Cross-module
reuse goes through `lib/` or an explicitly exported service function — never by
reaching into another module's internals.

### ARCH-12 — Schemas are the single source of truth · MUST · Enforced

zod schemas drive request validation, response serialisation **and** the
OpenAPI document. Hand-written API docs are prohibited: they drift, and a
drifted contract is worse than none.

---

## 4. Shared vocabulary

### ARCH-13 — Domain vocabulary has exactly one source of truth · MUST · Enforced

A domain enum, union or limit table is defined once and consumed everywhere.

`Plan` was previously declared in six places — backend constants, a Mongoose
`enum`, two dashboard tables, a hardcoded dialog default, and the mobile union —
so adding one plan meant editing six files and shipping three deployments. All
six are now fed from the catalogue; see
[ADR-0001](../adr/0001-entitlement-system.md).

**Review rule.** A `Record<SomeKey, …>` or string union describing something
commercial is a blocker. Ask [ARCH-14](#arch-14--catalogue-data-is-data-not-a-type--must--enforced)'s question.

### ARCH-14 — Catalogue data is data, not a type · MUST · Enforced

Anything an operator should be able to change without a deploy — plans, limits,
trial lengths, feature flags — is a **database row**, never a TypeScript union
or a Mongoose `enum`.

Compile-time unions are correct for things only a developer may change: lead
stages, roles, permission keys, token audiences. They are wrong for commercial
policy.

**Test.** *"Would a non-engineer ever need to change this?"* If yes, it is
data.

### ARCH-17 — Business logic checks capabilities, never plan names · MUST · Enforced

```ts
if (!hasFeature(organization, 'crm.exports')) …          // right
assertWithinLimit(org, 'identity.users.max', n, 'users'); // right

if (organization.plan === 'growth') …                     // blocker
```

`organization.plan` is commercial metadata for invoices and admin screens.
Branching on it re-creates the coupling [ADR-0001](../adr/0001-entitlement-system.md)
removed, and it silently denies every plan an operator adds later.

**Verify.** A comparison against a plan-key literal outside the catalogue
service is a review blocker.

### ARCH-18 — A new module must not change the plan system · MUST · Enforced

Shipping a module means adding its manifest and its own code. The resolver, the
plan model, the entitlement API and the plan builder stay untouched, and its
features appear as checkboxes automatically.

This is an **acceptance criterion**, not an aspiration:
`entitlements.test.ts` registers a module that does not exist in the product and
asserts it resolves through the same untouched resolver.

---

## 5. Failure and observability

### ARCH-15 — Fail closed on authorisation, fail open on annotation · MUST · Enforced

A check that cannot complete denies access. A *non-essential* side effect —
attaching a log binding, incrementing a usage counter — must never fail the
request it decorates.

### ARCH-16 — Every response carries a correlation id · MUST · Enforced

`requestId` is on every response, and `orgId`/`userId` are bound to every log
line for the request.

**Why.** "Show me everything that happened for customer X" is then one query,
and a customer's error report resolves to an exact log line.

---

## ADR process

Changing anything above requires an Architecture Decision Record in
`docs/adr/NNNN-short-title.md`:

```markdown
# ADR-0007: <decision>

## Status
Proposed | Accepted | Superseded by ADR-NNNN

## Context
What forces are in play. What breaks if we do nothing.

## Decision
What we are doing, stated so someone can act on it.

## Consequences
What this costs, what it forecloses, and what must now be true.

## Alternatives considered
What was rejected, and why — the part future readers actually need.
```

An ADR is required to add, remove or weaken any **MUST** rule; to change the
tenancy or auth model; or to add a datastore, queue or external dependency.

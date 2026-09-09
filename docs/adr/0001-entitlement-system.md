# ADR-0001: Capability-based entitlement system

## Status

Accepted — supersedes the static `PLANS` / `PLAN_LIMITS` constants.

## Context

### What exists today

Plans are compiled in. `PLANS` and `PLAN_LIMITS` live in
[`config/constants.ts`](../../backend/src/config/constants.ts) and are read from
four places:

| Coupling point | What it does |
| --- | --- |
| `models/Organization.ts` | Mongoose `enum: Object.values(PLANS)` on `plan` — **hard blocker**: a plan created at runtime cannot be saved |
| `organization.service.ts` | `changePlan()` and `organizationFields()` read `PLAN_LIMITS[plan]` |
| `platform.routes.ts` | `planEnum = z.enum(Object.values(PLANS))` on three endpoints |
| `env.TRIAL_DAYS` | one global trial length for every tenant |

Plus the dashboard (`Plan` union, `PLAN_RANK`, `PLAN_LABELS`, hardcoded
`<option>`s) and the mobile `Plan` union.

### The finding that shapes this design

**`features` is stored, returned to clients, and never checked.** There is no
`hasFeature` anywhere in the backend. Grep confirms zero reads of
`organization.features` in business logic.

Only two limits are enforced — `assertCanAddUser` and `assertCanAddLead`, both
reading the denormalised `organization.limits`. `maxMonthlyApiCalls` is stored
and never enforced.

This matters: **capability checking is greenfield, not a migration.** There is
no existing `if (plan === 'pro')` to untangle, so the entitlement API can be
introduced cleanly and adopted incrementally.

## Decision

```
FeatureDefinition (module + feature registry — data, seeded from code manifests)
      ▲ references
Plan (versioned)  +  AddOn        →  grants
      ▲
Organization.subscription (planKey + pinned planVersion + addOns + overrides)
      ▼ resolved once, on change
Organization.entitlements (snapshot)  ←  what requests actually read
```

Business logic asks `hasFeature('crm.leads.export')` / `getLimit('crm.leads.max')`
and never sees a plan name.

## Deviations from the proposed architecture

Three, each to make the design smaller without losing a requirement.

### 1. No `Product` layer

The proposal was `Product → Module → Feature`. LeadBee is one product; a
`Product` table would today hold exactly one row that nothing branches on.

`Module` carries an optional `productKey` field, unused and reserved. Introducing
products later is then a data backfill, not a redesign — which is what the
acceptance criterion actually demands.

**Revisit when** a second sellable product exists, with its own SKU and billing.

### 2. Subscription is embedded on `Organization`, not its own collection

The proposal implied `Organization → Subscription → Plan Version`.

Embedded instead, because:

- **The hot path is auth.** `authenticateTenant` already loads the organization
  on every request. A separate subscription document adds a second read to the
  most-executed query in the product, for data that is 1:1 with the tenant.
- **Provisioning is transactional.** Fewer documents in the transaction is
  strictly better.
- **The codebase already denormalises deliberately** — `limits`/`features` are
  copied onto the org "so a limit check is a field read rather than a lookup".
  This design continues that instinct rather than fighting it.
- **History already exists.** `PlatformAuditLog` records before/after on every
  plan change, which is what "what plan were they on in March?" needs.

**Revisit when** billing lands. Invoices, proration and multiple concurrent
subscriptions per tenant need their own collection — but that is a billing
concern, not an entitlement one, and can reference the same catalogue.

### 3. Feature definitions are data, registered from code manifests at boot

Requirement 19 asks for data-driven; safety asks for validation. Pure-data
feature creation means `hasFeature('crm.led.export')` — a typo — silently
returns `false` forever, denying a paying customer with no error.

So: each module ships a **manifest** declaring its features; boot upserts them
into `FeatureDefinition` idempotently. The Admin UI reads the collection, so a
new module's checkboxes appear automatically.

This is what makes the worked example true — adding a Call Log module is a
manifest file plus its own code. **Nothing in the plan system changes**, and the
module appears in the plan builder as checkboxes.

Admin-created ad-hoc features remain possible for pure config keys nothing
branches on.

## Resolution model

Deterministic, later overriding earlier:

```
Plan(planKey @ planVersion).grants
  → AddOn grants           (union for features; max for limits)
    → Organization.overrides  (absolute — sales-negotiated, wins outright)
      = effective entitlements → snapshotted onto Organization
```

Resolved **on change only** — plan change, add-on change, override edit,
explicit re-sync. Never per request.

### Fail-closed (requirement 15)

Because entitlements are snapshotted on the organization document that auth
already loads, **the catalogue is not on the request path at all**. If the
catalogue is unavailable, running tenants are unaffected.

If the snapshot itself is missing or unreadable, `hasFeature` returns `false`
and `getLimit` returns `0`. The resolver distinguishes *explicitly unlimited*
(`-1`) from *unknown* (`null`), and unknown never means unlimited.

### Versioning (requirement 11)

`Plan` documents are immutable once referenced. Editing a live plan publishes
`version + 1`; subscriptions pin `planVersion` and stay on theirs until migrated
explicitly. A tenant's terms therefore cannot change because someone edited a
form.

## Backward compatibility (requirement 12)

`Organization.plan`, `.limits` and `.features` are **retained as mirrors**,
written by the resolver on every re-resolve. The Mongoose `enum` is dropped and
replaced with catalogue validation.

Existing readers — `assertCanAddUser`, `assertCanAddLead`, the auth response
schema, the dashboard, the mobile app — keep working unchanged. The seed
reproduces the current four plans and `TRIAL_DAYS` exactly, so no tenant sees a
behaviour change.

Mirrors are removed only once every reader has moved to the entitlement API.

## Consequences

**Gained.** New modules ship without touching plan code. Plans, limits and
trials become admin operations. Per-tenant overrides stop requiring bespoke
plans. Capability checks replace plan-name branching before any such branching
exists to remove.

**Costs.** Two extra collections and a boot-time registration step. A snapshot
that must be re-resolved on change — a missed re-resolve leaves a tenant on
stale terms, which is why re-resolution is centralised in one service function
rather than done at call sites.

**Foreclosed.** Nothing meaningful. Product layer and standalone subscriptions
both remain reachable as additive data migrations.

## Alternatives considered

**Keep `PLAN_LIMITS`, add a DB override table.** Rejected: two sources of truth
for the same question, and the enum blocker remains.

**Pure-data features, no code manifests.** Rejected: unvalidated keys fail
silently and deny paying customers.

**Resolve entitlements per request.** Rejected: puts the catalogue on the hot
path and makes a catalogue outage a product outage — the opposite of
requirement 15.

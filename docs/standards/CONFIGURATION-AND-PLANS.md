# Configuration and Plans

What may change without a deploy, what may never change at runtime, and how
plans, trials and entitlements are modelled.

Rule ID prefix: `CFG`. Severity and status labels: see [README](./README.md).

> **Why this document exists.** A new plan used to require editing six files and
> shipping three deployments, and every tenant got the same trial length because
> it was a single global `TRIAL_DAYS` environment variable. Commercial policy
> must not be compiled in.
>
> The plan half is now implemented — see
> [ADR-0001](../adr/0001-entitlement-system.md). The platform-settings half
> (Tier 1, below) is not.

---

## 1. The configuration tiers

Every setting belongs to exactly one tier. The tier decides where it lives, who
may change it, and how fast a change takes effect.

| Tier | Name | Lives in | Changed by | Takes effect |
| --- | --- | --- | --- | --- |
| **0** | Boot / secret | environment | deploy | process restart |
| **1** | Platform settings | `PlatformSetting` collection | superadmin | next request (cached, TTL ≤ 60s) |
| **2** | Plan catalogue | `Plan`, `AddOn`, `FeatureDefinition` | superadmin | on assignment |
| **3** | Tenant override | `Organization` | superadmin | immediately |

### CFG-1 — Every setting declares its tier · MUST · Target

A setting with no declared tier is a defect. Adding one to Tier 0 that belongs
in Tier 1 or 2 is what causes redeploys for business changes.

### CFG-2 — Tier 0 is the floor, never the answer · MUST · Target

Tier 0 holds only what the process needs *before it can reach the database*, or
what must never be runtime-editable. Everything else moves up.

### CFG-3 — Secrets and infrastructure are never dynamic · MUST · Enforced

No secret, connection string or credential is ever readable or writable through
an API, at any privilege level. There is no superadmin screen that displays
`JWT_SECRET`.

**Why.** A runtime-editable signing secret turns one compromised admin session
into full token forgery. A remotely repointable database URI is a data
redirection attack. This is the same reasoning that removed Firebase Remote
Config from the mobile client.

---

## 2. Classification of the current environment

The existing [`backend/src/config/env.ts`](../../backend/src/config/env.ts),
classified. This table is the migration plan.

### Tier 0 — stays in the environment

| Variable | Why it cannot move |
| --- | --- |
| `NODE_ENV`, `PORT`, `HOST` | Process identity; needed before anything boots |
| `MONGODB_URI` | Needed to reach the store that would hold the setting |
| `MONGODB_MAX_POOL_SIZE`, `MONGODB_MIN_POOL_SIZE` | Fixed at driver construction |
| `JWT_SECRET`, `JWT_REFRESH_SECRET` | Secret — `CFG-3` |
| `PLATFORM_JWT_SECRET`, `PLATFORM_JWT_REFRESH_SECRET` | Secret — `CFG-3` |
| `PLATFORM_BOOTSTRAP_EMAIL`, `_PASSWORD`, `_NAME` | First-admin bootstrap; ignored once one exists |

### Tier 1 — becomes superadmin-managed platform settings

| Variable | Becomes | Bounds |
| --- | --- | --- |
| `LOG_LEVEL` | `observability.logLevel` | enum |
| `MONGO_DEBUG` | `observability.mongoDebug` | boolean |
| `ALLOW_SELF_SERVE_SIGNUP` | `signup.selfServeEnabled` | boolean |
| `CORS_ORIGINS` | `security.corsOrigins` | absolute `https://` origins; no wildcard in production |
| `RATE_LIMIT_MAX` | `security.rateLimit.max` | 1 … 10 000 |
| `RATE_LIMIT_WINDOW` | `security.rateLimit.window` | duration string |
| `AUTH_RATE_LIMIT_MAX` | `security.authRateLimit.max` | 1 … 100 |
| `JWT_EXPIRES_IN` | `security.tenantAccessTtl` | 1m … 24h |
| `JWT_REFRESH_EXPIRES_IN` | `security.tenantRefreshTtl` | 1h … 90d |
| `PLATFORM_JWT_EXPIRES_IN` | `security.platformAccessTtl` | 1m … 8h |
| `PLATFORM_JWT_REFRESH_EXPIRES_IN` | `security.platformRefreshTtl` | 1h … 30d |

### Tier 2 — becomes plan catalogue

| Variable | Becomes |
| --- | --- |
| `TRIAL_DAYS` | `Plan.trialDays` — per plan, set by an admin |

`TRIAL_DAYS` is the clearest example of the mistake this document exists to
correct: trial length is a **commercial term**, not a deployment property. One
global value cannot express "14 days normally, 30 days for this campaign, 60
for this enterprise pilot".

### CFG-4 — Dynamic settings are bounded · MUST · Target

Every Tier 1 setting declares a validated range, enforced server-side on write.
A superadmin must not be able to set a token TTL to ten years, or a rate limit
to zero, by typo.

### CFG-5 — Security-relevant dynamic settings are audited and reversible · MUST · Target

Changes to anything under `security.*` record actor, before, after, reason and
IP in `PlatformAuditLog`, and must be revertible from that record alone.

---

## 3. The plan model

Modelled on how Stripe Billing, Chargebee and Paddle separate these concerns.
The distinction that matters: **capability**, **catalogue** and **grant** are
three different things, and collapsing them is what forces redeploys.

```
CatalogModule  →  FeatureDefinition        registry: what CAN be granted
                                           (upserted at boot from code manifests)
Plan (versioned)  +  AddOn                 catalogue: what we sell
      ▲
Organization.subscription                  grant: planKey + pinned planVersion
      │                                           + addOnKeys + overrides
      ▼ resolved on change
Organization.entitlements                  the snapshot every request reads
```

### `FeatureDefinition` — the capability registry

The checkboxes the plan builder renders. Rows are upserted at boot from
[`entitlements/manifest.ts`](../../backend/src/entitlements/manifest.ts), so a
module shipped in a release becomes sellable with no further work.

| Field | Notes |
| --- | --- |
| `key` | canonical, namespaced — `crm.leads`. Never reused |
| `moduleKey` | grouping in the builder |
| `kind` | `boolean` / `limit` / `config` |
| `legacyFeatureKey`, `legacyLimitKey` | mirror into the pre-existing fields |

### `Plan` — the catalogue

Versioned, and **immutable once any tenant references it**.

| Field | Notes |
| --- | --- |
| `key` + `version` | unique together; subscriptions pin the pair |
| `grants` | `{ featureKey, enabled, limit, config }`; `-1` = unlimited |
| `trialDays` | replaces the global `TRIAL_DAYS`; `0` = no trial |
| `sortOrder` | replaces the dashboard's hardcoded `PLAN_RANK` |
| `status` | `draft` / `active` / `grandfathered` / `retired` |

### `AddOn` and organization overrides

Two different tools, deliberately:

| | Shape | Use |
| --- | --- | --- |
| **AddOn** | additive — features union, limits take the higher value | a purchasable increment: extra seats, SSO |
| **Override** | absolute — replaces outright, in either direction | a negotiated enterprise deal, including one that is *smaller* |

A time-boxed promotional `Offer` (promo code, campaign window, redemption cap)
is a natural third layer and is **not implemented**. It slots between plan and
add-on in the resolver without changing anything else.

### CFG-6 — A plan in use is never edited in place · MUST · Enforced

Changing a live plan's limits must not silently re-price or re-limit existing
tenants. Publish a new `version`; existing tenants stay on theirs until
explicitly migrated.

**Why.** In-place edits mean one typo in an admin form instantly changes the
contractual terms of every customer on that plan, with no record of what they
had before.

### CFG-7 — Entitlements are resolved server-side and snapshotted · MUST · Enforced

Resolution order, later overriding earlier:

```
Plan(key @ pinned version).grants
  → AddOn grants          (additive: features union, limits take the higher)
    → Organization overrides  (absolute: replaces outright, either direction)
      = effective entitlements  → snapshotted onto Organization
```

The current schema already denormalises `limits` and `features` onto
`Organization` "so a limit check is a field read rather than a lookup". That
instinct is correct and becomes the rule: **resolve on change, snapshot,
never resolve per request.**

Re-resolution happens on plan change, add-on change, override edit, and
explicit re-sync — never implicitly.

### CFG-8 — The client never decides entitlement · MUST · Enforced

`features` may be sent to clients to *shape the UI* — hide a tab, grey a
button. Enforcement is always server-side. A client that stops sending a field
must not thereby gain a capability.

### CFG-9 — Entitlement resolution fails safe · MUST · Enforced

If the catalogue is unreachable, fall back to the tenant's last snapshotted
entitlements, and failing that to compiled conservative defaults.

**Never fall back to unlimited.** A degraded config store must not become a
free upgrade for every tenant.

### CFG-10 — Trials belong to the plan, not the environment · MUST · Enforced

Trial length resolves from `Plan.trialDays`. Trial
*state* (`trialEndsAt`, whether it converted) stays on the organization.

Extending one tenant's trial is a Tier 3 override with an audit entry — never
an environment change, and never a code change.

---

## 4. Removing the deploy blocker

### CFG-11 — `Organization.plan` must not be a Mongoose `enum` · MUST · Enforced

```ts
plan: { type: String, enum: Object.values(PLANS), default: PLANS.TRIAL }
```

That single line meant a plan created in the admin UI **could not be saved** —
Mongoose rejected it at validation. It was the hard blocker behind "I cannot
deploy again and again".

The enum is gone. `subscription.planKey` + `planVersion` reference the
catalogue, validated against the collection rather than a compiled list, and
`plan` survives only as a display mirror.

### Migration status

| Step | State |
| --- | --- |
| 1. `Plan`, `AddOn`, `CatalogModule`, `FeatureDefinition` collections | Done |
| 2. Drop the `enum` on `Organization.plan` | Done |
| 3. `TRIAL_DAYS` → `Plan.trialDays`, seeded with the current value | Done |
| 4. Catalogue CRUD on `/api/v1/platform/{catalog,plans,addons}` | Done |
| 5. Dashboard reads the catalogue; plan builder ships | Done |
| 6. `PlatformSetting` for the Tier 1 variables | **Not started** |

Step 6 is the remaining work: `LOG_LEVEL`, `CORS_ORIGINS`, the rate limits and
the token TTLs are still environment variables. The plan and trial half of this
document is implemented; the platform-settings half is not.

### CFG-12 — Every migration step is behaviour-preserving · MUST · Target

Each step above ships independently and changes nothing observable on its own.
Seed the new store from the current values, read from the new store, *then*
remove the old source. Never move and change semantics in one release.

### CFG-13 — Dynamic config is read once per request · MUST · Target

A request resolves settings once and uses that snapshot throughout. Config that
changes mid-request produces failures that cannot be reproduced.

### CFG-14 — Client caches are invalidated by version, not by TTL alone · SHOULD · Target

Publish a `catalogueVersion`; clients holding a stale version refetch. A plan
change that only propagates when a cache happens to expire is a support ticket.

---

## 5. Feature flags

### CFG-15 — Distinguish entitlement from rollout · MUST · Target

Two different things, often conflated:

| Kind | Question | Lives in | Changed by |
| --- | --- | --- | --- |
| **Entitlement** | *Has this tenant paid for it?* | Plan / AddOn | commercial |
| **Release flag** | *Is this code safe to expose yet?* | platform settings | engineering |

A release flag is temporary and must carry a removal date. An entitlement is
permanent product surface. Using one for the other means either shipping
unfinished code to paying customers, or billing for something behind a kill
switch.

---

## 6. What must never become dynamic

Stated explicitly, because "make it configurable" is a reflex worth resisting:

- Signing secrets and database credentials (`CFG-3`)
- Token **audiences** — the realm boundary ([ARCH-7](./ARCHITECTURE-RULES.md#arch-7--tenant-and-platform-are-separate-realms--must--enforced))
- Whether tenant scoping is applied ([ARCH-2](./ARCHITECTURE-RULES.md#arch-2--isolation-lives-in-the-data-layer-not-in-services--must--enforced))
- Permission keys and role semantics — code depends on their meaning
- Lead stages and transition rules — the mobile UI renders directly off them

A configuration switch that can disable a security control is not a feature; it
is the control's absence with extra steps.




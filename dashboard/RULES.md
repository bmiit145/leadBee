# Dashboard Rules — `dashboard/`

Vite · React 19 · MUI · Tailwind 4. **Superadmin control plane only.**

Read first: [Architecture Rules](../docs/standards/ARCHITECTURE-RULES.md) ·
[Engineering Standards](../docs/standards/ENGINEERING-STANDARDS.md) ·
[Configuration and Plans](../docs/standards/CONFIGURATION-AND-PLANS.md)

Rule ID prefix: `DASH`.

---

## What this app is

### DASH-1 — The dashboard is the platform realm, never the tenant realm · MUST · Enforced

It talks only to `/api/v1/platform/*` with a platform token. It must never
acquire, store or send a tenant token.

**Why.** The two realms are separated by design
([ARCH-7](../docs/standards/ARCHITECTURE-RULES.md#arch-7--tenant-and-platform-are-separate-realms--must--enforced)).
A client holding both is the one place that separation could be undone.

### DASH-2 — Cross-tenant data is displayed, never edited implicitly · MUST · Enforced

Every write that affects a tenant is an explicit, audited action with a
reason — status change, plan change, override. There is no bulk edit that
silently touches many tenants.

---

## Structure

### DASH-3 — Folders by role · MUST · Enforced

```
src/
  pages/       route-level screens, one per route
  components/  layout/ · ui/ · <domain>/
  services/    api client + one service per API area
  stores/      cross-cutting state (auth, theme)
  types/       shared types
```

A component that fetches for itself belongs in a page or a domain folder, not
in `ui/`. `ui/` is presentational and API-free.

### DASH-4 — All network access goes through `services/` · MUST · Enforced

Components never call `axios` directly. The shared instance owns auth headers,
refresh and error normalisation; bypassing it bypasses all three.

---

## Data and state

### DASH-5 — Server state is not application state · SHOULD

Fetched data belongs in a query layer or a service call, not copied into
`useState` and re-synced by hand. Copies drift.

### DASH-6 — Every async view renders three states · MUST

Loading, error and empty are designed states, not afterthoughts. An operator
staring at a blank panel cannot tell "no tenants" from "the request failed".

Error states surface the API's `error.message` and the `requestId` — that
string is what turns a support report into a log lookup.

### DASH-7 — Refresh stays single-flight · MUST · Enforced

The guard in [`services/api.ts`](./src/services/api.ts) exists because the API
treats a replayed refresh token as theft and revokes **every** session. A page
firing six queries on mount would otherwise log the operator out.

Do not add a second axios instance with its own refresh path.

---

## Plans and configuration

### DASH-8 — Plans are fetched, never hardcoded · MUST · Target

The dashboard currently hardcodes the catalogue in three places:

| File | What |
| --- | --- |
| [`types/index.ts`](./src/types/index.ts) | `Plan` union |
| [`components/ui/StatusChip.tsx`](./src/components/ui/StatusChip.tsx) | `PLAN_RANK`, `PLAN_LABELS` |
| [`components/orgs/CreateOrgDialog.tsx`](./src/components/orgs/CreateOrgDialog.tsx) | hardcoded default |

These become catalogue reads. A plan created in the admin UI must appear in
every selector without a frontend deploy — that is the entire point.

`PLAN_RANK` becomes a server-provided `sortOrder`; ranking plans in the client
means the client decides which plan is "higher", which is commercial policy.

### DASH-9 — Unknown catalogue values render, never crash · MUST · Target

`PLAN_LABELS[plan] ?? plan` is the right shape and must stay. Once the
catalogue is dynamic, the client will inevitably see a plan it has no label
for, and the correct behaviour is to show the raw key.

### DASH-10 — Settings screens show bounds and consequences · MUST · Target

A form editing a Tier 1 setting displays its permitted range
([CFG-4](../docs/standards/CONFIGURATION-AND-PLANS.md#cfg-4--dynamic-settings-are-bounded--must--target))
and states what a change affects. Security settings additionally require a
typed confirmation and a reason, which is recorded in the audit log.

### DASH-11 — Secrets are never surfaced · MUST · Enforced

No screen displays, edits or round-trips a signing secret or connection string,
at any privilege level. If a value would be dangerous on a screenshot, it does
not belong in this app.

---

## Presentation

### DASH-12 — Tokens, not literals · SHOULD

Colour, spacing and radius come from theme tokens. Both themes are supported,
so a hardcoded hex is a bug in one of them.

### DASH-13 — Destructive actions are confirmed and explained · MUST · Enforced

Suspending a tenant locks out every one of their users. Such actions state the
consequence, require a reason, and the reason reaches the audit log — not just
the console.

### DASH-14 — Dates render in the operator's locale with the timezone shown · SHOULD

Never a bare ISO string. An operator comparing a trial expiry against "now"
needs to know which timezone they are reading.

---

## Known gap

### DASH-15 — Tokens in `localStorage` · Target

Platform tokens are stored in `localStorage`
([`services/api.ts`](./src/services/api.ts)), which is readable by any script
that achieves XSS — and this is the *superadmin* console, the highest-value
target in the product.

Mitigations, in preference order: httpOnly refresh cookie with the access token
in memory; a strict CSP; short platform access TTLs
([CFG-4](../docs/standards/CONFIGURATION-AND-PLANS.md#cfg-4--dynamic-settings-are-bounded--must--target)).
Until that changes, treat any new `dangerouslySetInnerHTML`, dynamic script
injection or untrusted-HTML render as a blocker.

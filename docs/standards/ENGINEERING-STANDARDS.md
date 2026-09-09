# Engineering Standards

How code is written, tested, reviewed and shipped across all three surfaces.

Rule ID prefix: `ENG`. Severity and status labels: see [README](./README.md).

---

## 1. TypeScript

### ENG-1 — `strict` stays on · MUST · Enforced

No workspace weakens `strict`, and `npm run typecheck` must pass before merge.

### ENG-2 — `any` requires a written reason · MUST · Enforced

Prefer `unknown` plus narrowing. Where a library's types genuinely cannot be
satisfied, confine the escape to one file and say why:

```ts
/* eslint-disable @typescript-eslint/no-explicit-any */
// Mongoose types the transform's `ret` as the hydrated document type, which has
// no string index signature. Widening here keeps that cast in one file
// instead of seven.
```

That is the standard: not "no `any`", but *no unexplained `any`, and never
spread across call sites*.

### ENG-3 — No type assertions across a trust boundary · MUST · Enforced

Data arriving from HTTP, storage or the database is **parsed**, not asserted.
`as SomeType` on a network payload is a lie the compiler cannot check.

### ENG-4 — Exported functions carry explicit return types · SHOULD

Inference is fine internally. On a module boundary an explicit return type is
the contract, and it stops a refactor silently widening it.

**Documented exception:** `buildApp()` deliberately infers, because annotating
`FastifyInstance` fights the type provider's generics for no benefit.

---

## 2. Naming

### ENG-5 — Names state the domain, not the mechanism · SHOULD

`effectivePermissions`, `withoutTenantScope`, `assertFilterableCount` — each
says what it means in the product's vocabulary.

| Kind | Convention |
| --- | --- |
| Files | `camelCase.ts`; React components `PascalCase.tsx` |
| Modules | singular domain noun — `lead/`, `meeting/` |
| Booleans | `is` / `has` / `should` prefix |
| Async | verb first — `resolveApiBaseUrl`, `storeRefreshToken` |
| Constants | `SCREAMING_SNAKE` for frozen tables, `camelCase` for computed |
| Mongoose models | `PascalCase` singular — `Lead`, `PlatformAdmin` |
| Permissions | `resource.action` — `leads.assign` |
| Error codes | `SCREAMING_SNAKE` and stable — `ORGANIZATION_INACTIVE` |

### ENG-6 — Error codes are API, names are not · MUST · Enforced

A machine-readable `error.code` is part of the public contract: clients branch
on it. Renaming one is a breaking change. Human-readable `message` may change
freely.

---

## 3. Comments

### ENG-7 — Comments explain *why*, and record what was rejected · MUST · Enforced

This codebase's most valuable property is that its comments answer the question
a reader actually has. Preserve it.

```ts
// Only event-loop *delay* is checked. Utilization was tried and removed: it
// sits near 1.0 during any burst of back-to-back requests, which is normal
// throughput rather than distress, and it rejected everything.
```

That comment stops the next person re-introducing a known-bad idea. A comment
restating the code (`// increment counter`) is noise and should be deleted.

**Required** wherever a reader would otherwise assume a mistake: non-obvious
ordering, deliberate asymmetry, a workaround for library behaviour, or a
security-motivated choice.

### ENG-8 — No commented-out code, no bare `TODO` · MUST · Enforced

Deleted code lives in git. A `TODO` without a tracking reference is a wish; use
`TODO(#123):` or write the issue.

The backend currently has **zero** `TODO`/`FIXME`/`HACK` markers. Keep it that
way.

---

## 4. Errors

### ENG-9 — One error type, one envelope · MUST · Enforced

Throw `AppError`. Never throw strings or bare `Error` across a layer boundary.

```jsonc
// failure — every field required
{ "success": false,
  "error": { "code": "ORGANIZATION_INACTIVE", "message": "…", "details": {} },
  "requestId": "…" }
```

### ENG-10 — Internal failure detail never reaches the client · MUST · Enforced

Stack traces, driver errors and query fragments are logged, not returned. The
client gets a stable code, a safe message, and the `requestId` that lets
support find the rest.

### ENG-11 — Distinguish "denied" from "degraded" · MUST · Enforced

`401`/`403` mean *you may not*. `503` means *not now*. Conflating them makes
clients log users out during an outage.

The mobile client depends on this: only a definitive `400`/`401`/`403` on
refresh ends a session, because signing a field agent out over a transient 502
is worse than letting them retry.

---

## 5. Logging

### ENG-12 — Logs are structured · MUST · Enforced

Pino with fields. Never string-concatenate context into the message.

### ENG-13 — Credentials never enter a log · MUST · Enforced

Passwords, tokens, refresh tokens and `authorization` headers are redacted at
the boundary. The mobile client's `sanitizeForLog` is the reference
implementation; the pattern is a deny-list applied recursively before anything
is written.

### ENG-14 — Log levels mean something · SHOULD

| Level | Use |
| --- | --- |
| `error` | A request failed for a reason we must fix |
| `warn` | Expected-but-notable — shed load, refused token, inactive org |
| `info` | Request lifecycle and state changes |
| `debug` | Developer detail; off in production |

Anything logged at `error` should be something a human would act on. If nobody
would, it is `warn`.

---

## 6. Data access

### ENG-15 — Reads are paginated by default · MUST · Enforced

Any list endpoint takes `page`/`limit` with an enforced ceiling. An unbounded
`find()` on a tenant collection is a blocker.

### ENG-16 — Multi-document invariants use a transaction · MUST · Enforced

Provisioning an organization creates an org, an owner and roles. Partial
success there produces a tenant nobody can log into. This is why the deployment
requires a replica set.

### ENG-17 — `estimatedDocumentCount` is banned on tenant collections · MUST · Enforced

It ignores filters and counts every tenant in the shared collection. Models
call `assertFilterableCount()` to make the mistake impossible by accident.

---

## 7. Testing

> **Status: Target.** There is currently no test framework and no `*.test.ts`
> anywhere. The only automated coverage is `npm run smoke` — 52 assertions that
> need a live database. This is the largest single gap between this codebase and
> an enterprise-grade one, and the rules below are what closes it.

### ENG-18 — Every bug fix ships with a failing-first test · MUST · Target

The test must fail before the fix and pass after. A fix without one is an
assertion that the bug is gone, not evidence.

### ENG-19 — Test the boundary that owns the rule · SHOULD · Target

| Layer | Test with | Covers |
| --- | --- | --- |
| Pure logic | unit, no I/O | transitions, permissions, entitlement resolution |
| Service | integration, real DB | tenant scoping, transactions |
| Route | `app.inject()` | schema validation, status codes, envelopes |
| Cross-surface | smoke | the paths that must never break |

### ENG-20 — Tenant isolation has explicit negative tests · MUST · Target

For every tenant-owned resource there must be a test asserting that a valid
token for tenant A plus the exact id of tenant B's row returns 404/403 — for
read, update **and** delete.

The smoke suite does this for leads today. It is required for every resource.

### ENG-21 — Tests are independent and self-cleaning · MUST · Target

No ordering dependencies, no shared mutable fixtures, no reliance on seed data
that another test mutates.

---

## 8. Security

### ENG-22 — Secrets come from the environment and never move · MUST · Enforced

No secret is committed, logged, returned by an endpoint, or made runtime-
editable. See [CFG-3](./CONFIGURATION-AND-PLANS.md#cfg-3--secrets-and-infrastructure-are-never-dynamic--must--enforced).

### ENG-23 — Refresh tokens are hashed, rotated, and reuse is fatal · MUST · Enforced

Stored as SHA-256 hashes, single-use, and presenting an already-rotated token
revokes **every** session for that user. Sessions are capped.

Do not weaken any of the four properties independently; they only work together.

### ENG-24 — Authentication endpoints get their own rate limit · MUST · Enforced

Stricter than the global limit, and keyed per identity where one is known
rather than per IP — for a B2B product an office NAT is the normal case, and
IP-keyed limits punish every user behind it.

### ENG-25 — Deny by default on new endpoints · MUST · Enforced

A route without an explicit auth hook and permission guard is a blocker, even
when the data seems harmless.

---

## 9. Dependencies

### ENG-26 — Adding a runtime dependency needs a reason · SHOULD

State in the PR what it does, why the platform or an existing dependency is not
enough, and its maintenance status. Prefer the standard library, then something
already in the tree.

### ENG-27 — Versions are pinned by lockfile and upgraded deliberately · MUST · Enforced

The lockfile is committed. Upgrades are their own PR, never bundled into a
feature.

---

## 10. Git and review

### ENG-28 — Conventional commits · MUST · Enforced

```
feat(plans): resolve entitlements from the plan catalogue
fix(auth): stop transient 502 ending the session
refactor|docs|test|chore|perf(scope): …
```

Subject in the imperative, under ~72 characters. The body explains *why*.

### ENG-29 — One concern per pull request · SHOULD

A refactor and a behaviour change in one PR cannot be reviewed properly, and
cannot be reverted independently.

### ENG-30 — Definition of Done · MUST

A change is done when **all** hold:

- [ ] `npm run typecheck` passes
- [ ] `npm run smoke` passes
- [ ] New/changed behaviour has a test (`ENG-18`)
- [ ] Tenant-owned resources have isolation tests (`ENG-20`)
- [ ] No new `withoutTenantScope` without justification (`ARCH-4`)
- [ ] No secret, token or credential in code, logs or responses
- [ ] Public API change reflected in the zod schema, hence in OpenAPI
- [ ] Rule exceptions declared per [README](./README.md#exceptions)

### ENG-31 — Review checks invariants before style · SHOULD

Order of attention: tenant isolation → authorisation → data correctness →
failure handling → clarity → style. Formatting is a tool's job, not a
reviewer's.

---

## 11. Tooling gaps

Honest record of what does not yet enforce the above. Each is a **Target**.

| Gap | Consequence | Rule it would enforce |
| --- | --- | --- |
| No test framework | `ENG-18`–`ENG-21` rest on discipline alone | testing |
| No ESLint/Prettier config | `ENG-2`, `ENG-8` are unenforced; `toJSON.ts` already carries an `eslint-disable` for a linter that is not wired up | style, `any` |
| No CI pipeline | Nothing runs typecheck or smoke on a PR | `ENG-30` |
| No Dockerfile or IaC | Deployment is manual and unreproducible | release |
| Tenant `AuditLog` never written | Model, indexes and 365-day TTL exist but nothing writes or reads them; only the platform-side log works | compliance |

Wiring CI to run `typecheck` + `smoke` is the highest-value single step, because
it converts most of this document from guidance into enforcement.

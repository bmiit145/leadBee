# Multi-tenancy — how isolation is actually enforced

The rule: **`organizationId` is never taken from client input.** Not from the
body, not from a query param, not from a header. It comes from the verified JWT
and nowhere else.

## The three layers

### Layer 1 — context

`lib/tenantContext.ts` wraps each request in an `AsyncLocalStorage` scope
carrying `{ organizationId, userId, role, permissions, isPlatformAdmin }`.
Anything running inside the request — services, model hooks, aggregation
helpers — can read it without it being threaded through every signature.

### Layer 2 — the Mongoose plugin

`lib/tenantPlugin.ts` is registered globally. For any schema marked tenant-owned
it:

- adds `organizationId: ObjectId` (required, indexed) to the schema;
- on `save`, stamps `organizationId` from the context when absent;
- on every `find`, `findOne`, `count`, `distinct`, `update*`, `delete*` and
  `findOneAnd*`, merges `organizationId` into the filter;
- on `aggregate`, prepends a `$match` stage.

If a query runs with no tenant context and the model has not been explicitly
released via `withoutTenantScope()`, the plugin **throws**. A missing scope is a
bug, and a bug that returns another tenant's rows is the worst possible failure
mode — so it fails loudly instead.

### Layer 3 — explicit escapes, named and few

Cross-tenant reads exist (platform analytics, the superadmin console). They must
say so:

```ts
await withoutTenantScope(() => Lead.countDocuments({ stage: 'order_received' }));
```

Grep for `withoutTenantScope` to audit every cross-tenant read in the codebase.
That list should stay short and every entry should be reachable only from a
platform-admin route.

## Index discipline

Every tenant collection's indexes lead with `organizationId`:

```ts
schema.index({ organizationId: 1, stage: 1, priority: 1 });
schema.index({ organizationId: 1, assignedTo: 1, stage: 1 });
schema.index({ organizationId: 1, nextFollowUpAt: 1 });
```

Two reasons. Selectivity — a tenant is the most selective predicate available.
And sharding — a compound index led by the shard key keeps queries targeted at a
single shard once `organizationId` becomes the shard key.

Uniqueness is *per tenant*, never global:

```ts
schema.index({ organizationId: 1, leadNumber: 1 }, { unique: true });
```

A global `unique: true` on `leadNumber` would mean tenant A's `L-0001` blocks
tenant B's. Sequence counters are likewise per-org (`lib/counters.ts`).

## When to give a tenant its own database

`Organization.tier = 'dedicated'` when at least one holds:

- contractual data-residency or single-tenant-storage requirements;
- the tenant is large enough that its working set evicts everyone else's;
- a compliance regime demands separate backup/restore and separate encryption keys.

Everything else stays shared. Dedicated tenants are an exception you can count
on one hand; if that number grows, the answer is sharding, not more databases —
per-tenant databases multiply migration, backup and connection-pool work by N.

## Enabling sharding (runbook sketch)

```js
sh.enableSharding("leadbee")
sh.shardCollection("leadbee.leads",           { organizationId: "hashed" })
sh.shardCollection("leadbee.calllogs",        { organizationId: "hashed" })
sh.shardCollection("leadbee.leadthreaditems", { organizationId: "hashed" })
sh.shardCollection("leadbee.tasks",           { organizationId: "hashed" })
sh.shardCollection("leadbee.meetings",        { organizationId: "hashed" })
```

Hashed over ranged: org ids are monotonic ObjectIds, so a ranged key would send
every new tenant's writes to the same chunk. Hashed spreads them. The tradeoff
is that ranged queries across orgs scatter — which is fine, because the only
queries that span orgs are platform analytics, and those are already offline.

import { Schema, Types } from 'mongoose';
import type { Query, Aggregate } from 'mongoose';
import { getScope } from './tenantContext.js';
import { tenantJsonTransform } from './toJSON.js';

/**
 * Mongoose plugin that makes a schema tenant-owned.
 *
 * It adds `organizationId`, stamps it on write, and merges it into the filter of
 * every read and update. Services never mention `organizationId` — which means
 * a service *cannot* leak one tenant's rows to another by forgetting to.
 *
 * The contract when no scope is present is to **throw**. A tenant model queried
 * outside a request scope is a bug in every case; the alternatives are returning
 * every tenant's rows (a data breach) or silently returning none (a phantom bug
 * that surfaces in production). Neither is better than a stack trace.
 *
 * @see docs/MULTI-TENANCY.md
 */

/** Query methods whose filter must carry the tenant predicate. */
const FILTERED_QUERY_HOOKS = [
  'count',
  'countDocuments',
  'deleteMany',
  'deleteOne',
  'distinct',
  'find',
  'findOne',
  'findOneAndDelete',
  'findOneAndReplace',
  'findOneAndUpdate',
  'replaceOne',
  'updateMany',
  'updateOne',
] as const;

interface TenantPluginOptions {
  /** Index `organizationId` on its own in addition to the compound indexes the
   *  schema declares. Default true. */
  index?: boolean;
}

export function tenantPlugin(schema: Schema, options: TenantPluginOptions = {}): void {
  const { index = true } = options;

  schema.add({
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index,
    },
  });

  // Mark the schema so `isTenantSchema` can assert on it in tests and scripts.
  schema.set('tenantOwned' as never, true as never);

  // ─── Reads, updates, deletes ────────────────────────────────────────────────
  for (const hook of FILTERED_QUERY_HOOKS) {
    schema.pre(hook as 'find', function (this: Query<unknown, unknown>) {
      const organizationId = resolveOrganizationId();
      if (!organizationId) return; // explicitly unscoped
      this.setQuery({ ...this.getQuery(), organizationId });
    });
  }

  // ─── Aggregations ───────────────────────────────────────────────────────────
  // $match goes first so the tenant predicate is available to the index.
  schema.pre('aggregate', function (this: Aggregate<unknown[]>) {
    const organizationId = resolveOrganizationId();
    if (!organizationId) return;
    this.pipeline().unshift({ $match: { organizationId } });
  });

  // ─── Creates ────────────────────────────────────────────────────────────────
  /**
   * `validate`, not `save`.
   *
   * `organizationId` is a required path, and Mongoose runs validation *before*
   * user `pre('save')` hooks — so stamping it on save is too late and every
   * create fails with "Path `organizationId` is required". `pre('validate')`
   * runs first, which is the only place a required field can be filled in.
   */
  schema.pre('validate', function (this: { organizationId?: Types.ObjectId }) {
    if (this.organizationId) return; // caller set it explicitly (e.g. provisioning)
    const organizationId = resolveOrganizationId();
    if (organizationId) this.organizationId = organizationId;
  });

  /**
   * `insertMany` is the one hook Mongoose still drives callback-style: the
   * handler receives `next` first and the operation blocks until it is called.
   * Returning early without calling it hangs every bulk insert — silently, with
   * no error, forever.
   */
  schema.pre(
    'insertMany',
    function (
      next: (err?: Error) => void,
      docs: Array<{ organizationId?: Types.ObjectId }>
    ) {
      try {
        const organizationId = resolveOrganizationId();
        if (organizationId) {
          for (const doc of docs) {
            if (!doc.organizationId) doc.organizationId = organizationId;
          }
        }
        next();
      } catch (err) {
        next(err as Error);
      }
    }
  );

  // ─── Serialisation ──────────────────────────────────────────────────────────
  // The tenant id is an internal routing key; clients have no use for it and
  // echoing it back invites someone to try sending it.
  schema.set('toJSON', { virtuals: true, transform: tenantJsonTransform() });
}

/**
 * @returns the org id to filter by, or `null` when the caller has explicitly
 *          opted out of scoping. Throws when there is no scope at all.
 */
function resolveOrganizationId(): Types.ObjectId | null {
  const scope = getScope();

  if (!scope) {
    throw new Error(
      'Tenant-owned model accessed with no scope on the async context. ' +
        'Wrap the call in runInTenantScope() — or, for a deliberate cross-tenant ' +
        'read, withoutTenantScope("reason", ...).'
    );
  }

  return scope.kind === 'unscoped' ? null : scope.organizationId;
}

/** True when `tenantPlugin` was applied to this schema. */
export function isTenantSchema(schema: Schema): boolean {
  return schema.get('tenantOwned' as never) === true;
}

/**
 * `estimatedDocumentCount` reads collection metadata and cannot take a filter,
 * so on a shared collection it counts *every* tenant. Models call this instead
 * to make the mistake impossible to make by accident.
 */
export function assertFilterableCount(method: string): never {
  throw new Error(
    `${method}() cannot be tenant-scoped — it ignores filters and would count ` +
      'every tenant in the shared collection. Use countDocuments() instead.'
  );
}

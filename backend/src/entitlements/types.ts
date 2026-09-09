/**
 * Entitlement vocabulary.
 *
 * Business logic asks `hasFeature('crm.leads')` / `getLimit('crm.leads.max')`
 * and never sees a plan name. Plan names are commercial metadata; capabilities
 * are the authorization surface. See docs/adr/0001-entitlement-system.md.
 */

/** Sentinel for "no ceiling". Chosen to match the existing `limits` fields. */
export const UNLIMITED = -1;

export type FeatureKind = 'boolean' | 'limit' | 'config';

/**
 * What a plan, add-on or override says about one feature.
 *
 * One shape rather than a discriminated union, because Mongoose sub-documents
 * round-trip a flat optional shape far more predictably than a tagged one, and
 * the `kind` on the *definition* already tells a reader which fields matter.
 */
export interface Grant {
  /** Gate. `false` denies regardless of any limit or config present. */
  enabled: boolean;
  /** For `limit` features. `UNLIMITED` (-1) means no ceiling. */
  limit?: number | null;
  /** For `config` features — arbitrary tunables the feature itself interprets. */
  config?: Record<string, unknown> | null;
}

/** A grant plus the feature it applies to. How plans store their contents. */
export interface FeatureGrant extends Grant {
  featureKey: string;
}

/**
 * The resolved answer for one tenant: Plan + Add-ons + Overrides, flattened.
 *
 * Snapshotted onto the organization so the request path never touches the
 * catalogue. This is what makes a catalogue outage invisible to running
 * tenants (requirement 15).
 */
export interface EffectiveEntitlements {
  /**
   * Snapshot schema version, not the plan version. Lets a future resolver
   * recognise and re-resolve snapshots written by an older shape rather than
   * misreading them.
   */
  schemaVersion: number;
  resolvedAt: Date;
  planKey: string;
  planVersion: number;
  addOnKeys: string[];
  /**
   * Stored as an array rather than a `Record` keyed by feature key, because
   * feature keys contain dots (`crm.leads`) and dotted field names in MongoDB
   * are a long-standing source of driver and query ambiguity. An array sidesteps
   * it entirely, and at ~15 features a linear lookup is not worth optimising.
   */
  features: FeatureGrant[];
  /** Module keys with at least one enabled feature. Derived, for UI grouping. */
  modules: string[];
}

export const ENTITLEMENT_SCHEMA_VERSION = 1;

/**
 * The empty, deny-everything snapshot.
 *
 * Returned when a tenant has no readable entitlements. Deliberately not
 * "unlimited": a missing snapshot is an unknown, and an unknown must never
 * become a free upgrade.
 */
export function denyAll(): EffectiveEntitlements {
  return {
    schemaVersion: ENTITLEMENT_SCHEMA_VERSION,
    resolvedAt: new Date(0),
    planKey: '',
    planVersion: 0,
    addOnKeys: [],
    features: [],
    modules: [],
  };
}

// ─── Limit arithmetic ─────────────────────────────────────────────────────────

/** True for the unlimited sentinel. */
export function isUnlimited(limit: number | null | undefined): boolean {
  return limit === UNLIMITED;
}

/**
 * Combine two limits *additively* — the add-on case, where buying more capacity
 * should raise the ceiling rather than replace it.
 *
 * `UNLIMITED` dominates: once any source grants no ceiling, no finite number can
 * take it away. `null`/`undefined` means "this source says nothing", which is
 * not the same as zero and must not drag a real limit down.
 */
export function mergeLimit(
  a: number | null | undefined,
  b: number | null | undefined
): number | null {
  if (isUnlimited(a) || isUnlimited(b)) return UNLIMITED;
  if (a == null) return b ?? null;
  if (b == null) return a;
  return Math.max(a, b);
}

/**
 * Merge two grants for the same feature, additively.
 *
 * Enabling wins over not-enabling, because add-ons only ever add. Overrides do
 * *not* go through here — they replace outright, which is the whole point of an
 * override.
 */
export function mergeGrant(a: Grant | undefined, b: Grant | undefined): Grant {
  if (!a) return b ? { ...b } : { enabled: false };
  if (!b) return { ...a };
  return {
    enabled: a.enabled || b.enabled,
    limit: mergeLimit(a.limit, b.limit),
    config: a.config || b.config ? { ...(a.config ?? {}), ...(b.config ?? {}) } : null,
  };
}

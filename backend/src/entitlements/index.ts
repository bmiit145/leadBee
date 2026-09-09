/**
 * The entitlement API. **This is what business logic imports.**
 *
 *     if (!hasFeature(org, 'crm.exports')) …
 *     assertWithinLimit(org, 'identity.users.max', org.usage.users, 'users');
 *
 * Never branch on a plan name. `organization.plan` is a label for invoices and
 * admin screens; `growth` meaning something specific to the code is exactly the
 * coupling this system exists to remove.
 *
 * Everything here reads the snapshot already on the organization document, which
 * auth loads on every request anyway. No catalogue read, no cache to invalidate,
 * and no way for a catalogue outage to affect a running tenant.
 */

import { AppError } from '../lib/errors.js';
import { UNLIMITED, denyAll, type EffectiveEntitlements, type Grant } from './types.js';

export * from './types.js';
export { resolveEntitlements, type SubscriptionInput, type ResolutionResult } from './resolver.js';
export { registerModuleManifests } from './registry.js';
export { MODULE_MANIFESTS, allFeatureManifests } from './manifest.js';

/** Anything carrying an entitlement snapshot — an organization, or one directly. */
export type EntitlementSource =
  | EffectiveEntitlements
  | { entitlements?: EffectiveEntitlements | null }
  | null
  | undefined;

/**
 * Normalise a source to a usable snapshot.
 *
 * An absent or malformed snapshot resolves to deny-all rather than throwing.
 * A missing snapshot is an *unknown*, and the safe reading of an unknown is
 * "not entitled" — never "unlimited" (requirement 15).
 */
export function entitlementsOf(source: EntitlementSource): EffectiveEntitlements {
  if (!source) return denyAll();

  const candidate =
    'features' in source && Array.isArray(source.features)
      ? (source as EffectiveEntitlements)
      : (source as { entitlements?: EffectiveEntitlements | null }).entitlements;

  if (!candidate || !Array.isArray(candidate.features)) return denyAll();
  return candidate;
}

function grantFor(source: EntitlementSource, featureKey: string): Grant | undefined {
  return entitlementsOf(source).features.find((g) => g.featureKey === featureKey);
}

// ─── Capability checks ────────────────────────────────────────────────────────

/** Is this capability granted? Unknown keys are denied. */
export function hasFeature(source: EntitlementSource, featureKey: string): boolean {
  return grantFor(source, featureKey)?.enabled === true;
}

/** Is every one of these granted? */
export function hasAllFeatures(source: EntitlementSource, keys: string[]): boolean {
  return keys.every((key) => hasFeature(source, key));
}

/** Is any module feature granted? Useful for hiding a whole navigation section. */
export function hasModule(source: EntitlementSource, moduleKey: string): boolean {
  // `modules` is derived, so a snapshot written by an older resolver may not
  // carry it. Fall back to the features themselves rather than denying a
  // module the tenant demonstrably has.
  const entitlements = entitlementsOf(source);
  if (Array.isArray(entitlements.modules)) {
    return entitlements.modules.includes(moduleKey);
  }
  return entitlements.features.some(
    (g) => g.enabled && g.featureKey.startsWith(`${moduleKey}.`)
  );
}

/**
 * The ceiling for a metered capability.
 *
 * Returns `UNLIMITED` (-1) only when explicitly granted as unlimited. A denied,
 * unknown or unreadable feature returns `0` — deny, never uncapped. Callers can
 * therefore treat the result as a number without special-casing absence.
 */
export function getLimit(source: EntitlementSource, featureKey: string): number {
  const grant = grantFor(source, featureKey);
  if (!grant?.enabled) return 0;
  if (grant.limit === UNLIMITED) return UNLIMITED;
  return typeof grant.limit === 'number' && grant.limit >= 0 ? grant.limit : 0;
}

/** Configuration payload for a `config` feature, or `null`. */
export function getConfig<T = Record<string, unknown>>(
  source: EntitlementSource,
  featureKey: string
): T | null {
  const grant = grantFor(source, featureKey);
  if (!grant?.enabled) return null;
  return (grant.config as T | null) ?? null;
}

/** Would adding `count` more stay within the ceiling? */
export function isWithinLimit(
  source: EntitlementSource,
  featureKey: string,
  current: number,
  count = 1
): boolean {
  const limit = getLimit(source, featureKey);
  if (limit === UNLIMITED) return true;
  return current + count <= limit;
}

// ─── Assertions ───────────────────────────────────────────────────────────────

/**
 * Demand a capability, or refuse the request.
 *
 * 402 rather than 403: the caller is authenticated and authorised, the *plan*
 * is what is missing. Clients branch on the code to show an upgrade prompt
 * rather than a permissions error.
 */
export function assertFeature(
  source: EntitlementSource,
  featureKey: string,
  label?: string
): void {
  if (hasFeature(source, featureKey)) return;
  throw new AppError(
    `${label ?? 'This feature'} is not included in your plan.`,
    402,
    'FEATURE_NOT_ENTITLED',
    { featureKey }
  );
}

/** Demand headroom on a metered capability, or refuse. */
export function assertWithinLimit(
  source: EntitlementSource,
  featureKey: string,
  current: number,
  label: string,
  count = 1
): void {
  const limit = getLimit(source, featureKey);
  if (limit === UNLIMITED) return;
  if (current + count <= limit) return;

  throw AppError.planLimit(
    `Your plan allows ${limit} ${label}. Upgrade to add more.`,
    { featureKey, limit, current }
  );
}

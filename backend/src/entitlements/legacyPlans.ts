/**
 * The bridge from the old compiled `PLAN_LIMITS` table to catalogue grants.
 *
 * Used by the catalogue seed to create the initial plans, and by the test suite
 * to assert that those plans resolve to *exactly* the limits and features the
 * table used to produce. Sharing one implementation is the point: a test that
 * reimplemented the mapping would prove only that two copies of a bug agree.
 */

import { PLAN_LIMITS, type Plan as LegacyPlanKey } from '../config/constants.js';
import { MODULE_MANIFESTS } from './manifest.js';
import type { FeatureGrant } from './types.js';

/** Display order — previously the dashboard's hardcoded `PLAN_RANK`. */
export const LEGACY_PLAN_SORT_ORDER: Record<LegacyPlanKey, number> = {
  trial: 1,
  starter: 2,
  growth: 3,
  enterprise: 4,
};

export const LEGACY_PLAN_NAMES: Record<LegacyPlanKey, string> = {
  trial: 'Trial',
  starter: 'Starter',
  growth: 'Growth',
  enterprise: 'Enterprise',
};

/** legacy `features[]` entry → canonical feature key. */
export function legacyFeatureToCanonical(): Map<string, string> {
  const map = new Map<string, string>();
  for (const module of MODULE_MANIFESTS) {
    for (const feature of module.features) {
      if (feature.legacyFeatureKey) map.set(feature.legacyFeatureKey, feature.key);
    }
  }
  return map;
}

/** legacy `limits` field → canonical feature key. */
export function legacyLimitToCanonical(): Map<string, string> {
  const map = new Map<string, string>();
  for (const module of MODULE_MANIFESTS) {
    for (const feature of module.features) {
      if (feature.legacyLimitKey) map.set(feature.legacyLimitKey, feature.key);
    }
  }
  return map;
}

/**
 * Turn one row of the old `PLAN_LIMITS` table into a full grant list.
 *
 * Every known feature is listed explicitly, including denied ones. An absent
 * grant and a `false` grant resolve identically, but writing them out means the
 * plan builder shows an admin the complete picture rather than a form where
 * "unchecked" and "not mentioned" are indistinguishable.
 */
export function grantsForLegacyPlan(planKey: LegacyPlanKey): FeatureGrant[] {
  const legacy = PLAN_LIMITS[planKey];
  const grants: FeatureGrant[] = [];

  for (const module of MODULE_MANIFESTS) {
    for (const feature of module.features) {
      if (feature.legacyLimitKey) {
        const value = legacy[feature.legacyLimitKey as keyof typeof legacy];
        grants.push({
          featureKey: feature.key,
          enabled: true,
          limit: typeof value === 'number' ? value : 0,
          config: null,
        });
        continue;
      }

      if (feature.legacyFeatureKey) {
        grants.push({
          featureKey: feature.key,
          enabled: legacy.features.includes(feature.legacyFeatureKey),
          limit: null,
          config: null,
        });
        continue;
      }

      // No legacy mapping means the feature is new since the old table, so it
      // cannot have been granted before and starts denied.
      grants.push({ featureKey: feature.key, enabled: false, limit: null, config: null });
    }
  }

  return grants;
}

/**
 * The feature definitions implied by the manifests, in the shape resolution
 * consumes. Lets the resolver be exercised without a database.
 */
export function definitionsFromManifests() {
  return MODULE_MANIFESTS.flatMap((module) =>
    module.features.map((feature) => ({
      key: feature.key,
      moduleKey: module.key,
      legacyFeatureKey: feature.legacyFeatureKey,
      legacyLimitKey: feature.legacyLimitKey,
      defaultLimit: null,
      defaultConfig: null,
    }))
  );
}

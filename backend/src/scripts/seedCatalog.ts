/**
 * Seed the entitlement catalogue and migrate existing tenants onto it.
 *
 * Idempotent and behaviour-preserving. It reproduces the previous
 * `PLAN_LIMITS` table and `TRIAL_DAYS` exactly, then backfills every
 * organization so that no tenant's access changes by so much as one feature.
 *
 * Where a tenant's stored limits or features have drifted from their plan —
 * someone edited the document directly, or the plan table changed after they
 * were provisioned — the difference is preserved as an **organization
 * override** rather than being silently corrected. Migration must not be the
 * moment a customer quietly gains or loses capability.
 *
 *     npm run seed:catalog
 */

import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { Organization } from '../models/Organization.js';
import { Plan, PLAN_STATUSES } from '../models/Plan.js';
import { PLANS } from '../config/constants.js';
import {
  LEGACY_PLAN_NAMES,
  LEGACY_PLAN_SORT_ORDER,
  grantsForLegacyPlan,
  legacyFeatureToCanonical,
  legacyLimitToCanonical,
} from '../entitlements/legacyPlans.js';
import { registerModuleManifests } from '../entitlements/registry.js';
import { resolveEntitlements } from '../entitlements/resolver.js';
import type { FeatureGrant } from '../entitlements/types.js';
import '../models/index.js';

async function seedPlans(): Promise<void> {
  for (const planKey of Object.values(PLANS)) {
    const existing = await Plan.findOne({ key: planKey }).sort({ version: -1 });
    if (existing) {
      logger.info({ planKey, version: existing.version }, 'plan exists — skipped');
      continue;
    }

    await Plan.create({
      key: planKey,
      version: 1,
      name: LEGACY_PLAN_NAMES[planKey],
      description: `Migrated from the built-in ${planKey} plan.`,
      status: PLAN_STATUSES.ACTIVE,
      isPublic: true,
      sortOrder: LEGACY_PLAN_SORT_ORDER[planKey],
      // Every plan inherits the old global TRIAL_DAYS, so provisioning behaves
      // exactly as before. Differentiating trials per plan is now an admin edit.
      trialDays: env.TRIAL_DAYS,
      grants: grantsForLegacyPlan(planKey),
    });
    logger.info({ planKey }, 'plan seeded');
  }
}

/**
 * Point every organization at the catalogue without changing what it can do.
 */
async function backfillOrganizations(): Promise<void> {
  const organizations = await Organization.find({});
  let migrated = 0;
  let preserved = 0;

  for (const organization of organizations) {
    if (organization.entitlements) continue;

    const planKey = organization.plan || PLANS.TRIAL;
    const plan = await Plan.findOne({ key: planKey }).sort({ version: -1 });
    if (!plan) {
      logger.error(
        { orgId: organization._id.toString(), planKey },
        'no catalogue plan for organization — skipped, needs manual attention'
      );
      continue;
    }

    // What the tenant has *right now*, before we touch anything.
    const beforeLimits = { ...organization.limits };
    const beforeFeatures = [...(organization.features ?? [])].sort();

    const subscription = {
      planKey,
      planVersion: plan.version,
      addOnKeys: [] as string[],
      overrides: [] as FeatureGrant[],
    };
    const first = await resolveEntitlements(subscription);

    // Preserve any drift as explicit overrides rather than "correcting" it.
    const overrides = driftOverrides(
      { limits: beforeLimits, features: beforeFeatures },
      { limits: first.legacy.limits, features: first.legacy.features }
    );

    if (overrides.length > 0) {
      subscription.overrides = overrides;
      preserved += 1;
      logger.warn(
        {
          orgId: organization._id.toString(),
          planKey,
          overrides: overrides.map((o) => o.featureKey),
        },
        'organization diverged from its plan — preserved as overrides'
      );
    }

    const { entitlements, legacy } = await resolveEntitlements(subscription);

    organization.subscription = subscription;
    organization.entitlements = entitlements;
    organization.plan = planKey;
    organization.features = legacy.features;
    organization.limits = legacy.limits;
    await organization.save();
    migrated += 1;
  }

  logger.info({ migrated, preserved, total: organizations.length }, 'organizations backfilled');
}

/**
 * Build the overrides needed to make `resolved` match `actual` exactly.
 *
 * Returns an empty list when the tenant already matches their plan, which is
 * the overwhelmingly common case.
 */
function driftOverrides(
  actual: { limits: Record<string, number>; features: string[] },
  resolved: { limits: Record<string, number>; features: string[] }
): FeatureGrant[] {
  const overrides: FeatureGrant[] = [];
  const featureMap = legacyFeatureToCanonical();
  const limitMap = legacyLimitToCanonical();

  for (const [legacyKey, canonical] of limitMap) {
    const actualValue = actual.limits[legacyKey];
    const resolvedValue = resolved.limits[legacyKey];
    if (typeof actualValue === 'number' && actualValue !== resolvedValue) {
      overrides.push({
        featureKey: canonical,
        enabled: true,
        limit: actualValue,
        config: null,
      });
    }
  }

  const actualSet = new Set(actual.features);
  const resolvedSet = new Set(resolved.features);
  for (const [legacyKey, canonical] of featureMap) {
    const had = actualSet.has(legacyKey);
    const gets = resolvedSet.has(legacyKey);
    if (had !== gets) {
      overrides.push({ featureKey: canonical, enabled: had, limit: null, config: null });
    }
  }

  return overrides;
}

async function main(): Promise<void> {
  await connectDatabase();
  await registerModuleManifests();
  await seedPlans();
  await backfillOrganizations();
  await disconnectDatabase();
  logger.info('entitlement catalogue seeded');
}

main().catch(async (error) => {
  logger.error({ err: error }, 'catalogue seed failed');
  await disconnectDatabase().catch(() => undefined);
  process.exit(1);
});

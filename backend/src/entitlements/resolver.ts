/**
 * Effective entitlement resolution.
 *
 *     Plan(key @ version)  →  Add-ons  →  Organization overrides
 *                                              = effective entitlements
 *
 * Add-ons are **additive**: features union, limits take the higher value, and
 * `UNLIMITED` dominates. Overrides are **absolute**: whatever they say replaces
 * the accumulated answer outright, which is what makes them useful for a
 * negotiated enterprise deal that is *smaller* in one dimension.
 *
 * Runs on change only — plan change, add-on change, override edit, explicit
 * re-sync — never on the request path. The result is snapshotted onto the
 * organization, which is what keeps a catalogue outage from becoming a product
 * outage (ADR-0001, requirement 15).
 */

import { Plan } from '../models/Plan.js';
import { AddOn } from '../models/AddOn.js';
import { FeatureDefinition } from '../models/FeatureDefinition.js';
import { AppError } from '../lib/errors.js';
import {
  ENTITLEMENT_SCHEMA_VERSION,
  mergeGrant,
  type EffectiveEntitlements,
  type FeatureGrant,
  type Grant,
} from './types.js';

/**
 * The parts of a feature definition resolution actually reads.
 *
 * Declared structurally rather than as the Mongoose document type: `.lean()`
 * returns `FlattenMaps<IFeatureDefinition>`, which is not assignable to the
 * hydrated interface, and widening at each call site would spread the cast
 * around. This names exactly what is needed instead.
 */
interface FeatureDefinitionView {
  key: string;
  moduleKey: string;
  legacyFeatureKey?: string;
  legacyLimitKey?: string;
  defaultLimit?: number | null;
  defaultConfig?: Record<string, unknown> | null;
}

/** What a tenant was sold. Stored on the organization; see ADR-0001. */
export interface SubscriptionInput {
  planKey: string;
  planVersion: number;
  addOnKeys?: string[];
  /** Absolute per-tenant overrides. Replace rather than merge. */
  overrides?: FeatureGrant[];
}

/** Legacy mirrors, kept in step so existing readers need no changes. */
export interface LegacyMirror {
  features: string[];
  limits: {
    maxUsers: number;
    maxLeads: number;
    maxMonthlyApiCalls: number;
  };
}

export interface ResolutionResult {
  entitlements: EffectiveEntitlements;
  legacy: LegacyMirror;
}

/** A plan reduced to what resolution needs. */
export interface PlanView {
  key: string;
  version: number;
  grants: FeatureGrant[];
}

/**
 * Everything resolution consumes, with no database in sight.
 *
 * Split out so the merge rules — the part with the subtle behaviour around
 * unlimited, additivity and override precedence — are testable as a pure
 * function. Fetching is the easy half; getting these rules wrong silently
 * changes what customers can do.
 */
export interface ResolutionInputs {
  plan: PlanView;
  addOns: Array<{ grants: FeatureGrant[] }>;
  addOnKeys: string[];
  definitions: FeatureDefinitionView[];
  overrides: FeatureGrant[];
}

/**
 * Resolve a subscription into effective entitlements.
 *
 * Throws when the pinned plan cannot be read. Deliberately: the caller is
 * mid-change, and failing means the organization keeps the snapshot it already
 * has. Writing an empty snapshot on a transient catalogue error would revoke a
 * paying customer's access — the exact failure mode requirement 15 forbids.
 */
export async function resolveEntitlements(
  subscription: SubscriptionInput
): Promise<ResolutionResult> {
  const plan = await Plan.findOne({
    key: subscription.planKey,
    version: subscription.planVersion,
  }).lean();

  if (!plan) {
    throw AppError.notFound(
      `Plan "${subscription.planKey}" version ${subscription.planVersion} not found`
    );
  }

  const addOnKeys = subscription.addOnKeys ?? [];
  const addOns =
    addOnKeys.length > 0
      ? await AddOn.find({ key: { $in: addOnKeys }, isActive: true }).lean()
      : [];

  const definitions = await FeatureDefinition.find({ isActive: true }).lean();

  return resolveFrom({
    plan: { key: plan.key, version: plan.version, grants: plan.grants },
    addOns: addOns.map((a) => ({ grants: a.grants })),
    addOnKeys,
    definitions,
    overrides: subscription.overrides ?? [],
  });
}

/** The merge rules, pure. See `ResolutionInputs`. */
export function resolveFrom(inputs: ResolutionInputs): ResolutionResult {
  const { plan, addOns, addOnKeys, definitions, overrides } = inputs;
  const byKey = new Map(definitions.map((d) => [d.key, d]));

  // ─── Base: the pinned plan ──────────────────────────────────────────────────
  const features: Record<string, Grant> = {};
  for (const grant of plan.grants) {
    features[grant.featureKey] = applyDefaults(grant, byKey.get(grant.featureKey));
  }

  // ─── Add-ons: additive ──────────────────────────────────────────────────────
  for (const addOn of addOns) {
    for (const grant of addOn.grants) {
      const incoming = applyDefaults(grant, byKey.get(grant.featureKey));
      features[grant.featureKey] = mergeGrant(features[grant.featureKey], incoming);
    }
  }

  // ─── Overrides: absolute ────────────────────────────────────────────────────
  for (const override of overrides) {
    features[override.featureKey] = {
      enabled: override.enabled,
      limit: override.limit ?? null,
      config: override.config ?? null,
    };
  }

  // Unknown keys are dropped rather than trusted. A grant naming a feature no
  // definition declares is a stale plan referencing a removed capability, and
  // honouring it would let a retired feature quietly stay live.
  for (const key of Object.keys(features)) {
    if (!byKey.has(key)) delete features[key];
  }

  const modules = [
    ...new Set(
      Object.entries(features)
        .filter(([, grant]) => grant.enabled)
        .map(([key]) => byKey.get(key)?.moduleKey)
        .filter((k): k is string => Boolean(k))
    ),
  ].sort();

  // Sorted so two resolutions of the same subscription are byte-identical,
  // which is what makes "did this change?" a cheap comparison.
  const featureList: FeatureGrant[] = Object.entries(features)
    .map(([featureKey, grant]) => ({ featureKey, ...grant }))
    .sort((a, b) => a.featureKey.localeCompare(b.featureKey));

  const entitlements: EffectiveEntitlements = {
    schemaVersion: ENTITLEMENT_SCHEMA_VERSION,
    resolvedAt: new Date(),
    planKey: plan.key,
    planVersion: plan.version,
    addOnKeys: [...addOnKeys].sort(),
    features: featureList,
    modules,
  };

  return { entitlements, legacy: buildLegacyMirror(features, definitions) };
}

/**
 * Fill in a grant's unstated parts from its definition, so a plan document only
 * has to record what differs from the default.
 */
function applyDefaults(
  grant: FeatureGrant,
  definition: FeatureDefinitionView | undefined
): Grant {
  return {
    enabled: grant.enabled,
    limit: grant.limit ?? definition?.defaultLimit ?? null,
    config: grant.config ?? definition?.defaultConfig ?? null,
  };
}

/**
 * Project entitlements back onto the pre-existing `features[]` and `limits{}`
 * fields.
 *
 * Every current reader — `assertCanAddUser`, `assertCanAddLead`, the auth
 * response, the dashboard, the mobile app — goes through these. Keeping them in
 * step is what lets the entitlement system land without a visible change
 * (requirement 12). They are removed once every reader has moved to
 * `hasFeature` / `getLimit`.
 *
 * A limit with no grant mirrors as `0`, not unlimited: an ungranted capability
 * is denied, never uncapped.
 */
function buildLegacyMirror(
  resolved: Record<string, Grant>,
  definitions: FeatureDefinitionView[]
): LegacyMirror {
  const features: string[] = [];
  const limits: LegacyMirror['limits'] = {
    maxUsers: 0,
    maxLeads: 0,
    maxMonthlyApiCalls: 0,
  };

  for (const definition of definitions) {
    const grant = resolved[definition.key];

    if (definition.legacyFeatureKey && grant?.enabled) {
      features.push(definition.legacyFeatureKey);
    }

    if (definition.legacyLimitKey) {
      const key = definition.legacyLimitKey as keyof LegacyMirror['limits'];
      if (key in limits) {
        limits[key] = grant?.enabled ? (grant.limit ?? 0) : 0;
      }
    }
  }

  features.sort();
  return { features, limits };
}

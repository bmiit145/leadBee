/**
 * Module manifests — the one file a new module touches.
 *
 * Each module declares the capabilities its code checks. Boot upserts these
 * into the `FeatureDefinition` collection (see registry.ts), so the plan builder
 * in the admin console renders checkboxes for them automatically.
 *
 * **Adding a module is this file plus the module's own code.** Nothing in the
 * plan system, the resolver or the admin UI changes — that is the architectural
 * acceptance criterion, and `entitlements.test.ts` asserts it.
 *
 * Why declared in code rather than created purely through the UI: a feature key
 * is referenced by `hasFeature('crm.leads')`. An admin-typed
 * `hasFeature('crm.led')` would silently return `false` forever, denying a
 * paying customer with no error anywhere. Declaring keys alongside the code that
 * reads them means a typo is a failed startup assertion, not a support ticket.
 */

import type { FeatureKind } from './types.js';

export interface FeatureManifest {
  /** Canonical, namespaced, stable. Never reused once shipped. */
  key: string;
  name: string;
  description?: string;
  kind: FeatureKind;
  /**
   * Mirrors this feature into the legacy `organization.features` array under
   * this name, so existing clients keep working during migration.
   * Omit for anything new — new features are read through the entitlement API.
   */
  legacyFeatureKey?: string;
  /**
   * Mirrors this limit into the legacy `organization.limits` object under this
   * name. Only meaningful for `kind: 'limit'`.
   */
  legacyLimitKey?: 'maxUsers' | 'maxLeads' | 'maxMonthlyApiCalls';
}

export interface ModuleManifest {
  key: string;
  name: string;
  description?: string;
  /**
   * Reserved. LeadBee is a single product today; see ADR-0001 for why the
   * Product layer is deliberately absent. Populating this later is a data
   * backfill rather than a redesign.
   */
  productKey?: string;
  /** Display order in the plan builder. */
  sortOrder: number;
  features: FeatureManifest[];
}

/**
 * The modules LeadBee ships today.
 *
 * Keys and legacy mappings here reproduce the previous `PLAN_LIMITS` shape
 * exactly, so seeding produces byte-identical entitlements for existing tenants.
 */
export const MODULE_MANIFESTS: ModuleManifest[] = [
  {
    key: 'crm',
    name: 'CRM',
    description: 'Leads, the pipeline, and everything attached to them.',
    sortOrder: 1,
    features: [
      {
        key: 'crm.leads',
        name: 'Leads',
        description: 'The lead workspace and pipeline.',
        kind: 'boolean',
        legacyFeatureKey: 'leads',
      },
      {
        key: 'crm.leads.max',
        name: 'Lead ceiling',
        description: 'Maximum leads the tenant may hold.',
        kind: 'limit',
        legacyLimitKey: 'maxLeads',
      },
      {
        key: 'crm.tasks',
        name: 'Tasks',
        kind: 'boolean',
        legacyFeatureKey: 'tasks',
      },
      {
        key: 'crm.meetings',
        name: 'Meetings',
        description: 'Scheduling with slot availability and auto-raised tasks.',
        kind: 'boolean',
        legacyFeatureKey: 'meetings',
      },
      {
        key: 'crm.notes',
        name: 'Notes',
        kind: 'boolean',
        legacyFeatureKey: 'notes',
      },
      {
        key: 'crm.visits',
        name: 'Visits',
        kind: 'boolean',
        legacyFeatureKey: 'visits',
      },
      {
        key: 'crm.quick_replies',
        name: 'Quick replies',
        kind: 'boolean',
        legacyFeatureKey: 'quick_replies',
      },
      {
        key: 'crm.exports',
        name: 'Exports',
        description: 'Download leads and reports.',
        kind: 'boolean',
        legacyFeatureKey: 'exports',
      },
    ],
  },
  {
    key: 'identity',
    name: 'Users & access',
    description: 'Seats, roles and sign-in.',
    sortOrder: 2,
    features: [
      {
        key: 'identity.users.max',
        name: 'Seat ceiling',
        description: 'Maximum active users.',
        kind: 'limit',
        legacyLimitKey: 'maxUsers',
      },
      {
        key: 'identity.custom_roles',
        name: 'Custom roles',
        description: 'Roles beyond the five built-in ones.',
        kind: 'boolean',
        legacyFeatureKey: 'custom_roles',
      },
      {
        key: 'identity.sso',
        name: 'Single sign-on',
        kind: 'boolean',
        legacyFeatureKey: 'sso',
      },
    ],
  },
  {
    key: 'platform',
    name: 'Platform',
    description: 'API access, auditing and isolation tier.',
    sortOrder: 3,
    features: [
      {
        key: 'platform.api.monthly_calls',
        name: 'Monthly API calls',
        kind: 'limit',
        legacyLimitKey: 'maxMonthlyApiCalls',
      },
      {
        key: 'platform.audit_log',
        name: 'Audit log',
        kind: 'boolean',
        legacyFeatureKey: 'audit_log',
      },
      {
        key: 'platform.dedicated_tier',
        name: 'Dedicated infrastructure',
        description: 'Tenant resolves to its own database connection.',
        kind: 'boolean',
        legacyFeatureKey: 'dedicated_tier',
      },
    ],
  },
];

// ─── Derived lookups ──────────────────────────────────────────────────────────

/** Every feature across every module, flattened. */
export function allFeatureManifests(): Array<FeatureManifest & { moduleKey: string }> {
  return MODULE_MANIFESTS.flatMap((module) =>
    module.features.map((feature) => ({ ...feature, moduleKey: module.key }))
  );
}

/**
 * Guard against a manifest that would corrupt the catalogue.
 *
 * Runs at boot rather than in a test, because a duplicate key silently
 * overwriting another module's feature is exactly the class of bug that is
 * invisible until a customer loses access.
 */
export function assertManifestsValid(): void {
  const featureKeys = new Set<string>();
  const legacyFeatureKeys = new Set<string>();
  const legacyLimitKeys = new Set<string>();
  const moduleKeys = new Set<string>();

  for (const module of MODULE_MANIFESTS) {
    if (moduleKeys.has(module.key)) {
      throw new Error(`Duplicate module key in manifest: "${module.key}"`);
    }
    moduleKeys.add(module.key);

    for (const feature of module.features) {
      if (featureKeys.has(feature.key)) {
        throw new Error(`Duplicate feature key in manifest: "${feature.key}"`);
      }
      featureKeys.add(feature.key);

      if (feature.legacyFeatureKey) {
        if (legacyFeatureKeys.has(feature.legacyFeatureKey)) {
          throw new Error(
            `Duplicate legacyFeatureKey "${feature.legacyFeatureKey}" — the ` +
              'legacy mirror would be ambiguous.'
          );
        }
        legacyFeatureKeys.add(feature.legacyFeatureKey);
      }

      if (feature.legacyLimitKey) {
        if (legacyLimitKeys.has(feature.legacyLimitKey)) {
          throw new Error(
            `Duplicate legacyLimitKey "${feature.legacyLimitKey}" — the legacy ` +
              'mirror would be ambiguous.'
          );
        }
        legacyLimitKeys.add(feature.legacyLimitKey);
      }

      if (feature.legacyLimitKey && feature.kind !== 'limit') {
        throw new Error(
          `Feature "${feature.key}" maps to a legacy limit but is not kind:'limit'.`
        );
      }
    }
  }
}

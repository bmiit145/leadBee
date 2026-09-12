import { describe, expect, it } from 'vitest';
import {
  UNLIMITED,
  assertWithinLimit,
  getLimit,
  hasFeature,
  type EffectiveEntitlements,
  type EntitlementSource,
  type FeatureGrant,
} from './index.js';

function snapshot(features: FeatureGrant[]): EffectiveEntitlements {
  return {
    schemaVersion: 1,
    resolvedAt: new Date(),
    planKey: 'growth',
    planVersion: 1,
    addOnKeys: [],
    features,
    modules: ['crm'],
  };
}

/**
 * The shapes a real organization document takes: a snapshot under
 * `entitlements` *and* the legacy `features: string[]` mirror beside it. Built
 * loosely on purpose — these are documents read from the database, not values
 * the type system vouches for.
 */
function organization(fields: Record<string, unknown>): EntitlementSource {
  return fields as unknown as EntitlementSource;
}

describe('entitlementsOf, through the limit checks', () => {
  it('reads the snapshot of an organization that also carries the legacy features mirror', () => {
    const org = organization({
      features: ['leads', 'tasks', 'meetings'],
      entitlements: snapshot([{ featureKey: 'crm.leads.max', enabled: true, limit: 50_000 }]),
    });

    expect(getLimit(org, 'crm.leads.max')).toBe(50_000);
    expect(() => assertWithinLimit(org, 'crm.leads.max', 40, 'leads')).not.toThrow();
  });

  it('still accepts a bare snapshot', () => {
    const bare = snapshot([{ featureKey: 'crm.exports', enabled: true }]);
    expect(hasFeature(bare, 'crm.exports')).toBe(true);
  });

  it('keeps an unlimited grant unlimited when read through an organization', () => {
    const org = organization({
      features: ['leads'],
      entitlements: snapshot([{ featureKey: 'identity.users.max', enabled: true, limit: UNLIMITED }]),
    });
    expect(getLimit(org, 'identity.users.max')).toBe(UNLIMITED);
  });

  it('denies an organization whose only features are the legacy strings', () => {
    const legacyOnly = organization({ features: ['leads', 'tasks'] });
    expect(getLimit(legacyOnly, 'crm.leads.max')).toBe(0);
    expect(hasFeature(legacyOnly, 'crm.leads')).toBe(false);
  });

  it('denies an organization whose snapshot is null', () => {
    const unresolved = organization({ features: ['leads'], entitlements: null });
    expect(getLimit(unresolved, 'crm.leads.max')).toBe(0);
  });
});

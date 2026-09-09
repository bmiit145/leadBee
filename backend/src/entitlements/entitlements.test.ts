import { describe, it, expect } from 'vitest';

import { resolveFrom, type ResolutionInputs } from './resolver.js';
import {
  denyAll,
  UNLIMITED,
  type EffectiveEntitlements,
  type FeatureGrant,
} from './types.js';
import {
  assertFeature,
  assertWithinLimit,
  getConfig,
  getLimit,
  hasFeature,
  hasModule,
  isWithinLimit,
} from './index.js';
import {
  definitionsFromManifests,
  grantsForLegacyPlan,
} from './legacyPlans.js';
import { PLAN_LIMITS, PLANS, type Plan as LegacyPlanKey } from '../config/constants.js';
import { assertManifestsValid, MODULE_MANIFESTS } from './manifest.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DEFINITIONS = definitionsFromManifests();

function resolve(overrides: Partial<ResolutionInputs> = {}) {
  return resolveFrom({
    plan: { key: 'test', version: 1, grants: [] },
    addOns: [],
    addOnKeys: [],
    definitions: DEFINITIONS,
    overrides: [],
    ...overrides,
  });
}

function grant(featureKey: string, enabled: boolean, limit: number | null = null): FeatureGrant {
  return { featureKey, enabled, limit, config: null };
}

/** An organization-shaped carrier, as the entitlement API sees it. */
function org(entitlements: EffectiveEntitlements | null) {
  return { entitlements };
}

// ─── 1. Existing plans resolve exactly as before ──────────────────────────────

describe('migration fidelity', () => {
  it('reproduces the previous PLAN_LIMITS table exactly for every plan', () => {
    for (const planKey of Object.values(PLANS) as LegacyPlanKey[]) {
      const { legacy } = resolve({
        plan: { key: planKey, version: 1, grants: grantsForLegacyPlan(planKey) },
      });

      const expected = PLAN_LIMITS[planKey];

      expect(legacy.limits, `${planKey} limits`).toEqual({
        maxUsers: expected.maxUsers,
        maxLeads: expected.maxLeads,
        maxMonthlyApiCalls: expected.maxMonthlyApiCalls,
      });
      expect(legacy.features.sort(), `${planKey} features`).toEqual(
        [...expected.features].sort()
      );
    }
  });

  it('keeps the manifest internally consistent', () => {
    expect(() => assertManifestsValid()).not.toThrow();
  });

  it('maps every legacy feature name to exactly one canonical key', () => {
    const legacyNames = new Set(
      Object.values(PLAN_LIMITS).flatMap((plan) => plan.features)
    );
    const mapped = new Set(
      MODULE_MANIFESTS.flatMap((m) => m.features)
        .map((f) => f.legacyFeatureKey)
        .filter(Boolean)
    );
    for (const name of legacyNames) {
      expect(mapped.has(name), `legacy feature "${name}" is unmapped`).toBe(true);
    }
  });
});

// ─── 2 & 3. Module and feature enable/disable ─────────────────────────────────

describe('enable and disable', () => {
  it('grants a feature when the plan enables it', () => {
    const { entitlements } = resolve({
      plan: { key: 'p', version: 1, grants: [grant('crm.leads', true)] },
    });
    expect(hasFeature(org(entitlements), 'crm.leads')).toBe(true);
  });

  it('denies a feature the plan explicitly disables', () => {
    const { entitlements } = resolve({
      plan: { key: 'p', version: 1, grants: [grant('crm.leads', false)] },
    });
    expect(hasFeature(org(entitlements), 'crm.leads')).toBe(false);
  });

  it('denies a feature the plan never mentions', () => {
    const { entitlements } = resolve({ plan: { key: 'p', version: 1, grants: [] } });
    expect(hasFeature(org(entitlements), 'crm.leads')).toBe(false);
  });

  it('reports a module as present only while one of its features is enabled', () => {
    const enabled = resolve({
      plan: { key: 'p', version: 1, grants: [grant('crm.leads', true)] },
    });
    expect(hasModule(org(enabled.entitlements), 'crm')).toBe(true);
    expect(hasModule(org(enabled.entitlements), 'identity')).toBe(false);

    const disabled = resolve({
      plan: { key: 'p', version: 1, grants: [grant('crm.leads', false)] },
    });
    expect(hasModule(org(disabled.entitlements), 'crm')).toBe(false);
  });

  it('disabling a whole module removes every one of its features', () => {
    const grants = MODULE_MANIFESTS.find((m) => m.key === 'crm')!.features.map((f) =>
      grant(f.key, false)
    );
    const { entitlements, legacy } = resolve({
      plan: { key: 'p', version: 1, grants },
    });
    expect(hasModule(org(entitlements), 'crm')).toBe(false);
    expect(legacy.features).toEqual([]);
    expect(legacy.limits.maxLeads).toBe(0);
  });

  it('drops grants naming a feature no definition declares', () => {
    const { entitlements } = resolve({
      plan: { key: 'p', version: 1, grants: [grant('ghost.retired', true)] },
    });
    expect(hasFeature(org(entitlements), 'ghost.retired')).toBe(false);
    expect(entitlements.features).toHaveLength(0);
  });
});

// ─── 4 & 5. Limits, and unlimited ─────────────────────────────────────────────

describe('limits', () => {
  it('reads a numeric ceiling', () => {
    const { entitlements } = resolve({
      plan: { key: 'p', version: 1, grants: [grant('identity.users.max', true, 10)] },
    });
    expect(getLimit(org(entitlements), 'identity.users.max')).toBe(10);
  });

  it('enforces the ceiling', () => {
    const { entitlements } = resolve({
      plan: { key: 'p', version: 1, grants: [grant('identity.users.max', true, 3)] },
    });
    const source = org(entitlements);

    expect(isWithinLimit(source, 'identity.users.max', 2)).toBe(true);
    expect(isWithinLimit(source, 'identity.users.max', 3)).toBe(false);
    expect(() => assertWithinLimit(source, 'identity.users.max', 3, 'users')).toThrow(
      /allows 3 users/
    );
    expect(() =>
      assertWithinLimit(source, 'identity.users.max', 2, 'users')
    ).not.toThrow();
  });

  it('treats -1 as unlimited', () => {
    const { entitlements } = resolve({
      plan: {
        key: 'p',
        version: 1,
        grants: [grant('identity.users.max', true, UNLIMITED)],
      },
    });
    const source = org(entitlements);

    expect(getLimit(source, 'identity.users.max')).toBe(UNLIMITED);
    expect(isWithinLimit(source, 'identity.users.max', 10_000_000)).toBe(true);
    expect(() =>
      assertWithinLimit(source, 'identity.users.max', 10_000_000, 'users')
    ).not.toThrow();
  });

  it('never reports unlimited for a disabled feature', () => {
    const { entitlements } = resolve({
      plan: {
        key: 'p',
        version: 1,
        grants: [grant('identity.users.max', false, UNLIMITED)],
      },
    });
    expect(getLimit(org(entitlements), 'identity.users.max')).toBe(0);
    expect(isWithinLimit(org(entitlements), 'identity.users.max', 0)).toBe(false);
  });

  it('mirrors an ungranted limit as 0, never as unlimited', () => {
    const { legacy } = resolve({ plan: { key: 'p', version: 1, grants: [] } });
    expect(legacy.limits.maxUsers).toBe(0);
    expect(legacy.limits.maxLeads).toBe(0);
    expect(legacy.limits.maxMonthlyApiCalls).toBe(0);
  });
});

// ─── 6. Organization overrides and add-ons ────────────────────────────────────

describe('add-ons and overrides', () => {
  it('add-ons raise a ceiling without replacing it', () => {
    const { entitlements } = resolve({
      plan: { key: 'p', version: 1, grants: [grant('identity.users.max', true, 10)] },
      addOns: [{ grants: [grant('identity.users.max', true, 25)] }],
      addOnKeys: ['extra-seats'],
    });
    expect(getLimit(org(entitlements), 'identity.users.max')).toBe(25);
  });

  it('an add-on never lowers a ceiling', () => {
    const { entitlements } = resolve({
      plan: { key: 'p', version: 1, grants: [grant('identity.users.max', true, 50)] },
      addOns: [{ grants: [grant('identity.users.max', true, 5)] }],
      addOnKeys: ['small'],
    });
    expect(getLimit(org(entitlements), 'identity.users.max')).toBe(50);
  });

  it('unlimited from an add-on dominates a finite plan limit', () => {
    const { entitlements } = resolve({
      plan: { key: 'p', version: 1, grants: [grant('identity.users.max', true, 10)] },
      addOns: [{ grants: [grant('identity.users.max', true, UNLIMITED)] }],
      addOnKeys: ['unlimited-seats'],
    });
    expect(getLimit(org(entitlements), 'identity.users.max')).toBe(UNLIMITED);
  });

  it('an add-on can grant a feature the plan denies', () => {
    const { entitlements } = resolve({
      plan: { key: 'p', version: 1, grants: [grant('identity.sso', false)] },
      addOns: [{ grants: [grant('identity.sso', true)] }],
      addOnKeys: ['sso'],
    });
    expect(hasFeature(org(entitlements), 'identity.sso')).toBe(true);
  });

  it('an organization override replaces outright, including downward', () => {
    const { entitlements } = resolve({
      plan: { key: 'p', version: 1, grants: [grant('identity.users.max', true, 50)] },
      addOns: [{ grants: [grant('identity.users.max', true, 100)] }],
      addOnKeys: ['more'],
      overrides: [grant('identity.users.max', true, 7)],
    });
    // Neither the plan's 50 nor the add-on's 100 survives — an override is
    // absolute, which is what makes a negotiated *smaller* deal expressible.
    expect(getLimit(org(entitlements), 'identity.users.max')).toBe(7);
  });

  it('an override can revoke a feature the plan grants', () => {
    const { entitlements } = resolve({
      plan: { key: 'p', version: 1, grants: [grant('crm.exports', true)] },
      overrides: [grant('crm.exports', false)],
    });
    expect(hasFeature(org(entitlements), 'crm.exports')).toBe(false);
  });

  it('an override grants an enterprise extra without inventing a bespoke plan', () => {
    const base = grantsForLegacyPlan('starter');
    const { entitlements, legacy } = resolve({
      plan: { key: 'starter', version: 1, grants: base },
      overrides: [grant('identity.sso', true), grant('crm.leads.max', true, UNLIMITED)],
    });
    expect(hasFeature(org(entitlements), 'identity.sso')).toBe(true);
    expect(getLimit(org(entitlements), 'crm.leads.max')).toBe(UNLIMITED);
    // The legacy mirror stays in step, so untouched readers see it too.
    expect(legacy.features).toContain('sso');
    expect(legacy.limits.maxLeads).toBe(UNLIMITED);
  });
});

// ─── 7. Plan versioning ───────────────────────────────────────────────────────

describe('plan versioning', () => {
  it('records the pinned version on the snapshot', () => {
    const { entitlements } = resolve({
      plan: { key: 'growth', version: 3, grants: [grant('crm.leads', true)] },
    });
    expect(entitlements.planKey).toBe('growth');
    expect(entitlements.planVersion).toBe(3);
  });

  it('a newer version does not affect a subscription pinned to the older one', () => {
    const v1 = resolve({
      plan: { key: 'growth', version: 1, grants: [grant('identity.users.max', true, 50)] },
    });
    // The admin publishes v2 with a tighter limit.
    const v2 = resolve({
      plan: { key: 'growth', version: 2, grants: [grant('identity.users.max', true, 5)] },
    });

    expect(getLimit(org(v1.entitlements), 'identity.users.max')).toBe(50);
    expect(getLimit(org(v2.entitlements), 'identity.users.max')).toBe(5);
    // A tenant still pinned to v1 keeps 50 — publishing a revision cannot
    // rewrite an active customer's terms.
    expect(v1.entitlements.planVersion).toBe(1);
  });

  it('resolution is deterministic and order-independent', () => {
    const grants = grantsForLegacyPlan('growth');
    const a = resolve({ plan: { key: 'growth', version: 1, grants } });
    const b = resolve({
      plan: { key: 'growth', version: 1, grants: [...grants].reverse() },
    });
    expect(a.entitlements.features).toEqual(b.entitlements.features);
    expect(a.legacy).toEqual(b.legacy);
  });
});

// ─── 8. A new module needs no change to plan resolution ───────────────────────

describe('extensibility — the architectural acceptance criterion', () => {
  /**
   * A module that does not exist in the product, declared entirely here.
   *
   * The point of this test is what it does *not* do: it does not import,
   * modify or extend the resolver, the plan model, the entitlement API or the
   * admin surface. If adding a module ever requires touching plan resolution,
   * this test is where that shows up.
   */
  const COMMUNICATION_DEFINITIONS = [
    { key: 'communication.whatsapp.send', moduleKey: 'communication', defaultLimit: null, defaultConfig: null },
    { key: 'communication.voice.minutes', moduleKey: 'communication', defaultLimit: null, defaultConfig: null },
    {
      key: 'communication.sender',
      moduleKey: 'communication',
      defaultLimit: null,
      defaultConfig: { provider: 'none' } as Record<string, unknown>,
    },
  ];

  const withCommunication = [...DEFINITIONS, ...COMMUNICATION_DEFINITIONS];

  it('registers and grants a brand-new module through the same resolver', () => {
    const { entitlements } = resolveFrom({
      plan: {
        key: 'growth',
        version: 1,
        grants: [
          ...grantsForLegacyPlan('growth'),
          grant('communication.whatsapp.send', true),
          grant('communication.voice.minutes', true, 2_000),
        ],
      },
      addOns: [],
      addOnKeys: [],
      definitions: withCommunication,
      overrides: [],
    });

    expect(hasFeature(org(entitlements), 'communication.whatsapp.send')).toBe(true);
    expect(getLimit(org(entitlements), 'communication.voice.minutes')).toBe(2_000);
    expect(hasModule(org(entitlements), 'communication')).toBe(true);
    // The pre-existing modules are untouched by the new arrival.
    expect(hasFeature(org(entitlements), 'crm.leads')).toBe(true);
    expect(hasModule(org(entitlements), 'crm')).toBe(true);
  });

  it('a new module is invisible to plans that do not grant it', () => {
    const { entitlements, legacy } = resolveFrom({
      plan: { key: 'starter', version: 1, grants: grantsForLegacyPlan('starter') },
      addOns: [],
      addOnKeys: [],
      definitions: withCommunication,
      overrides: [],
    });

    expect(hasModule(org(entitlements), 'communication')).toBe(false);
    expect(hasFeature(org(entitlements), 'communication.whatsapp.send')).toBe(false);
    // And the legacy mirror is unchanged by a module that has no legacy mapping.
    expect(legacy.features.sort()).toEqual([...PLAN_LIMITS.starter.features].sort());
  });

  it('carries per-feature configuration for a config-kind feature', () => {
    const { entitlements } = resolveFrom({
      plan: {
        key: 'growth',
        version: 1,
        grants: [
          { featureKey: 'communication.sender', enabled: true, limit: null, config: { provider: 'twilio', from: '+100' } },
        ],
      },
      addOns: [],
      addOnKeys: [],
      definitions: withCommunication,
      overrides: [],
    });

    expect(getConfig(org(entitlements), 'communication.sender')).toEqual({
      provider: 'twilio',
      from: '+100',
    });
  });

  it('falls back to a definition default when a grant says nothing', () => {
    const { entitlements } = resolveFrom({
      plan: {
        key: 'growth',
        version: 1,
        grants: [grant('communication.sender', true)],
      },
      addOns: [],
      addOnKeys: [],
      definitions: withCommunication,
      overrides: [],
    });

    expect(getConfig(org(entitlements), 'communication.sender')).toEqual({
      provider: 'none',
    });
  });
});

// ─── 9. Unavailable configuration fails closed ────────────────────────────────

describe('failure behaviour', () => {
  const cases: Array<[string, unknown]> = [
    ['null source', null],
    ['undefined source', undefined],
    ['organization with no snapshot', { entitlements: null }],
    ['snapshot with a malformed feature list', { entitlements: { features: 'nope' } }],
    ['empty object', {}],
  ];

  for (const [name, source] of cases) {
    it(`denies every capability for ${name}`, () => {
      const s = source as never;
      expect(hasFeature(s, 'crm.leads')).toBe(false);
      expect(hasModule(s, 'crm')).toBe(false);
      expect(getConfig(s, 'communication.sender')).toBeNull();
    });

    it(`reports a zero — never unlimited — limit for ${name}`, () => {
      const s = source as never;
      expect(getLimit(s, 'identity.users.max')).toBe(0);
      expect(getLimit(s, 'identity.users.max')).not.toBe(UNLIMITED);
      expect(isWithinLimit(s, 'identity.users.max', 0)).toBe(false);
    });

    it(`refuses a protected action for ${name}`, () => {
      const s = source as never;
      expect(() => assertFeature(s, 'crm.exports', 'Exports')).toThrow(
        /not included in your plan/
      );
      expect(() => assertWithinLimit(s, 'identity.users.max', 0, 'users')).toThrow();
    });
  }

  it('the deny-all snapshot grants nothing', () => {
    const source = org(denyAll());
    expect(hasFeature(source, 'crm.leads')).toBe(false);
    expect(getLimit(source, 'crm.leads.max')).toBe(0);
    expect(denyAll().features).toEqual([]);
    expect(denyAll().modules).toEqual([]);
  });

  it('assertFeature reports 402 so clients can prompt an upgrade', () => {
    try {
      assertFeature(org(denyAll()), 'crm.exports', 'Exports');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as { statusCode: number }).statusCode).toBe(402);
      expect((error as { code: string }).code).toBe('FEATURE_NOT_ENTITLED');
    }
  });
});

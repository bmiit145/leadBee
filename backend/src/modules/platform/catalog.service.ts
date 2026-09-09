import { Types } from 'mongoose';
import { CatalogModule } from '../../models/CatalogModule.js';
import { FeatureDefinition } from '../../models/FeatureDefinition.js';
import { Plan, PLAN_STATUSES, type PlanStatus } from '../../models/Plan.js';
import { AddOn } from '../../models/AddOn.js';
import { Organization } from '../../models/Organization.js';
import { AppError } from '../../lib/errors.js';
import { resyncOrganization } from '../../entitlements/subscription.service.js';
import type { FeatureGrant } from '../../entitlements/types.js';

/**
 * The plan catalogue, as the control plane sees it.
 *
 * Everything here is deliberately cross-tenant: the catalogue is platform data,
 * shared by every tenant. The platform routes already run unscoped, so no
 * `withoutTenantScope` wrapper is needed — these models are not tenant-owned.
 */

export interface PlanInput {
  key: string;
  name: string;
  description?: string;
  status?: PlanStatus;
  isPublic?: boolean;
  sortOrder?: number;
  trialDays?: number;
  grants: FeatureGrant[];
}

export const catalogService = {
  /**
   * Modules with their features — everything the plan builder needs to render.
   *
   * This is what makes a new module appear as checkboxes without a frontend
   * deploy: the console renders whatever this returns.
   */
  async catalog() {
    const [modules, features] = await Promise.all([
      CatalogModule.find({ isActive: true }).sort({ sortOrder: 1, key: 1 }).lean(),
      FeatureDefinition.find({ isActive: true }).sort({ sortOrder: 1, key: 1 }).lean(),
    ]);

    return modules.map((module) => ({
      key: module.key,
      name: module.name,
      description: module.description,
      sortOrder: module.sortOrder,
      features: features
        .filter((f) => f.moduleKey === module.key)
        .map((f) => ({
          key: f.key,
          name: f.name,
          description: f.description,
          kind: f.kind,
          defaultLimit: f.defaultLimit ?? null,
          defaultConfig: f.defaultConfig ?? null,
        })),
    }));
  },

  /** Every plan's newest version, for the plan list and selectors. */
  async listPlans(includeAllVersions = false) {
    const plans = await Plan.find({}).sort({ sortOrder: 1, key: 1, version: -1 }).lean();
    if (includeAllVersions) return plans;

    const newest = new Map<string, (typeof plans)[number]>();
    for (const plan of plans) {
      if (!newest.has(plan.key)) newest.set(plan.key, plan);
    }
    return [...newest.values()].sort(
      (a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key)
    );
  },

  async getPlan(key: string, version?: number) {
    const plan = version
      ? await Plan.findOne({ key, version })
      : await Plan.findOne({ key }).sort({ version: -1 });
    if (!plan) throw AppError.notFound(`Plan "${key}" not found`);
    return plan;
  },

  /** Create a brand-new plan at version 1. */
  async createPlan(input: PlanInput, createdBy?: Types.ObjectId) {
    const existing = await Plan.exists({ key: input.key });
    if (existing) {
      throw AppError.conflict(
        `A plan with key "${input.key}" already exists. Publish a revision instead.`,
        { planKey: input.key }
      );
    }
    await assertGrantsAreKnown(input.grants);

    return Plan.create({
      ...input,
      version: 1,
      status: input.status ?? PLAN_STATUSES.DRAFT,
      createdBy,
    });
  },

  /**
   * Publish the next version of a plan.
   *
   * Never mutates the current one. Tenants stay pinned to the version they were
   * sold until someone migrates them explicitly, so publishing cannot rewrite an
   * active customer's terms (requirement 11).
   */
  async publishRevision(key: string, input: Omit<PlanInput, 'key'>, createdBy?: Types.ObjectId) {
    const current = await Plan.findOne({ key }).sort({ version: -1 });
    if (!current) throw AppError.notFound(`Plan "${key}" not found`);
    await assertGrantsAreKnown(input.grants);

    return Plan.create({
      key,
      version: current.version + 1,
      name: input.name ?? current.name,
      description: input.description ?? current.description,
      status: input.status ?? PLAN_STATUSES.ACTIVE,
      isPublic: input.isPublic ?? current.isPublic,
      sortOrder: input.sortOrder ?? current.sortOrder,
      trialDays: input.trialDays ?? current.trialDays,
      grants: input.grants,
      createdBy,
    });
  },

  async setPlanStatus(key: string, version: number, status: PlanStatus) {
    const plan = await Plan.findOneAndUpdate({ key, version }, { status }, { new: true });
    if (!plan) throw AppError.notFound(`Plan "${key}" version ${version} not found`);
    return plan;
  },

  /** How many tenants sit on each plan version — shown before a risky edit. */
  async planUsage(key: string) {
    const rows = await Organization.aggregate<{ _id: number; count: number }>([
      { $match: { 'subscription.planKey': key } },
      { $group: { _id: '$subscription.planVersion', count: { $sum: 1 } } },
    ]);
    return rows.map((r) => ({ version: r._id, organizations: r.count }));
  },

  async listAddOns() {
    return AddOn.find({}).sort({ key: 1 }).lean();
  },

  async createAddOn(input: {
    key: string;
    name: string;
    description?: string;
    grants: FeatureGrant[];
  }) {
    const existing = await AddOn.exists({ key: input.key });
    if (existing) {
      throw AppError.conflict(`An add-on with key "${input.key}" already exists.`);
    }
    await assertGrantsAreKnown(input.grants);
    return AddOn.create(input);
  },

  /**
   * Set a tenant's add-ons and per-organization overrides, then re-resolve.
   *
   * The enterprise escape hatch: a negotiated deal is expressed here rather than
   * by minting a bespoke plan that then has to be maintained forever.
   */
  async setOrganizationEntitlements(
    organizationId: string,
    input: { addOnKeys?: string[]; overrides?: FeatureGrant[] }
  ) {
    const organization = await Organization.findById(organizationId);
    if (!organization) throw AppError.notFound('Organization not found');
    if (input.overrides) await assertGrantsAreKnown(input.overrides);

    if (input.addOnKeys) organization.subscription.addOnKeys = input.addOnKeys;
    if (input.overrides) organization.subscription.overrides = input.overrides;

    await resyncOrganization(organization);
    await organization.save();
    return organization;
  },

  /** Re-resolve against the pinned version — for picking up an add-on edit. */
  async resync(organizationId: string) {
    const organization = await Organization.findById(organizationId);
    if (!organization) throw AppError.notFound('Organization not found');
    await resyncOrganization(organization);
    await organization.save();
    return organization;
  },

  /** Move a tenant onto a specific plan version. An explicit migration. */
  async migrateToVersion(organizationId: string, version: number) {
    const organization = await Organization.findById(organizationId);
    if (!organization) throw AppError.notFound('Organization not found');

    const plan = await Plan.findOne({ key: organization.subscription.planKey, version });
    if (!plan) {
      throw AppError.notFound(
        `Plan "${organization.subscription.planKey}" version ${version} not found`
      );
    }

    organization.subscription.planVersion = version;
    await resyncOrganization(organization);
    await organization.save();
    return organization;
  },
};

/**
 * Refuse grants naming features that do not exist.
 *
 * The resolver drops unknown keys anyway, so this is not a safety check — it is
 * a usability one. Silently discarding a typo'd key would let an admin save a
 * plan, see no error, and discover months later that a feature they believed
 * they had sold was never granted.
 */
async function assertGrantsAreKnown(grants: FeatureGrant[]): Promise<void> {
  if (grants.length === 0) return;
  const keys = [...new Set(grants.map((g) => g.featureKey))];
  const known = await FeatureDefinition.find({ key: { $in: keys } }).select('key').lean();
  const knownKeys = new Set(known.map((k) => k.key));
  const unknown = keys.filter((k) => !knownKeys.has(k));

  if (unknown.length > 0) {
    throw AppError.badRequest(
      `Unknown feature key(s): ${unknown.join(', ')}. Features must be registered by a module manifest.`,
      { unknown }
    );
  }
}

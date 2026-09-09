/**
 * The one place a subscription is changed and entitlements are re-resolved.
 *
 * Centralised deliberately. Entitlements are a *snapshot*, and a snapshot that
 * some call sites refresh and others do not is worse than no snapshot at all —
 * a tenant silently left on stale terms is invisible until they complain. Every
 * path that changes what a tenant is entitled to goes through `applySubscription`
 * or `resyncOrganization`.
 */

import { Plan, ASSIGNABLE_PLAN_STATUSES, type IPlan } from '../models/Plan.js';
import type { IOrganization } from '../models/Organization.js';
import { AppError } from '../lib/errors.js';
import { resolveEntitlements, type SubscriptionInput } from './resolver.js';
import type { FeatureGrant } from './types.js';

export interface ApplySubscriptionInput {
  planKey: string;
  /** Omit to pin the newest assignable version — the normal case. */
  planVersion?: number;
  addOnKeys?: string[];
  overrides?: FeatureGrant[];
}

/**
 * The newest version of a plan that may be sold.
 *
 * `grandfathered` and `retired` versions are honoured for tenants already on
 * them but never picked up for a new or changed subscription.
 */
export async function latestAssignablePlan(planKey: string): Promise<IPlan> {
  const plan = await Plan.findOne({
    key: planKey,
    status: { $in: ASSIGNABLE_PLAN_STATUSES },
  })
    .sort({ version: -1 })
    .exec();

  if (!plan) {
    throw AppError.badRequest(
      `No assignable plan named "${planKey}". Create or activate it first.`,
      { planKey }
    );
  }
  return plan;
}

/**
 * Resolve a subscription and write it, with its snapshot and legacy mirrors,
 * onto the organization. **Does not save** — the caller owns the write, so this
 * can participate in the provisioning transaction.
 *
 * Throws before touching the organization if resolution fails, which leaves the
 * tenant on the entitlements they already had rather than revoking access
 * because the catalogue hiccuped.
 */
export async function applySubscription(
  organization: IOrganization,
  input: ApplySubscriptionInput
): Promise<void> {
  const planVersion =
    input.planVersion ?? (await latestAssignablePlan(input.planKey)).version;

  const subscription: SubscriptionInput = {
    planKey: input.planKey,
    planVersion,
    addOnKeys: input.addOnKeys ?? organization.subscription?.addOnKeys ?? [],
    overrides: input.overrides ?? organization.subscription?.overrides ?? [],
  };

  const { entitlements, legacy } = await resolveEntitlements(subscription);

  organization.subscription = {
    planKey: subscription.planKey,
    planVersion: subscription.planVersion,
    addOnKeys: subscription.addOnKeys ?? [],
    overrides: subscription.overrides ?? [],
  };
  organization.entitlements = entitlements;

  // Legacy mirrors — every current reader still goes through these.
  organization.plan = subscription.planKey;
  organization.features = legacy.features;
  organization.limits = legacy.limits;
}

/**
 * Re-resolve an organization against its *pinned* version.
 *
 * For picking up an add-on or override edit. It deliberately does **not** move
 * the tenant to a newer plan version — that is a migration, and a separate,
 * explicit decision.
 */
export async function resyncOrganization(organization: IOrganization): Promise<void> {
  const current = organization.subscription;
  if (!current?.planKey) {
    throw AppError.badRequest('Organization has no subscription to resync');
  }
  await applySubscription(organization, {
    planKey: current.planKey,
    planVersion: current.planVersion,
    addOnKeys: current.addOnKeys,
    overrides: current.overrides,
  });
}

import mongoose, { Types, type ClientSession } from 'mongoose';
import { Organization, type IOrganization } from '../../models/Organization.js';
import { User, type IUser } from '../../models/User.js';
import { Account } from '../../models/Account.js';
import { Role } from '../../models/Role.js';
import { PurposeOfInquiry } from '../../models/PurposeOfInquiry.js';
import { LeadDropReason } from '../../models/LeadDropReason.js';
import { AppError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { supportsTransactions } from '../../lib/transactions.js';
import { runInTenantScope, withoutTenantScope } from '../../lib/tenantContext.js';
import {
  DEFAULT_ROLE_PERMISSIONS,
  ORG_STATUSES,
  PLANS,
  ROLES,
  ROLE_ORDER,
} from '../../config/constants.js';
import { resolveEntitlements } from '../../entitlements/resolver.js';
import {
  applySubscription,
  latestAssignablePlan,
} from '../../entitlements/subscription.service.js';
import { assertWithinLimit, UNLIMITED } from '../../entitlements/index.js';
import type { FeatureGrant } from '../../entitlements/types.js';
import {
  identityConflict,
  identityService,
  membershipCopy,
} from '../accounts/identity.service.js';

export interface ProvisionInput {
  organizationName: string;
  slug?: string;
  ownerName: string;
  ownerPhone: string;
  /** Required: the owner signs in with it, and it is half of who they are. */
  ownerEmail: string;
  /** Needed only when the owner is new to LeadBee. */
  ownerPassword?: string;
  /**
   * Self-serve signup sets this: when the email and mobile already have an
   * account, whoever filled in the form must know its password before an
   * organization is created in that person's name.
   */
  requireOwnerPassword?: boolean;
  /** Catalogue plan key. Validated against the catalogue, not a compiled list. */
  plan?: string;
  source: 'self_serve' | 'platform_provisioned';
  provisionedBy?: Types.ObjectId;
  /** Platform-provisioned orgs can start active rather than trialing. */
  status?: (typeof ORG_STATUSES)[keyof typeof ORG_STATUSES];
}

export interface ProvisionResult {
  organization: IOrganization;
  owner: IUser;
  /** False when the owner already had an account and it was linked. */
  ownerAccountCreated: boolean;
}

/** Default meeting purposes, so a new tenant's dropdown is not empty on day one. */
const STARTER_PURPOSES = [
  'Product Demo',
  'Requirement Discussion',
  'Price Negotiation',
  'Documentation',
  'Follow-up',
];

/** Default drop tags, for the same reason. Organizers rename or retire them freely. */
const STARTER_DROP_REASONS = [
  'Not interested',
  'Budget mismatch',
  'Bought elsewhere',
  'Not reachable',
  'Duplicate lead',
];

export const organizationService = {
  /**
   * Create a tenant and everything it needs to be usable: its role set, its
   * owner's membership (linked to the owner's account, created if needed), and a
   * few starter lookups.
   *
   * Shared by both onboarding paths — self-serve signup and platform
   * provisioning — so the two cannot drift into producing differently-shaped
   * tenants.
   *
   * Runs in a transaction where the deployment supports one. A half-provisioned
   * tenant — an organization row with no owner — cannot be signed into and
   * cannot be cleaned up by the customer, so partial success is not an
   * acceptable outcome. Transactions need a replica set; against a standalone
   * mongod this falls back to explicit compensating deletes, which is weaker
   * but still leaves nothing behind.
   */
  async provision(input: ProvisionInput): Promise<ProvisionResult> {
    const slug = normalizeSlug(input.slug ?? input.organizationName);
    await assertSlugAvailable(slug);

    // Checked before anything is written, so a taken email or mobile is a clean
    // 409 rather than a provisioning that rolls back. The check repeats inside
    // the write, which is the authoritative one.
    const { resolution } = await identityService.lookupIdentity(
      input.ownerEmail,
      input.ownerPhone.trim()
    );
    if (resolution.kind === 'conflict') throw identityConflict(resolution.reason);
    if (resolution.kind === 'new' && !input.ownerPassword) {
      throw AppError.badRequest('A password is required to create the owner’s account.');
    }

    if (await supportsTransactions()) {
      return provisionTransactionally(input, slug);
    }

    logger.warn(
      { slug },
      'provisioning without a transaction — standalone mongod. ' +
        'Run against a replica set in production.'
    );
    return provisionWithCompensation(input, slug);
  },

  /**
   * Move a tenant to another plan and re-copy the ceilings.
   *
   * Downgrading below current usage is refused rather than silently leaving the
   * tenant over-limit — the customer should be told to remove users first, not
   * discover it the next time someone tries to log in.
   */
  async changePlan(
    organizationId: Types.ObjectId,
    planKey: string
  ): Promise<IOrganization> {
    const organization = await Organization.findById(organizationId);
    if (!organization) throw AppError.notFound('Organization not found');

    // Resolve onto the document first, then validate. A throw below leaves the
    // mutation unsaved and the tenant on exactly the terms they had.
    await applySubscription(organization, { planKey });

    const seatLimit = organization.limits.maxUsers;
    if (seatLimit !== UNLIMITED && organization.usage.users > seatLimit) {
      throw AppError.conflict(
        `This organization has ${organization.usage.users} users; the ${planKey} plan allows ${seatLimit}. ` +
          'Deactivate users before downgrading.',
        { currentUsers: organization.usage.users, planMaxUsers: seatLimit }
      );
    }

    // A paid plan ends the trial clock.
    if (planKey !== PLANS.TRIAL && organization.status === ORG_STATUSES.TRIALING) {
      organization.status = ORG_STATUSES.ACTIVE;
      organization.trialEndsAt = undefined;
    }
    await organization.save();
    return organization;
  },

  /** Ceiling check before creating a user. */
  async assertCanAddUser(organization: IOrganization): Promise<void> {
    assertSeatOrRecordLimit(organization, 'identity.users.max', 'maxUsers', 'users');
  },

  /** Ceiling check before creating a lead. */
  async assertCanAddLead(organization: IOrganization): Promise<void> {
    assertSeatOrRecordLimit(organization, 'crm.leads.max', 'maxLeads', 'leads');
  },

  async isSlugAvailable(slug: string): Promise<boolean> {
    const normalized = normalizeSlug(slug);
    const existing = await withoutTenantScope('signup: slug availability', () =>
      Organization.exists({ slug: normalized })
    );
    return existing === null;
  },
};

// ─── Provisioning internals ───────────────────────────────────────────────────

/**
 * Ceiling check, preferring the entitlement snapshot and falling back to the
 * legacy mirror.
 *
 * The fallback is transitional and deliberate. An organization provisioned
 * before the entitlement system carries no snapshot, and reading that as
 * "denied" would stop an existing customer adding a user — a regression, not a
 * safe default. The mirror holds that tenant's real, previously-correct
 * ceiling, so falling back to it is never "unlimited by default".
 *
 * Removed once every organization is backfilled. See
 * docs/adr/0001-entitlement-system.md.
 */
function assertSeatOrRecordLimit(
  organization: IOrganization,
  featureKey: string,
  legacyLimitKey: 'maxUsers' | 'maxLeads',
  label: 'users' | 'leads'
): void {
  const current =
    label === 'users' ? organization.usage.users : organization.usage.leads;

  if (organization.entitlements) {
    assertWithinLimit(organization, featureKey, current, label);
    return;
  }

  const limit = organization.limits[legacyLimitKey];
  if (limit === UNLIMITED) return;
  if (current >= limit) {
    throw AppError.planLimit(
      `The ${organization.plan} plan allows ${limit} ${label}. Upgrade to add more.`,
      { limit, current }
    );
  }
}

/**
 * The organization document fields, derived from the catalogue and the input.
 *
 * Async now: the plan and its entitlements come from the database rather than a
 * compiled table, so the ceilings a new tenant gets are whatever the admin
 * console currently says they are.
 */
async function organizationFields(input: ProvisionInput, slug: string) {
  const planKey = input.plan ?? PLANS.TRIAL;
  const plan = await latestAssignablePlan(planKey);
  const status = input.status ?? ORG_STATUSES.TRIALING;

  const subscription = {
    planKey,
    planVersion: plan.version,
    addOnKeys: [] as string[],
    overrides: [] as FeatureGrant[],
  };
  const { entitlements, legacy } = await resolveEntitlements(subscription);

  // Trial length comes from the plan, not from a global environment variable —
  // it is a commercial term, and different plans and campaigns need different
  // ones. `0` means the plan grants no trial.
  const trialEndsAt =
    status === ORG_STATUSES.TRIALING && plan.trialDays > 0
      ? new Date(Date.now() + plan.trialDays * 24 * 60 * 60 * 1000)
      : undefined;

  return {
    name: input.organizationName.trim(),
    slug,
    status,
    plan: planKey,
    subscription,
    entitlements,
    limits: legacy.limits,
    features: legacy.features,
    trialEndsAt,
    billingEmail: input.ownerEmail,
    contactPhone: input.ownerPhone,
    signupSource: input.source,
    provisionedBy: input.provisionedBy,
    usage: { users: 1, leads: 0, lastActivityAt: new Date() },
  };
}

function ownerAccount(input: ProvisionInput, session?: ClientSession) {
  return identityService.ensureAccountForMembership(
    {
      name: input.ownerName.trim(),
      email: input.ownerEmail,
      phone: input.ownerPhone.trim(),
      password: input.ownerPassword,
    },
    { session, requirePasswordOfExisting: input.requireOwnerPassword }
  );
}

async function provisionTransactionally(
  input: ProvisionInput,
  slug: string
): Promise<ProvisionResult> {
  // Resolved before the session opens: it reads the platform catalogue, which
  // is unrelated to the documents in this transaction, and doing it inside
  // would hold the transaction open across reads that cannot fail it.
  const fields = await organizationFields(input, slug);

  const session = await mongoose.startSession();
  try {
    let result: ProvisionResult | undefined;

    await session.withTransaction(async () => {
      const [organization] = await Organization.create([fields], { session });

      // The account is created (or linked) in the same transaction, so a
      // failure below cannot leave a person with no organization behind.
      const owner = await ownerAccount(input, session);

      result = await runInTenantScope(
        {
          organizationId: organization!._id,
          userId: new Types.ObjectId(),
          role: ROLES.OWNER,
          permissions: ['*'],
        },
        async () => {
          const roles = await Role.insertMany(
            ROLE_ORDER.map((role) => ({
              organizationId: organization!._id,
              name: role,
              description: `Built-in ${role} role`,
              permissions: DEFAULT_ROLE_PERMISSIONS[role],
              isSystem: true,
            })),
            { session }
          );
          const ownerRole = roles.find((r) => r.name === ROLES.OWNER)!;

          const [membership] = await User.create(
            [
              {
                organizationId: organization!._id,
                accountId: owner.account._id,
                ...membershipCopy(owner.account),
                role: ROLES.OWNER,
                roleId: ownerRole._id,
                permissions: [],
                isActive: true,
              },
            ],
            { session }
          );

          await PurposeOfInquiry.insertMany(
            STARTER_PURPOSES.map((name, index) => ({
              organizationId: organization!._id,
              name,
              createdBy: membership!._id,
              sortOrder: index,
            })),
            { session }
          );

          await LeadDropReason.insertMany(
            STARTER_DROP_REASONS.map((name, index) => ({
              organizationId: organization!._id,
              name,
              createdBy: membership!._id,
              sortOrder: index,
            })),
            { session }
          );

          return {
            organization: organization!,
            owner: membership!,
            ownerAccountCreated: owner.created,
          };
        }
      );
    });

    return result!;
  } finally {
    await session.endSession();
  }
}

/** Fallback for a standalone mongod: create, and undo by hand on failure. */
async function provisionWithCompensation(
  input: ProvisionInput,
  slug: string
): Promise<ProvisionResult> {
  const organization = await Organization.create(await organizationFields(input, slug));
  let createdAccountId: Types.ObjectId | undefined;

  try {
    const owner = await ownerAccount(input);
    if (owner.created) createdAccountId = owner.account._id;

    return await runInTenantScope(
      {
        organizationId: organization._id,
        userId: new Types.ObjectId(),
        role: ROLES.OWNER,
        permissions: ['*'],
      },
      async () => {
        const roles = await Role.insertMany(
          ROLE_ORDER.map((role) => ({
            organizationId: organization._id,
            name: role,
            description: `Built-in ${role} role`,
            permissions: DEFAULT_ROLE_PERMISSIONS[role],
            isSystem: true,
          }))
        );
        const ownerRole = roles.find((r) => r.name === ROLES.OWNER)!;

        const membership = await User.create({
          organizationId: organization._id,
          accountId: owner.account._id,
          ...membershipCopy(owner.account),
          role: ROLES.OWNER,
          roleId: ownerRole._id,
          permissions: [],
          isActive: true,
        });

        await PurposeOfInquiry.insertMany(
          STARTER_PURPOSES.map((name, index) => ({
            organizationId: organization._id,
            name,
            createdBy: membership._id,
            sortOrder: index,
          }))
        );

        await LeadDropReason.insertMany(
          STARTER_DROP_REASONS.map((name, index) => ({
            organizationId: organization._id,
            name,
            createdBy: membership._id,
            sortOrder: index,
          }))
        );

        return { organization, owner: membership, ownerAccountCreated: owner.created };
      }
    );
  } catch (error) {
    logger.error({ err: error, slug }, 'provisioning failed — compensating');
    await rollback(organization._id, createdAccountId);
    throw error;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** `Acme Realty Pvt. Ltd.` → `acme-realty-pvt-ltd` */
export function normalizeSlug(input: string): string {
  const slug = input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
    .replace(/-+$/g, '');

  if (slug.length < 3) {
    throw AppError.badRequest(
      'Organization name must contain at least 3 alphanumeric characters'
    );
  }
  return slug;
}

async function assertSlugAvailable(slug: string): Promise<void> {
  const existing = await withoutTenantScope('provisioning: slug uniqueness', () =>
    Organization.exists({ slug })
  );
  if (existing) {
    throw AppError.conflict(`The handle "${slug}" is already taken`, { slug });
  }
}

async function rollback(
  organizationId: Types.ObjectId,
  createdAccountId?: Types.ObjectId
): Promise<void> {
  try {
    await runInTenantScope(
      {
        organizationId,
        userId: new Types.ObjectId(),
        role: ROLES.OWNER,
        permissions: ['*'],
      },
      async () => {
        await Promise.all([
          User.deleteMany({}),
          Role.deleteMany({}),
          PurposeOfInquiry.deleteMany({}),
          LeadDropReason.deleteMany({}),
        ]);
      }
    );
    await Organization.deleteOne({ _id: organizationId });
    // Only an account this provisioning created; a linked existing person keeps theirs.
    if (createdAccountId) await Account.deleteOne({ _id: createdAccountId });
  } catch (cleanupError) {
    // Surfacing this matters more than rethrowing: the original failure is what
    // the caller needs, but an orphaned tenant needs someone to go look.
    logger.error(
      { err: cleanupError, organizationId: organizationId.toString() },
      'ROLLBACK FAILED — orphaned organization needs manual cleanup'
    );
  }
}

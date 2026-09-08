import mongoose, { Types } from 'mongoose';
import { Organization, type IOrganization } from '../../models/Organization.js';
import { User, type IUser } from '../../models/User.js';
import { Role } from '../../models/Role.js';
import { PurposeOfInquiry } from '../../models/PurposeOfInquiry.js';
import { AppError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { runInTenantScope, withoutTenantScope } from '../../lib/tenantContext.js';
import {
  DEFAULT_ROLE_PERMISSIONS,
  ORG_STATUSES,
  PLANS,
  PLAN_LIMITS,
  ROLES,
  ROLE_ORDER,
  type Plan,
} from '../../config/constants.js';
import { env } from '../../config/env.js';

export interface ProvisionInput {
  organizationName: string;
  slug?: string;
  ownerName: string;
  ownerPhone: string;
  ownerEmail?: string;
  ownerPassword: string;
  plan?: Plan;
  source: 'self_serve' | 'platform_provisioned';
  provisionedBy?: Types.ObjectId;
  /** Platform-provisioned orgs can start active rather than trialing. */
  status?: (typeof ORG_STATUSES)[keyof typeof ORG_STATUSES];
}

export interface ProvisionResult {
  organization: IOrganization;
  owner: IUser;
}

/** Default meeting purposes, so a new tenant's dropdown is not empty on day one. */
const STARTER_PURPOSES = [
  'Product Demo',
  'Requirement Discussion',
  'Price Negotiation',
  'Documentation',
  'Follow-up',
];

export const organizationService = {
  /**
   * Create a tenant and everything it needs to be usable: its role set, its
   * first user, and a few starter lookups.
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
  async changePlan(organizationId: Types.ObjectId, plan: Plan): Promise<IOrganization> {
    const organization = await Organization.findById(organizationId);
    if (!organization) throw AppError.notFound('Organization not found');

    const limits = PLAN_LIMITS[plan];
    if (limits.maxUsers !== -1 && organization.usage.users > limits.maxUsers) {
      throw AppError.conflict(
        `This organization has ${organization.usage.users} users; the ${plan} plan allows ${limits.maxUsers}. ` +
          'Deactivate users before downgrading.',
        { currentUsers: organization.usage.users, planMaxUsers: limits.maxUsers }
      );
    }

    organization.plan = plan;
    organization.limits = {
      maxUsers: limits.maxUsers,
      maxLeads: limits.maxLeads,
      maxMonthlyApiCalls: limits.maxMonthlyApiCalls,
    };
    organization.features = [...limits.features];
    // A paid plan ends the trial clock.
    if (plan !== PLANS.TRIAL && organization.status === ORG_STATUSES.TRIALING) {
      organization.status = ORG_STATUSES.ACTIVE;
      organization.trialEndsAt = undefined;
    }
    await organization.save();
    return organization;
  },

  /** Ceiling check before creating a user. */
  async assertCanAddUser(organization: IOrganization): Promise<void> {
    if (organization.limits.maxUsers === -1) return;
    if (organization.usage.users >= organization.limits.maxUsers) {
      throw AppError.planLimit(
        `The ${organization.plan} plan allows ${organization.limits.maxUsers} users. Upgrade to add more.`,
        { limit: organization.limits.maxUsers, current: organization.usage.users }
      );
    }
  },

  /** Ceiling check before creating a lead. */
  async assertCanAddLead(organization: IOrganization): Promise<void> {
    if (organization.limits.maxLeads === -1) return;
    if (organization.usage.leads >= organization.limits.maxLeads) {
      throw AppError.planLimit(
        `The ${organization.plan} plan allows ${organization.limits.maxLeads} leads. Upgrade to add more.`,
        { limit: organization.limits.maxLeads, current: organization.usage.leads }
      );
    }
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

/** The organization document fields, derived from the plan and the input. */
function organizationFields(input: ProvisionInput, slug: string) {
  const plan = input.plan ?? PLANS.TRIAL;
  const limits = PLAN_LIMITS[plan];
  const status = input.status ?? ORG_STATUSES.TRIALING;

  return {
    name: input.organizationName.trim(),
    slug,
    status,
    plan,
    limits: {
      maxUsers: limits.maxUsers,
      maxLeads: limits.maxLeads,
      maxMonthlyApiCalls: limits.maxMonthlyApiCalls,
    },
    features: [...limits.features],
    trialEndsAt:
      status === ORG_STATUSES.TRIALING
        ? new Date(Date.now() + env.TRIAL_DAYS * 24 * 60 * 60 * 1000)
        : undefined,
    billingEmail: input.ownerEmail,
    contactPhone: input.ownerPhone,
    signupSource: input.source,
    provisionedBy: input.provisionedBy,
    usage: { users: 1, leads: 0, lastActivityAt: new Date() },
  };
}

/**
 * Does this deployment support multi-document transactions?
 *
 * True only on a replica set or sharded cluster. Probed once and cached — the
 * answer cannot change without a reconnect, and asking on every signup would
 * add a round trip to the slowest endpoint in the product.
 */
let transactionSupport: boolean | undefined;

async function supportsTransactions(): Promise<boolean> {
  if (transactionSupport !== undefined) return transactionSupport;
  try {
    const admin = mongoose.connection.db?.admin();
    const info = await admin?.command({ hello: 1 });
    // `setName` is present only on a replica set member; `msg: 'isdbgrid'`
    // identifies a mongos in front of a sharded cluster.
    transactionSupport = Boolean(info?.setName) || info?.msg === 'isdbgrid';
  } catch {
    transactionSupport = false;
  }
  return transactionSupport;
}

async function provisionTransactionally(
  input: ProvisionInput,
  slug: string
): Promise<ProvisionResult> {
  const session = await mongoose.startSession();
  try {
    let result: ProvisionResult | undefined;

    await session.withTransaction(async () => {
      const [organization] = await Organization.create(
        [organizationFields(input, slug)],
        { session }
      );

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

          const [owner] = await User.create(
            [
              {
                organizationId: organization!._id,
                name: input.ownerName.trim(),
                phone: input.ownerPhone.trim(),
                email: input.ownerEmail,
                password: input.ownerPassword,
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
              createdBy: owner!._id,
              sortOrder: index,
            })),
            { session }
          );

          return { organization: organization!, owner: owner! };
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
  const organization = await Organization.create(organizationFields(input, slug));

  try {
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

        const owner = await User.create({
          organizationId: organization._id,
          name: input.ownerName.trim(),
          phone: input.ownerPhone.trim(),
          email: input.ownerEmail,
          password: input.ownerPassword,
          role: ROLES.OWNER,
          roleId: ownerRole._id,
          permissions: [],
          isActive: true,
        });

        await PurposeOfInquiry.insertMany(
          STARTER_PURPOSES.map((name, index) => ({
            organizationId: organization._id,
            name,
            createdBy: owner._id,
            sortOrder: index,
          }))
        );

        return { organization, owner };
      }
    );
  } catch (error) {
    logger.error({ err: error, slug }, 'provisioning failed — compensating');
    await rollback(organization._id);
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

async function rollback(organizationId: Types.ObjectId): Promise<void> {
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
        ]);
      }
    );
    await Organization.deleteOne({ _id: organizationId });
  } catch (cleanupError) {
    // Surfacing this matters more than rethrowing: the original failure is what
    // the caller needs, but an orphaned tenant needs someone to go look.
    logger.error(
      { err: cleanupError, organizationId: organizationId.toString() },
      'ROLLBACK FAILED — orphaned organization needs manual cleanup'
    );
  }
}

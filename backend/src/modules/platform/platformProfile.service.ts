import { Types } from 'mongoose';
import { Organization } from '../../models/Organization.js';
import { User } from '../../models/User.js';
import type { IPlatformAdmin } from '../../models/PlatformAdmin.js';
import { ROLES, type Role } from '../../config/constants.js';
import { AppError } from '../../lib/errors.js';
import { runInTenantScope } from '../../lib/tenantContext.js';
import { identityService } from '../accounts/identity.service.js';
import { recordPlatformAction } from './platform.service.js';

export interface OrganizationProfileUpdate {
  organizationName?: string;
  slug?: string;
  billingEmail?: string | null;
  contactPhone?: string | null;
  ownerName?: string;
  ownerPhone?: string;
  ownerEmail?: string | null;
}

export interface UserProfileUpdate {
  name?: string;
  phone?: string;
  email?: string | null;
  designation?: string | null;
  role?: Role;
  password?: string;
}

/**
 * Platform edits to a tenant's profile and people.
 *
 * Name, email, mobile and password belong to the person's account, so a
 * platform admin changing them changes them everywhere that person is a member
 * — which is the platform's authority to exercise, unlike a single
 * organization's admin (see `identityService.assertSoleMembership`). Role and
 * designation stay on the membership. See ADR-0004.
 */

/** A tenant scope for platform work inside one organization: no tenant user is acting. */
function platformScope(organizationId: Types.ObjectId) {
  return {
    organizationId,
    userId: new Types.ObjectId(),
    role: 'platform',
    permissions: ['*'],
  };
}

export async function updateOrganizationProfile(
  organizationId: string,
  input: OrganizationProfileUpdate,
  admin: IPlatformAdmin,
  context: { ip?: string; userAgent?: string } = {}
) {
  const orgObjectId = new Types.ObjectId(organizationId);
  const organization = await Organization.findById(orgObjectId);
  if (!organization) throw AppError.notFound('Organization not found');

  if (input.ownerEmail === null) {
    throw AppError.badRequest('The owner needs an email — it is how they sign in.');
  }

  const before = {
    name: organization.name,
    slug: organization.slug,
    billingEmail: organization.billingEmail,
    contactPhone: organization.contactPhone,
  };

  if (input.slug !== undefined && input.slug !== organization.slug) {
    const existing = await Organization.findOne({
      slug: input.slug,
      _id: { $ne: orgObjectId },
    }).lean();
    if (existing) {
      throw AppError.conflict(`The handle "${input.slug}" is already taken`, {
        slug: input.slug,
      });
    }
    organization.slug = input.slug;
  }

  if (input.organizationName !== undefined) organization.name = input.organizationName;
  if (input.billingEmail !== undefined) organization.billingEmail = input.billingEmail ?? undefined;
  if (input.contactPhone !== undefined) organization.contactPhone = input.contactPhone ?? undefined;

  const scope = platformScope(orgObjectId);
  const ownerAccountId = await runInTenantScope(scope, async () => {
    const found = await User.findOne({ role: ROLES.OWNER }).select('accountId');
    if (!found) throw AppError.notFound('Organization owner not found');
    return found.accountId;
  });

  // Identity first: a taken email or mobile must refuse the whole edit, not
  // leave the organization renamed and the owner unchanged.
  if (
    input.ownerName !== undefined ||
    input.ownerPhone !== undefined ||
    input.ownerEmail !== undefined
  ) {
    await identityService.updateIdentity(ownerAccountId, {
      name: input.ownerName,
      phone: input.ownerPhone,
      email: input.ownerEmail ?? undefined,
    });
  }

  await organization.save();

  const owner = await runInTenantScope(scope, async () => {
    const found = await User.findOne({ accountId: ownerAccountId });
    if (!found) throw AppError.notFound('Organization owner not found');
    return found;
  });

  await recordPlatformAction({
    action: 'org_updated',
    organization,
    admin,
    targetType: 'Organization',
    targetId: organization._id,
    before,
    after: {
      name: organization.name,
      slug: organization.slug,
      billingEmail: organization.billingEmail,
      contactPhone: organization.contactPhone,
      owner: {
        id: owner._id.toString(),
        name: owner.name,
        email: owner.email,
        phone: owner.phone,
      },
    },
    ...context,
  });

  return { ...organization.toJSON(), owner: owner.toJSON() };
}

export async function updateOrganizationUser(
  organizationId: string,
  userId: string,
  input: UserProfileUpdate,
  admin: IPlatformAdmin,
  context: { ip?: string; userAgent?: string } = {}
) {
  const orgObjectId = new Types.ObjectId(organizationId);
  const organization = await Organization.findById(orgObjectId);
  if (!organization) throw AppError.notFound('Organization not found');

  if (input.email === null) {
    throw AppError.badRequest('Email is required — it is how this person signs in.');
  }

  const scope = platformScope(orgObjectId);

  // Read and validate the membership before anything is written.
  const { accountId, before } = await runInTenantScope(scope, async () => {
    const found = await User.findById(userId);
    if (!found) throw AppError.notFound('User not found in this organization');

    if (
      input.role !== undefined &&
      input.role !== found.role &&
      found.role === ROLES.OWNER &&
      input.role !== ROLES.OWNER
    ) {
      const activeOwners = await User.countDocuments({ role: ROLES.OWNER, isActive: true });
      if (activeOwners <= 1) {
        throw AppError.conflict(
          'This is the only active owner. Promote another user to owner first.'
        );
      }
    }

    return {
      accountId: found.accountId,
      before: {
        name: found.name,
        phone: found.phone,
        email: found.email,
        designation: found.designation,
        role: found.role,
      },
    };
  });

  if (input.name !== undefined || input.phone !== undefined || input.email !== undefined) {
    await identityService.updateIdentity(accountId, {
      name: input.name,
      phone: input.phone,
      email: input.email ?? undefined,
    });
  }

  // Ends the person's sessions in every organization, not only this one.
  if (input.password !== undefined) {
    await identityService.setPassword(accountId, input.password);
  }

  const user = await runInTenantScope(scope, async () => {
    const found = await User.findById(userId);
    if (!found) throw AppError.notFound('User not found in this organization');
    if (input.role !== undefined) found.role = input.role;
    if (input.designation !== undefined) found.designation = input.designation ?? undefined;
    await found.save();
    return found;
  });

  await recordPlatformAction({
    action: 'user_updated',
    organization,
    admin,
    targetType: 'User',
    targetId: user._id,
    before,
    after: {
      name: user.name,
      phone: user.phone,
      email: user.email,
      designation: user.designation,
      role: user.role,
      passwordChanged: input.password !== undefined,
    },
    ...context,
  });

  return user;
}

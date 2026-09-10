import { Types } from 'mongoose';
import { Organization } from '../../models/Organization.js';
import { User } from '../../models/User.js';
import type { IPlatformAdmin } from '../../models/PlatformAdmin.js';
import { ROLES, type Role } from '../../config/constants.js';
import { AppError } from '../../lib/errors.js';
import { runInTenantScope } from '../../lib/tenantContext.js';
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

export async function updateOrganizationProfile(
  organizationId: string,
  input: OrganizationProfileUpdate,
  admin: IPlatformAdmin,
  context: { ip?: string; userAgent?: string } = {}
) {
  const orgObjectId = new Types.ObjectId(organizationId);
  const organization = await Organization.findById(orgObjectId);
  if (!organization) throw AppError.notFound('Organization not found');

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

  const owner = await runInTenantScope(
    {
      organizationId: orgObjectId,
      userId: new Types.ObjectId(),
      role: 'platform',
      permissions: ['*'],
    },
    async () => {
      const found = await User.findOne({ role: ROLES.OWNER });
      if (!found) throw AppError.notFound('Organization owner not found');
      if (input.ownerName !== undefined) found.name = input.ownerName;
      if (input.ownerPhone !== undefined) found.phone = input.ownerPhone;
      if (input.ownerEmail !== undefined) found.email = input.ownerEmail ?? undefined;
      await found.save();
      return found;
    }
  );

  await organization.save();

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

  const result = await runInTenantScope(
    {
      organizationId: orgObjectId,
      userId: new Types.ObjectId(),
      role: 'platform',
      permissions: ['*'],
    },
    async () => {
      const found = await User.findById(userId).select('+refreshTokens');
      if (!found) throw AppError.notFound('User not found in this organization');

      const before = {
        name: found.name,
        phone: found.phone,
        email: found.email,
        designation: found.designation,
        role: found.role,
      };

      if (input.role !== undefined && input.role !== found.role) {
        if (found.role === ROLES.OWNER && input.role !== ROLES.OWNER) {
          const activeOwners = await User.countDocuments({
            role: ROLES.OWNER,
            isActive: true,
          });
          if (activeOwners <= 1) {
            throw AppError.conflict(
              'This is the only active owner. Promote another user to owner first.'
            );
          }
        }
        found.role = input.role;
      }

      if (input.name !== undefined) found.name = input.name;
      if (input.phone !== undefined) found.phone = input.phone;
      if (input.email !== undefined) found.email = input.email ?? undefined;
      if (input.designation !== undefined) found.designation = input.designation ?? undefined;
      if (input.password !== undefined) {
        found.password = input.password;
        found.refreshTokens = [];
      }

      await found.save();
      return { user: found, before };
    }
  );

  await recordPlatformAction({
    action: 'user_updated',
    organization,
    admin,
    targetType: 'User',
    targetId: result.user._id,
    before: result.before,
    after: {
      name: result.user.name,
      phone: result.user.phone,
      email: result.user.email,
      designation: result.user.designation,
      role: result.user.role,
      passwordChanged: input.password !== undefined,
    },
    ...context,
  });

  return result.user;
}

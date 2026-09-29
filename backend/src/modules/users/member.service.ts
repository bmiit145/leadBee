import type { Types, ClientSession } from 'mongoose';
import { User, type IUser } from '../../models/User.js';
import { Account, type IAccount } from '../../models/Account.js';
// Aliased: `Role` is already the role-name union from the domain vocabulary.
import { Role as RoleRecord } from '../../models/Role.js';
import { AppError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import type { Role } from '../../config/constants.js';
import { identityService, membershipCopy } from '../accounts/identity.service.js';

export interface NewMember {
  name: string;
  email: string;
  phone: string;
  /** Used only when the person is new to LeadBee. */
  password?: string;
  role: Role;
  roleId?: Types.ObjectId;
  permissions?: string[];
  designation?: string;
}

/**
 * Adding a person to an organization.
 *
 * Shared by team management and the seed, so both produce the same shape: an
 * account for the person (created, or their existing one) and a membership
 * pointing at it.
 */
export const memberService = {
  /**
   * Must run inside the organization's tenant scope — the membership row is
   * tenant-owned.
   *
   * When the email and mobile already belong to someone on LeadBee, that
   * account is linked and the password in `member` is ignored: the person keeps
   * the password they already sign in with. `linkedExistingAccount` tells the
   * caller, so an admin is not left believing a password they typed is in use.
   */
  async addMember(
    organizationId: Types.ObjectId,
    member: NewMember
  ): Promise<{ user: IUser; linkedExistingAccount: boolean }> {
    const { account, created } = await identityService.ensureAccountForMembership({
      name: member.name,
      email: member.email,
      phone: member.phone,
      password: member.password,
    });

    if (!created && (await User.exists({ accountId: account._id }))) {
      throw AppError.conflict('This person is already a member of this organization.');
    }

    try {
      const user = await User.create({
        organizationId,
        accountId: account._id,
        ...membershipCopy(account),
        role: member.role,
        roleId: member.roleId,
        permissions: member.permissions ?? [],
        designation: member.designation,
      });
      return { user, linkedExistingAccount: !created };
    } catch (error) {
      // An account created for a membership that then failed would be a person
      // with no organization and no way to have registered themselves.
      if (created) {
        await Account.deleteOne({ _id: account._id }).catch((cleanupError: unknown) =>
          logger.error(
            { err: cleanupError, accountId: account._id.toString() },
            'account left without a membership after a failed member create'
          )
        );
      }
      throw error;
    }
  },

  /**
   * Makes a membership for someone who already has a LeadBee account — how a
   * person joins through an invitation, a join link or an approved request.
   *
   * Nothing is created for the identity and no password is involved: they
   * already sign in. Must run inside the organization's tenant scope.
   */
  async addExistingAccount(
    organizationId: Types.ObjectId,
    account: IAccount,
    membership: { role: Role; roleId?: Types.ObjectId },
    session?: ClientSession
  ): Promise<IUser> {
    // Scoped by the plugin, so this asks "already in *this* organization".
    if (await User.exists({ accountId: account._id }).session(session ?? null)) {
      throw AppError.conflict('This person is already a member of this organization.');
    }

    // Without the organization's role record the membership carries no
    // permissions at all, and the person signs in to a working session that is
    // refused everywhere. Resolved here rather than at each caller.
    const roleId =
      membership.roleId ??
      (await RoleRecord.findOne({ name: membership.role }).session(session ?? null).select('_id').lean())?._id;

    const [user] = await User.create([{
      organizationId,
      accountId: account._id,
      ...membershipCopy(account),
      role: membership.role,
      roleId,
      permissions: [],
    }], { session });

    if (!user) {
      throw new AppError('Failed to create user', 500);
    }

    return user;
  },
};

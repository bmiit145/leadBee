import { PERMISSIONS, ROLE_ORDER, type Role } from '../../config/constants.js';
import { AppError } from '../../lib/errors.js';

/**
 * Who may manage whom inside one organization.
 *
 * `users.manage` alone used to be the whole rule, which let its holder give
 * themselves `*`, promote anyone to owner, or reset the owner's password and
 * sign in as them. A permission says an action is allowed; it cannot say
 * against whom. These checks add the "against whom".
 *
 * Pure functions over the caller and the target, so the rules are tested
 * without a database — the routes load the documents and ask.
 */
export interface UserManager {
  userId: string;
  role: string;
  permissions: string[];
}

/**
 * Position in ROLE_ORDER. An unrecognised role is -1, below every real one, so
 * a caller whose role cannot be placed can manage nobody — fail closed.
 */
export function roleRank(role: string): number {
  return ROLE_ORDER.indexOf(role as Role);
}

export const userPolicy = {
  /**
   * Peers may manage peers; nobody manages upward.
   *
   * Equal rank is allowed deliberately: two admins already hold the same
   * grants, so refusing one the other's account protects nothing and would
   * leave a second admin unmanageable by anyone but the owner.
   */
  assertCanManage(actor: UserManager, target: { role: string }): void {
    if (roleRank(target.role) > roleRank(actor.role)) {
      throw AppError.forbidden('You cannot manage a user whose role is above your own');
    }
  },

  /** A role above the caller's own would be self-promotion by proxy. */
  assertCanAssignRole(actor: UserManager, role: string): void {
    const rank = roleRank(role);
    if (rank < 0 || rank > roleRank(actor.role)) {
      throw AppError.forbidden('You cannot give a role above your own');
    }
  },

  /** Only what the caller already holds may be handed on. `*` may hand on anything. */
  assertCanGrant(actor: UserManager, permissions: string[]): void {
    if (actor.permissions.includes(PERMISSIONS.ALL)) return;
    const missing = permissions.filter((p) => !actor.permissions.includes(p));
    if (missing.length > 0) {
      throw AppError.forbidden('You cannot grant permissions you do not hold');
    }
  },

  /**
   * Some changes must never be made to one's own account through the management
   * endpoints: they would bypass the checks above, or — for a password reset —
   * skip the current-password proof that `/auth/change-password` requires.
   */
  assertNotSelf(actor: UserManager, targetId: string, action: string): void {
    if (actor.userId === targetId) {
      throw AppError.forbidden(`You cannot ${action} your own account`);
    }
  },
};

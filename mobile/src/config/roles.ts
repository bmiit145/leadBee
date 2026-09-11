import type { UserRole } from '../types';

/**
 * Tenant roles, lowest to highest. Mirrors ROLE_ORDER on the API.
 *
 * Used only to hide choices the API would refuse — a role above your own, a
 * member who outranks you. The server makes the decision (MOB-2); this just
 * avoids offering a button whose only outcome is a 403.
 */
export const ROLE_ORDER: UserRole[] = ['user', 'partner', 'manager', 'admin', 'owner'];

/** An unrecognised role ranks below every real one, so it can manage nobody. */
export function roleRank(role: string): number {
  return ROLE_ORDER.indexOf(role as UserRole);
}

/** Roles the caller may give: their own and those below it. */
export function assignableRoles(actorRole: string): UserRole[] {
  const ceiling = roleRank(actorRole);
  return ROLE_ORDER.filter((role) => roleRank(role) <= ceiling);
}

/** Peers may manage peers; nobody manages upward. */
export function canManageRole(actorRole: string, targetRole: string): boolean {
  return roleRank(targetRole) <= roleRank(actorRole);
}

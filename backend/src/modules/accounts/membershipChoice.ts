/**
 * Which organization a sign-in opens, for a person who belongs to several.
 *
 * Pure, so the rule is tested without a database. The order is the one people
 * expect from workspace products:
 *
 * 1. Their **default** organization, if they chose one and it can be opened.
 * 2. Otherwise the organization they **last used**, if it can be opened.
 * 3. Otherwise **ask** — nothing to go on, or both are suspended or expired.
 *
 * Only active memberships are passed in; `usable` is whether the organization
 * itself can be signed into (not suspended, trial not lapsed). A single
 * membership is opened whatever its organization's state, so the sign-in can
 * explain *why* it is unavailable rather than offering a one-item picker.
 */

export interface MembershipOption {
  organizationId: string;
  usable: boolean;
}

export interface SignInPreferences {
  defaultOrganizationId?: string;
  lastOrganizationId?: string;
}

export type SignInChoice =
  | { kind: 'open'; organizationId: string; reason: 'only' | 'default' | 'last_used' }
  | { kind: 'ask' };

export function chooseSignInOrganization(
  options: MembershipOption[],
  preferences: SignInPreferences
): SignInChoice {
  if (options.length === 1) {
    return { kind: 'open', organizationId: options[0]!.organizationId, reason: 'only' };
  }

  const opensCleanly = (organizationId?: string): organizationId is string =>
    organizationId !== undefined &&
    options.some((option) => option.organizationId === organizationId && option.usable);

  if (opensCleanly(preferences.defaultOrganizationId)) {
    return { kind: 'open', organizationId: preferences.defaultOrganizationId, reason: 'default' };
  }
  if (opensCleanly(preferences.lastOrganizationId)) {
    return { kind: 'open', organizationId: preferences.lastOrganizationId, reason: 'last_used' };
  }
  return { kind: 'ask' };
}

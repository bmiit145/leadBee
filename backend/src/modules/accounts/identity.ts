/**
 * Who is this person? The pure rules.
 *
 * An account is identified by its email **and** its mobile number, each of
 * which belongs to exactly one person. These functions decide what a given
 * email/mobile pair means against the accounts that already hold either of
 * them. They know nothing about the database, so they are unit-tested on their
 * own; `identity.service.ts` feeds them. See docs/adr/0004-account-is-the-identity.md.
 */

export type IdentifierKind = 'email' | 'phone';

/** Sign-in takes one field for both. An `@` is what tells them apart. */
export function identifierKind(raw: string): IdentifierKind {
  return raw.includes('@') ? 'email' : 'phone';
}

/**
 * `"Priya  Kumar Shah"` → first `Priya`, last `Kumar Shah`.
 *
 * A membership has always held one `name` field; an account holds two. The
 * first word is the first name and the rest is the last name, which is the
 * least surprising split for the names this product sees. A single word leaves
 * the last name empty rather than inventing one.
 */
export function splitName(fullName: string): { firstName: string; lastName: string } {
  const [firstName = '', ...rest] = fullName.trim().split(/\s+/).filter(Boolean);
  return { firstName, lastName: rest.join(' ') };
}

export function joinName(firstName: string, lastName?: string | null): string {
  return [firstName, lastName ?? '']
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' ');
}

/** An account that already holds the email, the mobile, or both. */
export interface IdentityCandidate {
  id: string;
  /**
   * A self-registration that never confirmed its email and belongs to no
   * organization. It has proven nothing and grants nothing, so it must not be
   * able to reserve someone else's email or number: a newer registration or
   * membership for those identifiers replaces it.
   */
  disposable: boolean;
}

export type IdentityConflictReason = 'EMAIL_IN_USE' | 'PHONE_IN_USE' | 'IDENTITY_CONFLICT';

export type IdentityResolution =
  /** Nobody real holds either identifier. `supersede` lists disposable accounts to remove. */
  | { kind: 'new'; supersede: string[] }
  /** One account holds both — this is that person. */
  | { kind: 'existing'; accountId: string; disposable: boolean }
  | { kind: 'conflict'; reason: IdentityConflictReason };

/**
 * The cross-check.
 *
 * - Both identifiers on the same account → that person.
 * - The email on a real account whose mobile is different → `EMAIL_IN_USE`.
 * - The mobile on a real account whose email is different → `PHONE_IN_USE`.
 * - Each on a different real account → `IDENTITY_CONFLICT`.
 * - Only disposable holders → a new account, and the disposable ones go.
 *
 * "Different" follows from the lookup: if the email's account also held this
 * mobile, the mobile lookup would have found the same account.
 */
export function resolveIdentity(
  byEmail: IdentityCandidate | null,
  byPhone: IdentityCandidate | null
): IdentityResolution {
  if (byEmail && byPhone && byEmail.id === byPhone.id) {
    return { kind: 'existing', accountId: byEmail.id, disposable: byEmail.disposable };
  }

  const emailHeld = byEmail !== null && !byEmail.disposable;
  const phoneHeld = byPhone !== null && !byPhone.disposable;

  if (emailHeld && phoneHeld) return { kind: 'conflict', reason: 'IDENTITY_CONFLICT' };
  if (emailHeld) return { kind: 'conflict', reason: 'EMAIL_IN_USE' };
  if (phoneHeld) return { kind: 'conflict', reason: 'PHONE_IN_USE' };

  const supersede = [byEmail, byPhone]
    .filter((candidate): candidate is IdentityCandidate => candidate !== null)
    .map((candidate) => candidate.id);
  return { kind: 'new', supersede: [...new Set(supersede)] };
}

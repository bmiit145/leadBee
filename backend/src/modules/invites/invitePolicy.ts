import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { AppError } from '../../lib/errors.js';
import { ORGANIZER_ROLES, ROLES, type Role } from '../../config/constants.js';

/**
 * The rules of joining an organization, kept pure and testable: what a code
 * looks like, when a way in is still open, and which roles a link may hand out.
 *
 * See docs/adr/0007-joining-an-organization.md.
 */

/** Days a shareable link lasts unless an admin picks otherwise. */
export const JOIN_CODE_EXPIRY_DAYS = 30;
/** Days an emailed invitation lasts. Shorter: it is addressed to one person. */
export const INVITE_EXPIRY_DAYS = 7;

/**
 * No 0/O, 1/I/L, 2/Z, 5/S, 8/B — a code is read aloud over a phone and typed by
 * someone in a hurry, and every pair above is the mistake they make.
 */
const CODE_ALPHABET = 'ACDEFGHJKMNPQRTUVWXY34679';
const CODE_LENGTH = 8;
/** Printed as XXXX-XXXX; the dash is cosmetic and stripped on the way in. */
const CODE_GROUP = 4;

export const INVITE_ERROR = {
  /** The code or token is unknown, retired, expired or used up. One code for all
   *  of them on purpose: a distinct "expired" tells a guesser they found a real
   *  organization. */
  INVALID_CODE: 'INVITE_INVALID',
  /** A request from this person is already waiting for an answer. */
  REQUEST_PENDING: 'JOIN_REQUEST_PENDING',
  /** They are already in this organization. */
  ALREADY_MEMBER: 'ALREADY_A_MEMBER',
  /** Signed in as someone other than the person invited. */
  EMAIL_MISMATCH: 'INVITE_EMAIL_MISMATCH',
  /** The request was already approved, rejected or withdrawn. */
  NOT_PENDING: 'JOIN_REQUEST_NOT_PENDING',
  JOIN_CLOSED: 'JOIN_CLOSED',
} as const;

/** A fresh code, in storage form (no dash, uppercase). */
export function generateJoinCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return code;
}

/** `K7QM3XR9` → `K7QM-3XR9`, for display and sharing. */
export function formatJoinCode(code: string): string {
  return code.length > CODE_GROUP ? `${code.slice(0, CODE_GROUP)}-${code.slice(CODE_GROUP)}` : code;
}

/**
 * What the person typed, reduced to storage form. Accepts a pasted invite link,
 * spaces, dashes and lower case — anything a real person pastes from WhatsApp.
 */
export function normalizeJoinCode(input: string): string {
  const fromLink = input.trim().split(/[/?#]/).filter(Boolean).pop() ?? '';
  return fromLink.replace(/[^a-z0-9]/gi, '').toUpperCase();
}

export function looksLikeJoinCode(input: string): boolean {
  return normalizeJoinCode(input).length === CODE_LENGTH;
}

/** A single-use invitation token, and the digest stored for it. */
export function generateInviteToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashInviteToken(token) };
}

export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Compares two digests without leaking where they first differ. */
export function digestsMatch(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function daysFromNow(days: number, now: Date): Date {
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
}

/**
 * A link hands out a working role, never an organizer one.
 *
 * Anyone holding a forwarded link would otherwise become an admin, which is a
 * takeover rather than a join. Organizer roles are given deliberately, by an
 * admin, on the member's own record.
 */
export function assertLinkRole(role: string): asserts role is Role {
  if (ORGANIZER_ROLES.includes(role as Role)) {
    throw AppError.badRequest(
      'An invite link cannot hand out an organizer role. Add the person, then change their role.'
    );
  }
  if (role !== ROLES.USER && role !== ROLES.PARTNER) {
    throw AppError.badRequest('That role cannot be given through an invite.');
  }
}

interface Redeemable {
  isActive: boolean;
  expiresAt?: Date | null;
  maxUses?: number | null;
  uses: number;
}

export interface OrganizationJoinSettings {
  requireApproval?: boolean;
  allowLinkJoin?: boolean;
}

/** Legacy organizations without stored settings preserve the approval default. */
export function joinRequiresApproval(
  settings: OrganizationJoinSettings | undefined,
  legacyLinkDefault = true
): boolean {
  return settings?.requireApproval ?? legacyLinkDefault;
}

/** Missing settings preserve the historical behavior: public links are allowed. */
export function linkJoiningAllowed(settings: OrganizationJoinSettings | undefined): boolean {
  return settings?.allowLinkJoin !== false;
}

/** Whether a shareable code may still be used. */
export function codeIsOpen(code: Redeemable, now: Date): boolean {
  if (!code.isActive) return false;
  if (code.expiresAt && code.expiresAt.getTime() <= now.getTime()) return false;
  if (code.maxUses != null && code.uses >= code.maxUses) return false;
  return true;
}

/** Whether an emailed invitation may still be accepted. */
export function inviteIsOpen(
  invite: { status: string; expiresAt: Date },
  now: Date
): boolean {
  return invite.status === 'pending' && invite.expiresAt.getTime() > now.getTime();
}

/** The one error every unusable code, link or token answers with. */
export function invalidCode(): AppError {
  return new AppError(
    'This invite is not valid any more. Ask for a new one.',
    404,
    INVITE_ERROR.INVALID_CODE
  );
}

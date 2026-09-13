# ADR-0003: A person registers before they belong to an organization

## Status
Proposed

## Context

LeadBee's self-serve signup (`POST /signup`) creates an **organization and its
owner in one step**, the same model as the reference app (LeadSo), whose signup
form asks for Company Name and GST. That forces every new person to be a
founder: an employee joining an existing team must either invent a company or
wait for an invite that has no self-serve path.

The product decision is to register a **person** first and then ask one
question — *join an existing organization, or create your own*. The platform
console must also be able to see, suspend and erase those people.

The data model cannot hold this today:

- `User` is tenant-owned. `tenantPlugin` makes `organizationId` required, and
  every unique index is per organization (`{organizationId, phone}`).
- A registered-but-unplaced person therefore **cannot be a `User` row**.
- Relaxing `organizationId` on `User` would break ARCH-2/ARCH-3 (isolation in
  the data layer, absent scope fails closed) for the single most sensitive
  collection in the product.

## Decision

1. **Add `Account`, a platform-level collection** (like `Organization` and
   `PlatformAdmin`): first/last name, email (unique), mobile (indexed, not
   unique), bcrypt password, `status` (`active` | `suspended`),
   `emailVerifiedAt`, consent time, signup IP and user agent, internal notes.
   It is not tenant-owned and is added to the ARCH-5 and BE-4 exemption lists.
2. **An `Account` grants no tenant access by itself.** Access still flows only
   through a tenant `User` and a tenant token. The join/create flow (not yet
   built) will create that `User` and link it to the account.
3. **Registration is public and non-enumerating** (`/api/v1/accounts/*`):
   - `register` and `resend-verification` return the same shape, at comparable
     cost, for known and unknown emails. A verified owner is emailed a notice.
   - Every verification failure is one error, `INVALID_VERIFICATION_CODE`.
4. **Verification codes** are 6 digits, valid 10 minutes, stored as an HMAC
   (key derived from `JWT_SECRET` with a label), limited to 5 guesses spent
   atomically before comparison, with a 30-second resend cooldown.
5. **A code is bound to its registration attempt.** `register` issues an opaque
   `registrationToken`; verifying and resending require it. A later
   registration of the same unverified email rotates the token, and its details
   replace the pending ones. This closes pre-registration hijacking: someone
   who registers a victim's address first can never get the victim's code to
   confirm the attacker's password.
6. **Platform console** (`/api/v1/platform/accounts*`): list with search and
   filters, stats, detail with admin activity, suspend/reactivate (reason
   required to suspend), manual email verification (reason required), internal
   notes, and permanent deletion (typed email confirmation and reason). Every
   write goes to `PlatformAuditLog` with `targetType: 'Account'`. New
   permissions: `accounts.view` (operator, support), `accounts.manage`
   (operator), `accounts.delete` (owner only).
7. **Mail is a seam, not a provider.** `lib/mailer.ts` logs "would have sent"
   outside production and **refuses in production** (503 `EMAIL_UNAVAILABLE`)
   until a real transport is configured. Outside production the API returns the
   code as `devCode` so the flow is testable.

## Consequences

- Two identity collections now exist for tenant-side people (`Account`,
  `User`). Until the join flow links them, a person's name and phone can differ
  between the two.
- **Sign-in as an `Account` does not exist yet.** A verified account can do
  nothing until the join/create flow ships. Suspension is recorded and retires
  pending codes; it must be enforced by that sign-in when it is built.
- Registration **cannot run in production** until a mail provider is added.
  That is intentional; adding the provider is an external dependency and needs
  its own ADR.
- Manual verification confirms whatever details are pending. It is a support
  override for an identity established another way, not a routine action.
- Search on the console is an unanchored, case-insensitive regex across four
  fields — fine at thousands of accounts, a collection scan at millions. The
  path forward is a text index or a search service.
- Deleting an account is permanent. Its audit rows remain, holding the email
  domain only.

## Alternatives considered

- **Nullable `organizationId` on `User`.** Rejected: it weakens tenant
  isolation on the most sensitive collection, and every tenant query would need
  to exclude unplaced users — the exact special-casing ARCH-8 exists to prevent.
- **Keep org-at-signup (the LeadSo model).** Rejected by the product decision
  above; it has no path for an employee joining an existing company.
- **A placeholder "personal" organization per registrant.** Rejected: it
  creates thousands of empty tenants, distorts plan usage and estate metrics,
  and still has to be migrated away when the person joins a real organization.
- **Reveal "email already registered" at signup.** Rejected: a public
  enumeration oracle for which companies' staff use LeadBee.
- **Unkeyed SHA-256 of the code.** Rejected: a six-digit space is reversed
  instantly from a leaked row.
- **Unique mobile number on `Account`.** Rejected: another enumeration oracle,
  and shared handsets are common. Per-organization phone uniqueness stays on
  `User`, where sign-in needs it.

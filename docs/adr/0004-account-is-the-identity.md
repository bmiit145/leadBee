# ADR-0004: The account is the person — one identity across organizations

## Status
Proposed. Partly supersedes [ADR-0003](./0003-pre-tenant-accounts.md).

## Context

ADR-0003 added `Account` for people who register before joining an
organization, but left every existing tenant user as a separate `User` row with
its own name, phone, email and password. The platform console therefore showed
registrants and nobody else: the owner of an organization, a real person, was
not an account at all.

That is two identity systems for one population. A person working for two
customers had two passwords, could be renamed in one organization and not the
other, and could not be suspended as a person — only per organization.

Product decisions taken for this change:

1. **One identity per person.** The account owns name, email, mobile number and
   the password. Sign-in is by email **or** mobile number.
2. **Email and mobile are each unique to one person.** Registering or adding
   someone whose email is tied to a different mobile, or whose mobile is tied to
   a different email, is refused.

## Decision

### Data model

- `Account` holds identity: first and last name, email (unique), mobile
  (unique), bcrypt password, status, `source` (`registration`, `organization`
  or `backfill`), email verification, suspension and last sign-in.
- `User` becomes a **membership**: `accountId` (required), organization, role,
  permissions, designation, active flag, sessions and push token. It keeps
  `name`, `email` and `phone` as a **read-only copy** of the account, because
  leads, tasks, meetings and notifications populate them from the membership.
  Only `identity.service.ts` writes that copy, and it keeps every membership of
  a person in step. `User.password` is removed.
- One membership per person per organization: unique `{organizationId, accountId}`.

### Identity rules (`modules/accounts/identity.ts`)

For an email/mobile pair, against accounts already holding either:

| Found | Result |
| --- | --- |
| Neither | New account |
| One account holds both | That person |
| Email on a real account with another mobile | 409 `EMAIL_IN_USE` |
| Mobile on a real account with another email | 409 `PHONE_IN_USE` |
| Each on a different real account | 409 `IDENTITY_CONFLICT` |
| A real account, when registering | 409 `ACCOUNT_EXISTS` — sign in instead |

**Refinement: an unconfirmed registration reserves nothing.** A
self-registration that never confirmed its email and belongs to no organization
is *disposable*. A newer registration, team add or provisioning for the same
email or mobile replaces it. Without this, anyone could lock a real person out
of LeadBee by registering their email or number first. Every account an
organization created, every backfilled account and every confirmed registration
holds its identifiers exclusively.

### Sign-in

1. Find the account by email or normalised mobile; compare the password (a
   dummy bcrypt comparison runs when no account matched, so timing does not
   reveal which identifiers exist).
2. Suspended → 403 `ACCOUNT_SUSPENDED`. No memberships → 403 `NO_ORGANIZATION`.
   Both only after the password is verified.
3. One active membership → tokens for it. Several → the existing
   `ORGANIZATION_SELECTION_REQUIRED` picker.
4. The request's `phone` field is still accepted, for app builds already
   installed.
5. Tenant tokens stay per membership. `authenticateTenant` and token refresh now
   also check the account's status on every call (ARCH-9), so suspension ends
   access at once, in every organization.

### Who may change what

- **The person** (`PUT /auth/me`, `/auth/change-password`): their own name,
  email and password, everywhere. Changing password or "sign out everywhere"
  ends sessions in every organization.
- **An organization's admin** (`/users`): role, permissions, designation and
  active state of the membership. Name, email and password only when this
  organization is the person's **only** membership (409 otherwise) — one
  organization must not change what another relies on to reach the same person.
  Adding a member whose email and mobile already belong to someone links that
  account (`linkedExistingAccount: true`); the typed password is ignored and the
  person keeps theirs. New members require an email and an 8+ character password.
- **Self-serve signup**: if the owner's email and mobile already have an
  account, the submitted password must be that account's (409
  `ACCOUNT_EXISTS` otherwise). Platform provisioning links an existing person
  without it.
- **Platform admin**: identity changes everywhere (their authority); suspension
  ends every session; an account with memberships cannot be deleted (409).

### Migration

`npm run migrate:accounts` (dry run) / `-- --apply`. Memberships sharing an email
or mobile are one person and get one account; the most recently used
membership's password hash moves to the account (inserted through the driver so
it is not hashed twice) and membership rows lose theirs. It refuses to apply
while any membership cannot be linked cleanly (no email or mobile, conflicting
identifiers, or identifiers split across existing accounts) unless
`--allow-partial`. Production needs `--confirm-backup`. Idempotent.

**Deploy order:** deploy, run the migration, then `npm run sync-indexes`
(`Account.phone` becomes unique). Until the migration runs, un-migrated members
cannot sign in.

### Cross-tenant access (ARCH-4)

New `withoutTenantScope` call sites, all keyed on one account id:

| Reason | Why it must cross tenants |
| --- | --- |
| `login: the organizations this account belongs to` | A person's memberships are in different tenants by definition |
| `identity: keep every membership copy … in step` | Renaming a person updates each organization's copy |
| `identity: which organizations this person belongs to` | The sole-membership guard |
| `identity: end this person's sessions in every organization` | Suspension, password change, sign out everywhere |
| `identity: whether an account belongs to any organization` | Deciding whether a registration is disposable |
| `migration: link every membership to one account` | One-time backfill |

`User` gains a single-field `{accountId: 1}` index for the sign-in lookup. It
cannot lead with `organizationId` (the read is cross-tenant); ARCH-5 governs
compound indexes. Under hashed sharding on `organizationId` this lookup
scatter-gathers — acceptable for sign-in, and the reason sign-in is not a hot
path.

## Consequences

- Registration and team add **reveal whether an email or mobile is taken.** The
  product chose this over silent handling; rate limits bound probing. Sign-in
  still gives one generic failure.
- A person in several organizations who previously had several passwords keeps
  one — the most recently used. The migration lists these people.
- Emails on backfilled and organization-created accounts are **unverified**:
  an admin typed them. Nothing blocks sign-in on this yet.
- `name`/`email`/`phone` on `User` are a copy. Anything writing them outside
  `identity.service.ts` reintroduces drift and is a review blocker.
- Removing someone from an organization (deleting the membership) is not built;
  until it is, an account with memberships cannot be deleted from the console.

## Alternatives considered

- **Keep `User` as the identity and mirror rows into Accounts for the console.**
  Rejected: two sources of truth for name, email and password that drift, and
  no way to suspend a person.
- **Email as the only identifier.** Rejected by the product decision; mobile is
  how most users here sign in.
- **Let unconfirmed registrations reserve identifiers** (the literal rule).
  Rejected: it lets anyone squat a real person's email or number.
- **Move sessions to the account.** Rejected for now: tenant tokens carry the
  organization, and per-membership sessions keep "deactivate in this
  organization" cheap and exact. Suspension and password changes revoke across
  memberships instead.

# ADR-0007: Four ways into an organization

## Status
Accepted, 2026-09-24. Closes KNOWN-GAPS 6.2.

## Context

A person registers an account before they have an organization (ADR-0004) and
lands on "You're not part of an organization yet". **Create** worked. **Join**
did nothing, so the only way in was an admin typing someone's name, email,
mobile and password into the Team screen. For a field-sales team that is the
wrong shape: the agent is standing there with a phone, and the admin is on
WhatsApp.

Every product this is measured against offers several doors, layered by how
much the organization trusts the person on the other side.

## Decision

Four ways in, in the order a customer grows into them.

| # | Way in | Who starts it | What stops abuse |
| --- | --- | --- | --- |
| 1 | **Invitation by email** | Admin | Single-use token, 7-day expiry, and only the invited address may accept |
| 2 | **Invite link / join code** | Admin shares, anyone follows | One live link per organization, resettable, expiring, use-limited, working role only |
| 3 | **Request to join, with approval** | The joiner | An admin answers every request; on by default for the link |
| 4 | **Admin adds the person directly** | Admin | Already existed (`POST /users`); now surfaced on the same screen |

### The link is WhatsApp's group link, deliberately

An organization has **one active code**, `XXXX-XXXX`, enforced by a unique
partial index. "Reset link" retires the current code and issues another, so
every forwarded copy dies at once — the behaviour people already understand
from WhatsApp, and the reason the screen is laid out the same way (copy, share,
QR, reset, then "Manage permissions").

The alphabet excludes `0/O`, `1/I/L`, `2/Z`, `5/S` and `8/B`. A code is read
aloud down a phone line and typed by someone in a hurry, and those are the
pairs they get wrong. 25 characters over 8 places is ~1.5×10¹¹ combinations,
behind a 20-per-10-minutes rate limit.

The code is stored **as typed, not hashed**, because an admin must be able to
re-read and re-share it; it is a shareable secret, like a WhatsApp group link.
The protection is elsewhere: approval on by default, expiry, use limit, one-tap
reset, rate limits, and the fact that a link **can never hand out an organizer
role**. Anyone who wants the stronger guarantee uses an invitation by email,
whose token *is* hashed (SHA-256, single use) exactly as refresh tokens are
(ENG-23), and which only its addressee can accept.

### Tenancy, which is where this feature is dangerous

Redemption arrives with a secret and **no tenant**: the caller has no
membership anywhere yet, so the lookup cannot be tenant-scoped. Every such read
goes through `withoutTenantScope` with a reason (ARCH-4), reads exactly one row
by a secret the caller already holds, and hands back only what is needed to
recognise the organization — its name and member count. Writes then run inside
`runInTenantScope` for the target organization, so the membership, the request
and the notification are that tenant's rows, stamped by the plugin as usual.

The joining routes are **account realm** (`authenticateAccount`); the admin
routes are **tenant realm** with `users.manage`. Neither realm is widened, and
no route accepts an organization id from the client.

### Answering the same way whatever is wrong

A code that is unknown, retired, expired or used up all answer
`404 INVITE_INVALID`. Distinguishing them would tell someone guessing codes
that they had found a real organization.

### Error codes (API contract, ENG-6)

| Code | Status | Meaning |
| --- | --- | --- |
| `INVITE_INVALID` | 404 | Unknown, retired, expired or used up |
| `JOIN_REQUEST_PENDING` | 409 | This person already has a request waiting |
| `ALREADY_A_MEMBER` | 409 | They are already in that organization |
| `INVITE_EMAIL_MISMATCH` | 403 | Signed in as someone other than the invitee |
| `JOIN_REQUEST_NOT_PENDING` | 409 | The request was already answered |

### Consistency with what already exists

- A successful join answers with the **sign-in response shape**, so the app
  moves into the organization exactly as creating one does.
- Plan limits are checked before every membership (`assertCanAddUser`), so a
  link cannot be used to exceed the seats a customer pays for.
- The role record is attached in `memberService.addExistingAccount`. A
  membership without it carries no permissions, which produced a session that
  signed in and was then refused everywhere — found by the smoke suite and
  fixed there, so every door benefits.
- Organizers are told about a waiting request through the ordinary notification
  inbox (`join_request_received`).

## Consequences

- **No mail is sent.** LeadBee has no mailer — registration codes are in the
  same position — so an invitation hands its link back to the admin **once**,
  to share over WhatsApp, SMS or their own mail client. When a mailer lands,
  sending becomes an extra step, not a redesign.
- A pending request holds the person's name, email and mobile inside the
  organization that has not accepted them yet. That is what an admin needs to
  judge it; a rejected or withdrawn request keeps only its status.
- The unique partial indexes are load-bearing. `npm run sync-indexes` must run
  before this ships, because `autoIndex` is off.
- Nothing here grants an organizer role. Promoting someone stays a deliberate
  act on their member record.

## Alternatives considered

- **Verified email domain** (anyone with `@company.com` joins). The strongest
  fit for mid-size customers, and the next one to build; it needs domain
  verification (a DNS record) to be safe, which is a separate piece of work.
- **SSO and SCIM.** The enterprise answer, and the right one for a large
  customer. It belongs behind a plan feature in the catalogue (ARCH-17), not in
  the first version of joining.
- **Hashing the join code.** It would stop a database copy yielding a working
  link, but the admin screen could then never show the code again — which is
  the whole feature. The email invitation covers the case where that trade-off
  is unacceptable.
- **A link that grants any role.** Rejected: a forwarded link would then be an
  organization takeover rather than a join.

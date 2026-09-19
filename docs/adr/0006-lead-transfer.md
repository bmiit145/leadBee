# ADR-0006: Lead transfer is a request the recipient accepts

## Status
Accepted, 2026-09-18.

## Context

A lead belongs to one person (`assignedTo`). Until now, only an organizer
could change that, through `PUT /leads/:id/assign`. That left out the most
common real-world case: an agent who should no longer work a customer. They
may be going on leave, moving territory or product line, or the customer asked
for someone else. Agents worked around it by asking a manager, or by leaving
the lead to go stale.

A plain "agent may reassign" permission would be the wrong fix, for three
reasons:

1. **Nobody agreed to take it.** A colleague finds someone else's customers
   in their book, including the difficult ones.
2. **Nothing records why.** `assignedBy`/`assignedAt` say who moved it and
   when, but not the reason. The reason is the first thing a manager
   reviewing a lost deal asks.
3. **It races.** The owner and an organizer can act on the same lead at the
   same moment.

## Decision

### The workflow

| Who acts | What happens |
| --- | --- |
| The lead's owner | A **request** is created. The lead stays with the owner until the recipient accepts it. |
| An organizer | The request is created **and settled at once**, through the same code path an acceptance takes. |
| The recipient | Accepts (the lead moves) or declines (it stays). An optional note is recorded. |
| The sender | May withdraw the request while it is pending. |
| Nobody, for 7 days | The request lapses (`expired`). |

The owner's request needs the recipient's consent. An organizer's does not,
because handing out work is what that role is for. Organizers can already
do this through `/assign`, so the transfer path grants no new power.

### The record

`LeadTransfer` (tenant-owned, `tenantPlugin`) is the permanent audit record:
who asked, the reason, who decided, when, and their note.

The reason is **optional** (up to 500 characters), as in standard CRM
ownership transfer. A first version required it. We dropped that because a
reason forced on every routine hand-off gets filled with "ok" rather than
information. The app offers one-tap suggestions ("Going on leave", "Balancing
workload", …), the same idea as the canned chips on Notes, so that giving a
real reason costs one tap. Every name is snapshotted, as `CallLog` does, so the history
still reads correctly after someone is renamed or leaves.

Every transition is also written to the lead's Time Line
(`lead_transfer_requested`, `lead_transferred`, `lead_transfer_declined`,
`lead_transfer_cancelled`), so anyone reading the lead sees it without
opening another screen.

### Invariants and how they hold

| Invariant | Mechanism |
| --- | --- |
| At most one open request per lead | Unique partial index `{organizationId, lead}` where `status: 'pending'`. It is load-bearing: `npm run sync-indexes` must run before this ships, because `autoIndex` is off. |
| Exactly one decision wins | Every decision is a conditional `findOneAndUpdate` on `status: 'pending'` and an unexpired `expiresAt`. |
| A lead moves only from the owner the request was made against | `Lead.updateOne({ assignedTo: fromUser, isActive: true })`. If it matches nothing, the request is closed as `owner_changed` or `lead_removed`, and the caller gets 409 `TRANSFER_STALE`. |
| The recipient is still a member when they accept | Re-checked inside the acceptance. Otherwise the request is closed as `recipient_inactive`. |
| A reassignment or delete closes the open request | `closeOpenTransfers()` is called from `announceReassignment()` and `remove()`. |
| Expiry needs no scheduler | `effectiveStatus()` reads a lapsed `pending` request as `expired`. The stored status catches up the next time the request is written. |

Acceptance runs inside a transaction where the deployment has one
(`withOptionalTransaction`). Each step is conditional on the state the
previous one left, so the flow is correct without a transaction. The
transaction adds only that a crash between the two writes cannot leave one
without the other.

### Authorization

- Route guard: `leads.edit` for writes; `leads.view` or `leads.edit` for
  reads. Every built-in role already holds `leads.edit`, so no stored role
  changes and no migration is needed.
- Row rules live in `leadTransferPolicy.ts`, which is pure and unit-tested:
  - The owner or an organizer may request.
  - The recipient or an organizer may accept or decline.
  - The sender (or the owner on whose behalf it was asked) or an organizer
    may withdraw.
  - The sender can never accept for the recipient.
- A person who is not a party to a request gets **404, not 403**. Whether a
  colleague's lead is changing hands is not theirs to learn.
- Before acceptance, the recipient sees only the lead number, the customer's
  name and the reason, if one was given. The phone number and the rest of the lead stay hidden
  until the lead is theirs.
- `GET /lead-transfers/recipients` lists active colleagues, showing only name,
  role and picture, to anyone with `leads.edit`. Agents have no `users.view`,
  and choosing a recipient needs this list. It exposes nothing else about
  anyone.

### Error codes (API contract, ENG-6)

| Code | Status | Meaning |
| --- | --- | --- |
| `TRANSFER_PENDING` | 409 | The lead already has an open request. `details.transferId` names it. |
| `TRANSFER_NOT_PENDING` | 409 | The request was already decided, withdrawn or has lapsed. `details.status` says which. |
| `TRANSFER_STALE` | 409 | The lead or the recipient changed in the meantime, and the request has been closed. `details.closeReason` says why. |
| `TRANSFER_INVALID_RECIPIENT` | 422 | The recipient is the current owner, or not an active member. |

### Notifications

The four new types (`lead_transfer_requested`, `…_accepted`, `…_declined` and
`…_cancelled`) point at the **request** (`entityType: 'lead_transfer'`), not at
the lead. Before acceptance the recipient cannot open the lead, and afterwards
the sender may not be able to either. When an organizer settles a request,
the recipient is told with the ordinary `lead_assigned` notification, because
they did not agree to anything.

## Consequences

- A lead's open tasks and meetings do **not** move with it. They keep their
  own assignees, and the new owner can work them because they own the lead
  (`canWorkOn`). Moving work items automatically is a separate decision: it
  would silently take tasks from people who may still be doing them.
- The previous owner loses sight of the lead unless they created it, which
  follows the existing visibility rule (`canSeeLead`).
- The 7-day expiry is a constant (`TRANSFER_EXPIRY_DAYS`). If organizations ask
  to tune it, it becomes a platform setting under CFG tier 1, not an
  environment variable.
- Older app builds render the new notification types with a generic icon, and
  ignore a push for `lead_transfer`. They do not crash: the push payload is
  parsed, not trusted.

## Alternatives considered

- **Let agents reassign directly.** Rejected for the three reasons in Context.
- **Manager approval of every transfer.** This adds a third party to every
  hand-off and slows the common case. Organizers can already answer any
  pending request from the "All" tab, so review is available without being
  mandatory. If an organization needs it enforced, add it as a feature flag
  on the catalogue (ARCH-14), not as a code branch.
- **Keep the pending request on the lead document** (`lead.pendingTransfer`).
  This would make "one open request" trivially true. But the history then
  needs a second store anyway, and every lead read would carry transfer state
  that almost nobody needs.
- **A scheduler to expire requests.** It adds a moving part to the deployment.
  Reading expiry from `expiresAt` gives the same answer with nothing to run.

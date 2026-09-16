# ADR-0005: Calls come from the phone, filtered to the leads

## Status
Proposed. Replaces manual call logging, removed on 2026-09-16.

## Context

Until now a call was a form: the agent finished a call, opened the lead, chose
an outcome and typed a note. Everything downstream — the lead's call count,
"last contacted", the timeline entry, the Today's Call Tracking row on Home —
was fed by that form.

Three things are wrong with it.

1. **It is only as true as the agent's memory.** A call made and not typed in
   never existed; a manager's report is a report of typing, not of calling.
2. **It cannot answer "how much did we call today".** Duration, direction and
   missed calls are on the phone; a form cannot recover them.
3. **The reference app (LeadSo) reads the device's call log**, which is the
   behaviour this product is measured against.

The opposite extreme — mirroring an employee's whole call log to the server —
is a different failure: their private calls are not the organization's
business, and storing them creates a liability under DPDP/GDPR that no CRM
feature justifies.

## Decision

### The rule

**The phone measures, the device filters, the server keeps only work calls.**

**Distribution decides how much the phone may measure.** LeadBee is going
through the Play Store, where `READ_CALL_LOG` is restricted, so the shipping
build measures the calls it places itself (lead, time, duration via call state)
and shows Incoming, Missed and Rejected as not tracked rather than as zero. The
call-log reading below is the internal-build flavour — the same model, the same
endpoints, one extra source. Platform by platform, including why iOS is
permanently narrower, is in
[CALL-TRACKING-PLATFORMS.md](../CALL-TRACKING-PLATFORMS.md).

1. The app reads the phone's own call log (Android; see Constraints).
2. **On the device**, each entry is matched against the organization's lead
   numbers, in normalised form (digits only, country code applied).
3. **Only entries that match a lead leave the phone.** Everything else is
   discarded before any request is made — a call to a doctor or a spouse is
   never sent, never stored, never seen by an organizer.
4. The server stores the matched calls as the team's activity record: which
   lead, which member, when, how long, which direction.

### Data model

`CallLog` stays the record, and gains what a measured call has:

| Field | Meaning |
| --- | --- |
| `source` | `device` (read from the phone) or `manual` (written before this change) |
| `direction` | `incoming`, `outgoing`, `missed`, `rejected` |
| `deviceCallId` | The phone's own id for the entry, unique per member — the idempotency key |
| `phoneNumber` | The number as dialled, normalised |
| `duration` | Seconds, as the phone reports; manual rows keep their minutes |

`outcome` stays, but becomes optional: a device call has a direction, not an
opinion. A member may still set an outcome on a call afterwards.

Uniqueness on `{organizationId, calledBy, deviceCallId}` makes the sync
idempotent: re-sending the same window writes nothing new.

### Sync

- `POST /calls/sync` takes a batch of matched calls and upserts them by
  `deviceCallId`, returning what was written.
- The device syncs on app open and after a call ends, sending only entries
  newer than its last acknowledged sync.
- The lead's `callCount` and `lastContactedAt` are recomputed from the call
  logs themselves (`refreshCallSummary`), so the denormalised copy stays true
  whatever wrote the call.

### Reading

- `GET /calls` — the team's calls, filtered by range, direction, member, lead.
- `GET /calls/stats` — the counters and series behind Call Analytics.
- Visibility follows the same rule as tasks and meetings: an organizer sees the
  organization's calls; everyone else sees their own.

### Consent

Call-log access is asked for in its own screen, explaining what is read, what
is sent (only calls matching a lead) and what is not. Declining leaves the app
working with an empty call history; it is not a condition of using the CRM.

## Constraints

- **Android only.** iOS has no call-history API at all. On iOS the call
  sections stay empty, and that is permanent, not pending.
- **Restricted permission.** `READ_CALL_LOG` is a Play-restricted permission:
  an app needs to be the device's default Phone/SMS/Assistant handler, or hold
  an approved declaration, or be distributed privately (Managed Google Play,
  or an internal build). A public Play listing without an approved declaration
  risks removal. **Distribution has to be decided before this ships.**
- **A native build is required.** Expo has no call-log API, so this needs a
  native module and a new binary; it cannot arrive as an OTA update.

## Consequences

- Nobody types a call in any more. Calls that were typed in before stay, marked
  `source: 'manual'`, and stay readable.
- Reports measure calling, not typing — but only on Android, and only for
  members who granted the permission. Every number is therefore a floor, not a
  total, and the screens say so rather than implying completeness.
- A call to a number that is not a lead is invisible to the product. That is
  the point.

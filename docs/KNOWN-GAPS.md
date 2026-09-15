# Known Gaps

Work that is **not done yet**, recorded so it is solved deliberately rather than
rediscovered. Written on 2026-09-11, after the team management, assignment,
notifications, quick replies / documents and stages / drop-tags work, and the
code review that followed it.

**How to use this file.** Each item says what is wrong, why it matters, where
it lives, how to fix it and when it counts as done. When you fix one, tick it,
link the PR, and leave it here for a release before deleting it. Rule IDs refer
to [docs/standards](./standards/README.md).

**Fixed on 2026-09-12, still uncommitted:** 2.2, 2.6, 3.6, 3.7, 4.1 and the
version string in 4.3. Each is ticked below with what changed.

| Priority | Meaning |
| --- | --- |
| **P0** | Blocks shipping the current changes to real users |
| **P1** | A real defect or risk in production; fix in the next cycle |
| **P2** | Standards debt or polish; schedule it |

---

## 1. Release blockers

### [ ] 1.1 Push notifications are built but not switched on — P0

- **What.** The app registers for push and the API sends through Expo, but no
  push has ever been delivered. Three things are missing:
  1. an EAS `projectId` in [mobile/app.json](../mobile/app.json)
     (`expo.extra.eas.projectId`),
  2. Android FCM credentials uploaded to the Expo project,
  3. a new native build — `expo-notifications` is a native module and cannot
     ship over the air (MOB-19).
- **Why.** Until then, [pushNotifications.ts](../mobile/src/services/pushNotifications.ts)
  quietly skips registration. The in-app inbox works, so nobody notices push is
  off.
- **Fix.** Link the EAS project, add the credentials, build, install. On a
  device, assign a lead to that user and confirm the push arrives, and that
  tapping it from a closed app opens the lead.
- **Done when.** A push arrives on a real device, and tapping it from both a
  closed and an open app opens the right screen and marks the inbox row read.

### [ ] 1.2 Stale index on `leaddropreasons` — P0

- **What.** Drop tags were first built with a soft delete and an
  `{ organizationId, isActive, sortOrder }` index. The field was removed; the
  index may still exist in any database the earlier version ran against.
- **Fix.** Run `npm run sync-indexes` in `backend/` against each environment.
- **Done when.** `db.leaddropreasons.getIndexes()` shows only `_id`,
  `organizationId`, `{organizationId, name}` (unique) and
  `{organizationId, sortOrder, name}`.

### [ ] 1.3 Justify the new cross-tenant write in the PR — P0

- **What.** [auth.service.ts](../backend/src/modules/auth/auth.service.ts)
  `updatePushToken` calls `withoutTenantScope` to take a push token away from
  whichever account held it before, in any tenant.
- **Why.** ARCH-4 requires every new call site to be justified in the PR
  description, or review must block it.
- **Fix.** Paste the reasoning from the code comment into the PR: a token
  identifies a device, one handset can be signed into different organizations
  over time, and the write is keyed only on a token the caller just proved it
  holds.

### [ ] 1.4 The "professional" plan is an empty draft — P0 (data, not code)

- **What.** The `spirit` organization is on plan `professional` v1, which has
  status `draft`, zero grants and no entitlement snapshot. Its legacy limits
  are all 0.
- **Why.** Every lead and every team member that organization tries to add is
  refused with a plan-limit error.
- **Fix.** In the super-admin dashboard, either publish `professional` with real
  grants, or move `spirit` to an active plan. Do not edit it in the database
  (CFG-6).
- **Done when.** An owner of `spirit` can add a lead and a team member.

---

## 2. Gaps in the new code

### [ ] 2.1 The audit trail cannot be read — P1

- **What.** User create, update, activate/deactivate and password reset now
  write to `AuditLog` ([audit.service.ts](../backend/src/modules/audit/audit.service.ts)).
  Nothing reads it back.
- **Why.** An audit trail no one can open does not answer "who changed this
  person's role?" during an incident.
- **Fix.** Add `GET /api/v1/audit` (paginated; filter by `entityType`,
  `entityId`, `actorId`, date range; guarded by a new `audit.view` permission
  or `requireOrganizer`). Add an "Activity" section on the team member screen.
  Then extend auditing to lead assignment, stage changes and deletes, which
  already have `AUDIT_ACTIONS` entries.
- **Done when.** An organizer can see, for one member, every access change with
  actor, time, before and after.

### [x] 2.2 Creating a lead checks the plan limit before permission — P1

- **What.** `POST /leads` in [lead.routes.ts](../backend/src/modules/leads/lead.routes.ts)
  runs `assertCanAddLead` (402) before `leadService.create` checks whether a
  non-organizer may assign the lead to someone else (403).
- **Why.** An agent at the plan limit who tries to assign is told to upgrade
  instead of "not allowed". A refused request should not reveal plan state,
  and denied must stay distinct from degraded (ENG-11).
- **Fix.** Move the "assign to someone else needs an organizer" check ahead of
  the quota check — for example, an exported
  `leadService.assertMayAssignOnCreate(requestedId, viewer)` called first in
  the route.
- **Done when.** The smoke check "agent cannot create a lead into someone
  else's book" returns 403 even when the tenant is at its lead limit.
- **Fixed 2026-09-12.** `leadService.assertMayAssignOnCreate` is exported and
  called first in the route; `create` still calls it, so the service is safe on
  its own. Five unit tests in
  [lead.service.test.ts](../backend/src/modules/leads/lead.service.test.ts).

### [ ] 2.3 One push device per user — P2

- **What.** `User.pushToken` is a single field. A second phone that registers
  takes over; the first stops receiving pushes until it relaunches.
- **Fix.** Store `pushDevices: [{ token, platform, lastSeenAt }]`, capped. Remove
  a device on logout and when Expo reports `DeviceNotRegistered`.

### [ ] 2.4 Push text is English only — P2

- **What.** The OS shows push text exactly as the server sent it. The in-app
  inbox is translated; the push is not (ADR-0002).
- **Why.** The app's language is saved on the device, not the account, so the
  server cannot know it.
- **Fix.** Send the language with `POST /auth/push-token`, store it next to the
  token, and render push copy per recipient.

### [ ] 2.5 Due-time reminders do not exist — P1

- **What.** Notifications fire on assignment only. Nothing reminds anyone when a
  follow-up, task or meeting is *due*, even though `reminderMinutesBefore` is
  stored on leads and meetings.
- **Fix.** Either schedule local notifications on the device when a reminder is
  saved (no server work), or add a scheduled job that sweeps due reminders per
  tenant. The job needs an ADR: it is new infrastructure, and it is a
  cross-tenant read (ARCH-4).

### [x] 2.6 The unread badge polls while the app is in the background — P2

- **What.** [useUnreadNotifications.ts](../mobile/src/hooks/useUnreadNotifications.ts)
  refetches every 60 seconds. TanStack Query is not told when the app is
  backgrounded.
- **Fix.** Wire `focusManager` to `AppState` in
  [queryClient.ts](../mobile/src/lib/queryClient.ts). That also enables
  refetch-on-focus everywhere.
- **Fixed 2026-09-12.** `queryClient.ts` subscribes `focusManager` to
  `AppState` (skipped on web, whose own visibility handling is correct).

### [ ] 2.7 Documents are links, not uploads — P2

- **What.** Lead documents store a URL someone pastes in. There is no file
  upload.
- **Fix.** Choose storage (S3 or compatible), write an ADR, issue pre-signed
  upload URLs scoped to the tenant, and scan uploads before they are served.

---

## 3. Engineering-standards debt

### [ ] 3.1 No CI — P1 (ENG-30)

- **What.** Nothing runs typecheck, unit tests or the smoke test on a pull
  request.
- **Fix.** A workflow that runs `npm run typecheck` and `npm test` for
  `backend`, and `npm run typecheck` for `mobile` and `dashboard`. Run
  `npm run smoke` against a throwaway MongoDB replica set in a service
  container.

### [ ] 3.2 New routes are only tested against a live database — P1 (ENG-19, ENG-21)

- **What.** Users, notifications, drop tags, the document library and
  quick-reply search are covered only by `npm run smoke`. Smoke writes to
  whatever database `.env` points at, and leaves audit entries behind.
- **Fix.** Route tests with `app.inject()` against an in-memory MongoDB
  (`mongodb-memory-server`, run as a replica set), one file per module,
  including the tenant-isolation negatives (ENG-20). Point smoke at a
  dedicated database.

### [ ] 3.3 Seat and lead limits can be exceeded under concurrency — P1

- **What.** `assertCanAddUser` / `assertCanAddLead` read `usage.*`, then the
  create happens, then the counter is incremented. Two creates at once can
  both pass at `limit - 1`.
- **Fix.** Reserve capacity atomically first:
  `Organization.updateOne({ _id, 'usage.leads': { $lt: limit } }, { $inc: { 'usage.leads': 1 } })`,
  treat `matchedCount === 0` as over the limit, and release the reservation if
  the create fails. Unlimited plans skip the condition.

### [ ] 3.4 `.lean()` reads still leak `organizationId` — P2 (BE-6, ARCH-6)

- **What.** `GET /users` (still used by pickers), `GET /leads` and around 20
  other list reads return plain objects that skip the `toJSON` transform.
- **Fix.** A shared serializer that strips `organizationId` and `__v` from lean
  results, applied at each call site. Keep `.lean()` itself.

### [ ] 3.5 Hard-coded English in existing screens — P2 (MOB-16, MOB-17)

- **What.** Screens that predate this work still have literal English, and some
  format dates by hand with `en-IN` / `en-GB`:
  - [lead/list.tsx](../mobile/app/lead/list.tsx), [lead/add.tsx](../mobile/app/lead/add.tsx), [lead/[id].tsx](../mobile/app/lead/[id].tsx)
  - [task/list.tsx](../mobile/app/task/list.tsx), [meeting/list.tsx](../mobile/app/meeting/list.tsx)
  - [(leads)/index.tsx](../mobile/app/(leads)/index.tsx), [LeadDrawer.tsx](../mobile/src/components/LeadDrawer.tsx)
  - [LeadCard.tsx](../mobile/src/components/LeadCard.tsx), [QuickReplyPanel.tsx](../mobile/src/components/QuickReplyPanel.tsx), [LeadDocumentsPanel.tsx](../mobile/src/components/LeadDocumentsPanel.tsx)
- **Fix.** Move every string into `en.json` / `gu.json`. Replace hand-formatted
  dates with `formatDate` / `formatTime` from
  [utils/format.ts](../mobile/src/utils/format.ts). Stage and lead-source labels
  should come from `leads.stages.*` / `leads.sources.*` keys, not
  `LEAD_STAGE_META.label`.

### [x] 3.6 Mobile lockfile is not committed — P1 (ENG-27)

- **What.** [mobile/.gitignore](../mobile/.gitignore) ignores `package-lock.json`,
  so installs are not reproducible. `expo-notifications` is recorded only in the
  ignored file.
- **Fix.** Remove the ignore line and commit `mobile/package-lock.json` in its
  own PR.
- **Fixed 2026-09-12.** The ignore line is gone, replaced by a comment saying
  why the file is kept. The lockfile itself is now untracked-and-visible; add it
  in its own commit, since it is a large file and belongs on its own.

### [x] 3.7 Some lookup writes have no permission guard — P1 (ENG-25, BE-11)

- **What.** In [lookup.routes.ts](../backend/src/modules/lookups/lookup.routes.ts),
  `POST /projects`, `PUT /projects/:id`, `POST /purposes` and
  `DELETE /purposes/:id` require only a signed-in user. Any agent can create,
  rename or retire a company-wide project or purpose. `GET /purposes` and
  `GET /projects` are unbounded (ENG-15).
- **Fix.** Add `requireOrganizer` (or `settings.manage`) to the writes; cap the
  lists as the drop-tag list does.
- **Fixed 2026-09-12.** Every project and purpose write now carries
  `requireOrganizer`, and both lists are capped at 200 like the drop tags. This
  matches what the app already showed — the purposes screen and the purpose
  picker on the lead form both gate their create and edit controls on
  `isOrganizer` — so no screen loses a control it was offering. Smoke covers the
  agent 403 on both.

### [ ] 3.8 The app works out permissions its own way — P2 (MOB-2)

- **What.** The auth store's `hasPermission` treats `owner` / `admin` as holding
  everything, and [lead/[id].tsx](../mobile/app/lead/[id].tsx) decides `isAdmin`
  from role strings. The server resolves permissions from the role document.
- **Why.** It is UI only — the server still enforces — but the two can disagree,
  showing buttons that fail or hiding ones that would work.
- **Fix.** Have `/auth/me` return the effective permissions (it already does) and
  make `hasPermission` read only those. Replace role-string checks with
  `isOrganizer` or a named permission.

---

## 4. Broken or leftover endpoints

### [x] 4.1 Renaming and reordering purposes call routes that do not exist — P1

- **What.** [purpose.service.ts](../mobile/src/services/purpose.service.ts) calls
  `PUT /purposes/:id` and `PUT /purposes/reorder`. Neither is implemented, so
  editing and drag-to-reorder on the Service Create screen fail.
- **Fix.** Add both routes (organizer-only; reorder takes an ordered id list and
  writes `sortOrder` in a single bulk write), or remove the controls.
- **Fixed 2026-09-12.** Both routes exist, organizer-only. Reorder is a single
  `updateMany` with a `$indexOfArray` pipeline rather than a `bulkWrite` — the
  tenant plugin does not hook `bulkWrite`, so that would have been an unscoped
  write. Smoke asserts the new sort position lands, that an agent is refused,
  and that another tenant sending the same ids changes nothing.

### [ ] 4.2 Default-project leftovers — P2

- **What.** The mobile default-project feature was removed, but
  `PUT /auth/default-project`, `User.defaultProject` and the `defaultProject`
  populate in `GET /auth/me` remain. The mobile file
  [project.service.ts](../mobile/src/services/project.service.ts) is now unused;
  deleting it was blocked by a local tool guard, not a decision.
- **Fix.** Remove the route and field (a migration that `$unset`s
  `defaultProject`), and delete the unused mobile service.

### [ ] 4.3 Placeholder values on the agent home and menu — P2

- **What.** The agent home shows fixed `₹0` targets and `00` call cards. The
  drawer shows a hard-coded `v1.0.7`.
- **Fix.** Hide the target and call cards until those features exist (see
  section 5). Show `Constants.expoConfig?.version`, as Settings already does.
- **Partly fixed 2026-09-12.** The drawer reads the version from the manifest
  now. The placeholder ₹0 target and `00` call cards are still there: they are
  the shape of features 5.1 and 5.4, and removing them is a design call, not a
  cleanup.

---

## 5. Features the reference app has that LeadBee does not

From the LeadSo comparison. Not started. Each needs its own design; items
marked *ADR* add infrastructure or a policy decision.

| Feature | What it needs | Notes |
| --- | --- | --- |
| **Targets & Earning** | Target model per user and period, organizer screen to set targets, agent progress card | Replaces the placeholder home cards (4.3) |
| **Announcements** | Tenant-owned model with expiry, organizer create screen, agent list, optional push | Reuses the notification pipeline |
| **Ask Query inbox** | `GET /leads/queries` across leads, respecting visibility | Per-lead threads already exist |
| **Call tracking** *ADR* | Read the device call log (Android `READ_CALL_LOG`), match calls to leads, sync durations | Google Play restricts this permission — check the policy first |
| **Call Activity report** | A call type on `CallLog` (New, Follow-up, Payment, Upselling, Review, Service) and a date-range report | |
| ~~**Meetings: Missed status**~~ | Done 2026-09-15: derived at read time, with All / Today / Tomorrow / Upcoming / Completed / Cancelled / Rescheduled / Missed tabs and counts | Acting on a missed meeting is still open (7.10) |
| **Lead form fields** | Company name, editable lead date, "save to phone contacts" (`expo-contacts`, new build), customer ID preview | |
| **Lead card details** | Show purpose, quality and estimate amount | Screen-only change |
| **Support tickets** | Model, list with Open / Pending / Closed, create flow | |
| **Send Requests** | Define it first — the reference app's list was empty | |
| **Attendance, Reports** | — | "Coming soon" in the reference app as well |

---

## 6. Registration and accounts

Added 2026-09-13 with [ADR-0003](./adr/0003-pre-tenant-accounts.md): a person
registers in the app, confirms their email, and appears in the console under
**Accounts**.

### [ ] 6.1 No mail transport — P0 before registration ships

- **What.** [lib/mailer.ts](../backend/src/lib/mailer.ts) logs "would have sent"
  instead of delivering. Outside production the API returns the code as
  `devCode`; in production registration answers 503 `EMAIL_UNAVAILABLE`.
- **Fix.** Choose a provider, write its ADR (external dependency), put the
  credentials in `env.ts`, and replace `mailer.send`. Nothing else changes.
- **Done when.** A code arrives in a real inbox from a production-like
  environment, and no response carries `devCode` there.

### [ ] 6.2 A registered person cannot join or create an organization yet — P0 for the feature

- **What.** A person with no membership now signs in to an account session
  ([ADR-0004](./adr/0004-account-is-the-identity.md)) and lands on the
  "not part of an organization yet" screen
  ([no-organization.tsx](../mobile/app/no-organization.tsx)). **Create your own
  organization** works (`POST /accounts/organizations`, 2026-09-13): it
  provisions with the signed-in account as owner and switches the app into the
  new organization. **Join an organization** does nothing yet.
- **Fix.** *Join* (invite code, email domain, or request-and-approve), creating
  a membership through `memberService.addMember`, as an account-realm route
  (`authenticateAccount`) that answers with a tenant session like create does.
- **Done when.** A newly registered person can reach a working organization.

### [ ] 6.3 Registration limits are per instance — P1

- **What.** The register, verify and resend limits use the in-memory rate-limit
  store, so behind a load balancer each node grants its own quota.
- **Fix.** Move `@fastify/rate-limit` to its Redis store before scaling out.

### [ ] 6.4 Console search scans the collection — P2

- **What.** Accounts search is a case-insensitive regex across four fields.
  Fine at thousands of accounts; a collection scan at millions.
- **Fix.** A text index, or a search service, when the count warrants it.

### [ ] 6.5 No self-serve deletion or data export — P2 (DPDP / GDPR)

- **What.** Only a platform owner can erase an account, and nobody can export
  their own data.
- **Fix.** An in-app "delete my account" request that lands in the console, and
  a data export.

---

### [ ] 6.6 Removing someone from an organization is not built — P1

- **What.** A membership can be deactivated but not removed. Because an account
  with memberships cannot be deleted from the console (ADR-0004), erasing a
  person who was ever a member is blocked.
- **Fix.** A "remove from organization" action that deletes the membership,
  reassigns or keeps their leads by policy, frees the seat and audits it.

### [ ] 6.7 Admin-typed emails are unverified — P2

- **What.** Accounts created by the backfill, by team add and by provisioning
  carry emails someone else typed. They are marked unverified and nothing
  prompts the person to confirm.
- **Fix.** Once mail is delivered (6.1), ask for confirmation at first sign-in,
  and decide whether an unconfirmed email may be used to sign in.

### [ ] 6.8 Taken identifiers are visible to anyone registering — P2 (accepted)

- **What.** Registration and team add answer `EMAIL_IN_USE` / `PHONE_IN_USE`.
  This was a product decision in ADR-0004.
- **Watch.** Rate limits are the only bound (and are per instance, 6.3). If
  scraping shows up, add a CAPTCHA or proof of work to registration.

### [ ] 6.9 The owned-organization limit is not yet a setting or a plan grant — P2 (CFG-1)

- **What.** How many organizations one person may own is
  `Account.ownedOrganizationLimit`, else `DEFAULT_OWNED_ORGANIZATION_LIMIT` (3)
  from the environment. Nothing in the console reads or sets the per-account
  value yet.
- **Fix.** Move the default to a Tier 1 platform setting
  (`organizations.ownedPerAccountDefault`), let a plan grant a higher number,
  and add the per-account override to the account detail page, audited.

### [ ] 6.10 A person cannot leave an organization — P1

- **What.** The switcher and the Organizations screen offer switch and "set as
  default", but not leave. Leaving needs what 6.6 needs (what happens to their
  leads and seat), plus an owner handing over ownership first.
- **Fix.** Build 6.6, then a self-serve "Leave organization" on the
  Organizations screen that refuses the last owner.

---

## 7. Leads, meetings and tasks

Added 2026-09-15, after the lead-management review. Fixed in the same change:
edit lead (it created a duplicate), the stage chosen at creation, staged task
and meeting comments, attendee-aware meeting slots, server-side double-booking
and past-time checks, agents booking meetings on their leads, within-tenant
access on tasks and meetings, meetings and tasks on the lead screen, archive and
restore with a deleted lead, meeting ↔ lead updates, the automatic lead
timeline, meeting reschedule/cancel/reopen with notifications and task sync,
edit/delete for tasks and meetings in the app, time-zone-aware days and booking
window, duplicate-phone warning, per-person bookmarks, required drop reason
linked to drop tags, purpose renames carried to leads, tab counts that match the
list, task date order, and editing and deleting call logs. The smoke test covers
each.

The same day, after comparing with the reference app (LeadSo), these were
added: the eight meeting tabs including Missed, filter sheets (meetings: date
range, type, purpose; tasks: date range, label), customer name and number
search on the server for both lists, the task card with description, comment
and checklist counts and member avatars, the task detail's Comments / Members /
Check List tabs, and the meeting detail with the lead's deal value, priority,
source and purpose, WhatsApp and Call, and Status / Time Line tabs. Items 7.7
onward are what that work left.

### [ ] 7.1 Run the bookmark migration in every environment — P0 before deploy

- **What.** Bookmarks moved from one shared `Lead.isBookmarked` flag to each
  person's `Lead.bookmarkedBy`. Until the migration runs, existing bookmarks do
  not show and the old index remains.
- **Fix.** `npx tsx src/scripts/migrateLeadBookmarks.ts` (dry run), then
  `--apply`, in `backend/` against each environment. Applied to the local dev
  database on 2026-09-15 (6 bookmarks moved, old index dropped).

### [ ] 7.2 No bulk actions, import or export — P2

- **What.** Leads are assigned, moved between stages and deleted one at a time.
  There is no CSV import (portals, spreadsheets) and no export.
- **Fix.** `POST /leads/bulk` (organizers; assign / stage / delete, capped, one
  audit entry per lead) with multi-select on the lead list; an import job with a
  duplicate report; an export honouring the plan's `crm.exports` feature.

### [ ] 7.3 Lead timeline activity is English only — P2 (MOB-16)

- **What.** Activity entries ("Moved the lead from New to Meeting") are written
  as English text by the API. Each also stores an `event` code and `meta`.
- **Fix.** Render activity in the app from `event` + `meta` through i18n, and
  keep `text` only as a fallback for older builds.

### [ ] 7.4 The double-booking check is not atomic — P2

- **What.** Booking and rescheduling refuse a slot that overlaps an attendee's
  open meeting, but two requests for the same attendee at the same moment can
  both pass the check.
- **Fix.** A per-attendee lock (a short-lived `bookingLocks` document keyed on
  attendee and day, created in a transaction with the meeting), or re-check
  after insert and roll back the later one.

### [ ] 7.5 Deleted leads have Undo but no recycle bin — P2

- **What.** Deleting a lead shows Undo for a few seconds. After that the API can
  still list (`GET /leads?deleted=true`) and restore (`POST /leads/:id/restore`)
  it, but no screen does.
- **Fix.** A "Deleted leads" view for organizers in the lead list's filter, with
  Restore, and a retention period after which deleted leads are purged.

### [ ] 7.6 Task and meeting services have no unit tests — P2 (ENG-19)

- **What.** The access rules and time-zone arithmetic are unit tested; the
  services themselves are covered only by the smoke test against a live
  database (see 3.2).
- **Fix.** Service tests with an in-memory MongoDB for conflicts, reopening,
  lead cascade and restore.

### [ ] 7.7 The lead list can show "No leads found" under a count of one — P1

- **What.** Going back to All Leads can show the empty state while the tabs and
  stats show leads. The rows are copied into local state (`allLeads`) inside
  the query function, and a cached result (30-second `staleTime`) never runs
  that function again, so the state stays empty after the screen remounts.
- **Where.** `mobile/app/lead/list.tsx` — the `leads` `useQuery`.
- **Fix.** Read the rows from `useInfiniteQuery` pages, as the meeting and task
  lists now do; keep delete and restore as cache updates, not local state.
- **Done when.** Opening a lead and going back within 30 seconds still lists it.

### [ ] 7.8 Customer search scans leads with a regular expression — P2

- **What.** Meeting and task search first looks up matching leads with a
  case-insensitive, unanchored regex on name, mobile and lead number. That
  cannot use an index, so it reads every lead in the organization per search.
  Fine at today's sizes; slow for large organizations.
- **Where.** `baseQuery` in `meetings/meeting.service.ts`, `buildQuery` in
  `tasks/task.service.ts`.
- **Fix.** A normalized search field (lower-case name, digits-only phone) with a
  prefix index, or a text index; cap the matched lead ids.

### [ ] 7.9 Meeting tab counts run eight queries — P2

- **What.** `GET /meetings/stats/tab-counts` runs one count per tab.
- **Fix.** One aggregation with `$facet`, sharing the base filter.

### [ ] 7.10 A missed meeting is shown, not acted on — P2

- **What.** Missed is worked out when the list is read. Nobody is told when a
  meeting becomes missed, and the lead is not flagged for follow-up.
- **Fix.** A scheduled sweep that notifies the attendees and booker once per
  meeting, and optionally a daily digest. Shares the scheduler needed for 2.5.

### [ ] 7.11 Task labels are free text — P2 (CFG)

- **What.** Each task stores its own label names and colours. A typo makes a
  new label, a rename does not carry to other tasks, and the filter lists the
  labels found on visible tasks (up to 100).
- **Fix.** A tenant label lookup like purposes of inquiry, picked on the task
  form, with renames carried to tasks.

### [ ] 7.12 Dates, times and durations are formatted in English — P2 (MOB-16)

- **What.** The new cards and detail screens format dates with fixed `en-GB` /
  `en-IN` locales, and `formatDuration` returns "1 Hour". Gujarati users see
  English month names and durations.
- **Where.** `MeetingCard`, `TaskCard`, `app/meeting/[id].tsx`,
  `app/task/[id].tsx`, `config/taskMeeting.ts`.
- **Fix.** Format through the active i18n language, durations through i18n
  plurals.

### [ ] 7.13 Meeting detail has no company — P2

- **What.** The reference app shows the customer's company on a meeting.
  LeadBee's lead has no company field, so the meeting detail shows the client
  ID in its place.
- **Fix.** Add the company to the lead form (see "Lead form fields" in section
  5), then a row on the meeting detail.

### [ ] 7.14 Not yet walked through on a device — P2

- **What.** Booking, the new cards, meeting detail, completing a meeting with an
  outcome (its task followed) and the task detail tabs were checked on a phone
  on 2026-09-15. Not yet: applying a filter, the Missed tab with real data,
  ticking checklist items, and Reschedule / Cancel from the Status tab. The
  smoke test covers the filters and tabs on the API.
- **Also seen.** The dashed line between the dates in the dark task header
  draws as a solid line on Android.
- **Done when.** Each flow above is checked on Android and iOS.

---

## 8. Local development notes

Not code defects, but they cost time.

- **Metro must restart after a native package is installed.** Installing
  `expo-notifications` replaced `expo-constants` under a running Metro, and it
  then failed with "Unable to resolve module expo-constants" until restarted.
  After any `npx expo install`, stop Metro and start it again.
- **The smoke test writes to the configured database.** It creates and removes a
  temporary tenant, and leaves audit entries in `acme-realty`. Point it at a
  dedicated database (see 3.2).

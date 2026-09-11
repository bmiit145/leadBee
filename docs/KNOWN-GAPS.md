# Known Gaps

Work that is **not done yet**, recorded so it is solved deliberately rather than
rediscovered. Written on 2026-09-11, after the team management, assignment,
notifications, quick replies / documents and stages / drop-tags work, and the
code review that followed it.

**How to use this file.** Each item says what is wrong, why it matters, where
it lives, how to fix it and when it counts as done. When you fix one, tick it,
link the PR, and leave it here for a release before deleting it. Rule IDs refer
to [docs/standards](./standards/README.md).

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

### [ ] 2.2 Creating a lead checks the plan limit before permission — P1

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

### [ ] 2.6 The unread badge polls while the app is in the background — P2

- **What.** [useUnreadNotifications.ts](../mobile/src/hooks/useUnreadNotifications.ts)
  refetches every 60 seconds. TanStack Query is not told when the app is
  backgrounded.
- **Fix.** Wire `focusManager` to `AppState` in
  [queryClient.ts](../mobile/src/lib/queryClient.ts). That also enables
  refetch-on-focus everywhere.

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

### [ ] 3.6 Mobile lockfile is not committed — P1 (ENG-27)

- **What.** [mobile/.gitignore](../mobile/.gitignore) ignores `package-lock.json`,
  so installs are not reproducible. `expo-notifications` is recorded only in the
  ignored file.
- **Fix.** Remove the ignore line and commit `mobile/package-lock.json` in its
  own PR.

### [ ] 3.7 Some lookup writes have no permission guard — P1 (ENG-25, BE-11)

- **What.** In [lookup.routes.ts](../backend/src/modules/lookups/lookup.routes.ts),
  `POST /projects`, `PUT /projects/:id`, `POST /purposes` and
  `DELETE /purposes/:id` require only a signed-in user. Any agent can create,
  rename or retire a company-wide project or purpose. `GET /purposes` and
  `GET /projects` are unbounded (ENG-15).
- **Fix.** Add `requireOrganizer` (or `settings.manage`) to the writes; cap the
  lists as the drop-tag list does.

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

### [ ] 4.1 Renaming and reordering purposes call routes that do not exist — P1

- **What.** [purpose.service.ts](../mobile/src/services/purpose.service.ts) calls
  `PUT /purposes/:id` and `PUT /purposes/reorder`. Neither is implemented, so
  editing and drag-to-reorder on the Service Create screen fail.
- **Fix.** Add both routes (organizer-only; reorder takes an ordered id list and
  writes `sortOrder` in a single bulk write), or remove the controls.

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
| **Meetings: Missed status** | A missed state (or a derived one) for past scheduled meetings, and more tabs | Derive at read time or sweep on a schedule (see 2.5) |
| **Lead form fields** | Company name, editable lead date, "save to phone contacts" (`expo-contacts`, new build), customer ID preview | |
| **Lead card details** | Show purpose, quality and estimate amount | Screen-only change |
| **Support tickets** | Model, list with Open / Pending / Closed, create flow | |
| **Send Requests** | Define it first — the reference app's list was empty | |
| **Attendance, Reports** | — | "Coming soon" in the reference app as well |

---

## 6. Local development notes

Not code defects, but they cost time.

- **Metro must restart after a native package is installed.** Installing
  `expo-notifications` replaced `expo-constants` under a running Metro, and it
  then failed with "Unable to resolve module expo-constants" until restarted.
  After any `npx expo install`, stop Metro and start it again.
- **The smoke test writes to the configured database.** It creates and removes a
  temporary tenant, and leaves audit entries in `acme-realty`. Point it at a
  dedicated database (see 3.2).

# ADR-0002: In-app notifications with Expo push delivery

## Status
Proposed

## Context
Agents are handed leads, tasks and meetings by organizers, and nothing told
them. The bell icons in the app did nothing, `POST /auth/push-token` stored a
token no code ever used, and an assignment was discovered only by opening the
right list. The reference app has a notification screen and push alerts.

Two separate needs are in play:

- a **record** a user can open later — what was assigned to them, by whom;
- a **nudge** that reaches a phone that is not open.

Push alone cannot be the record: delivery is best-effort, a user can deny the
permission, and a device may be offline for days.

## Decision
1. **A tenant-owned `Notification` collection is the record.** One row per
   recipient, written when a lead, task or meeting is assigned to someone other
   than the actor. It stores the event — `type`, entity, actor, a display
   subject — not rendered text, so the app translates the inbox (MOB-16).
   Rows expire after 90 days through a TTL index.
2. **Push is delivered through Expo's push service** (`exp.host`), called with
   `fetch`. Expo fronts FCM and APNs behind the token the app already obtains,
   so the API holds no platform credentials. No SDK dependency: the protocol is
   one POST.
3. **Both are fail-open.** Recording is awaited so the unread badge is right
   when the request returns, but an error is logged, never thrown (ARCH-15).
   Push is fire-and-forget after the insert.
4. **Tokens are tied to a session, not an account.** Logout clears the stored
   token, so a shared handset stops receiving the previous user's alerts.
   Tokens Expo reports as `DeviceNotRegistered` are removed.

## Consequences
- A new external dependency at runtime: `exp.host`. When it is down, the inbox
  still works and only the nudge is lost.
- Push text is English. The app's language is a device setting, not an account
  one, so the server cannot know it; the in-app inbox is translated.
- Push reaches only one device per user — `User.pushToken` is a single field.
  A second device re-registers on its next launch and takes over.
- The mobile app needs `expo-notifications`, a native module: it ships in a new
  build, not over the air (MOB-19). Obtaining a token also needs an EAS
  `projectId` in the app config and, on Android, FCM credentials uploaded to
  Expo. Until then the app skips registration and the inbox works alone.
- Reminders due at a time (follow-ups, meeting start) are **not** covered —
  they need a scheduler or device-local notifications, a separate decision.

## Alternatives considered
- **FCM/APNs directly.** Two credential sets held by the API, two protocols,
  and token handling the Expo client already does. Rejected for the operational
  weight with no capability gain at this scale.
- **`expo-server-sdk`.** Adds a dependency to wrap one POST and receipt
  polling we do not yet use.
- **Push only, no stored inbox.** Loses every alert sent while permission was
  denied or the device was off, and gives the bell nothing to show.
- **Server-rendered, localized text stored on the row.** Freezes the language
  at write time and still has no reliable locale to render in.

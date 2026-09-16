# Call tracking: what each platform can actually measure

Written 2026-09-16, when manual call logging was removed and call tracking was
designed against the reference app (LeadSo).

**The short version.** LeadSo reads the phone's call log, which is why it shows
Incoming, Outgoing, Missed and Rejected. It can do that because it is
distributed internally. **LeadBee is going through the Play Store**, where that
permission is restricted — so LeadBee measures the calls it places itself, and
says plainly that it cannot see the rest. On iOS even that is narrower.

## Why not simply do what LeadSo does

`READ_CALL_LOG` is in Play's restricted SMS/Call Log group. An app may use it
only if it is the device's default Phone/SMS/Assistant handler, or holds an
approved Permissions Declaration for a documented core use case. A CRM does not
qualify by default, and shipping it without approval risks removal of the
listing — not a rejected update, the whole app.

LeadSo avoids this by never being listed: an internally distributed build is
not subject to that review. That is a distribution choice, not a technical one.

## What each platform can measure

| Signal | Android (Play) | Android (internal build) | iOS |
| --- | --- | --- | --- |
| Call placed from inside LeadBee | Yes | Yes | Yes |
| Duration of that call | Yes, via call-state (`READ_PHONE_STATE`) | Yes | Partly — only while the app is alive |
| Which lead it was | Yes — we dialled the number | Yes | Yes |
| Incoming call from a lead | **No** | Yes | No |
| Missed / rejected call | **No** | Yes | No |
| Calls made outside the app (native dialler) | **No** | Yes | No |

### Android on the Play Store — what LeadBee does

1. The agent taps Call on a lead. The app knows the lead and the number.
2. `READ_PHONE_STATE` (a normal runtime permission, not restricted) lets the
   app watch the call state change `OFFHOOK → IDLE`, which gives a real
   duration for the call it just placed.
3. That becomes a call record: lead, member, time, duration, direction
   `outgoing`, `source: 'app'`.

No call log is read, so nothing about the person's private calls is touched,
and the Play declaration is not needed.

The cost is honest and must be shown in the product: **a call made from the
native dialler is invisible**, and so is every incoming and missed call. The
counters are therefore "calls made from LeadBee", not "all calls", and the
screens say so. Anything else would be a number a manager could not trust.

### Android as an internal build — the LeadSo behaviour

If distribution moves to Managed Google Play (private app), an enterprise MDM,
or a direct APK, `READ_CALL_LOG` becomes available, and the same screens fill
with Incoming, Missed, Rejected and calls made outside the app. Per
[ADR-0005](./adr/0005-call-tracking.md) the matching to leads still happens on
the device, and only calls that match a lead are ever sent.

This is a build flavour, not a rewrite: one capability flag, one extra sync
source, the same model, endpoints and screens.

### iOS — what we should do

**There is no call history on iOS. Apple provides no API for it, for any app,
at any entitlement level.** No amount of review or paperwork changes that, so
the iOS plan is not "later", it is different.

What iOS does allow:

- **CallKit `CXCallObserver`** reports that *a* call started, connected and
  ended while the app is running — outgoing or incoming, with no number
  attached. Paired with a call the app placed, that yields a real duration.
- **Call Directory extension** identifies or blocks incoming numbers; it
  cannot record that a call happened.
- A tapped `tel:` link tells the app it handed off a call, and nothing after.

So on iOS LeadBee will:

1. Record the call it places: lead, member, time, direction `outgoing`.
2. Take the duration from `CXCallObserver` when the app is still alive, and
   otherwise leave duration empty rather than guessing.
3. Show Incoming, Missed and Rejected as **unavailable on iOS**, not as zero.
   A zero says nobody called; unavailable says we cannot see it. Only one of
   those is true.
4. Offer the agent a one-tap confirmation after a call — outcome, and duration
   if it is unknown — so the record is completed by a person rather than
   invented by the app.

## The route that works on both platforms: cloud telephony

There is a third option, and it is how most CRMs solve this — including on
iPhone, where nothing else can.

Calls are placed **through a telephony provider** (Exotel, Twilio, Knowlarity,
Ozonetel) instead of the handset's own line:

1. The agent taps Call. The app asks the provider to connect agent → customer.
2. The provider rings the agent, then the customer, and bridges them.
3. When the call ends, the provider posts a record back: direction, start,
   duration, whether it connected, and a recording if that is switched on.

What that buys:

| | Device call log | Cloud telephony |
| --- | --- | --- |
| Works on iOS | No | **Yes** |
| Works on Android under Play policy | Outgoing from the app only | **Yes, fully** |
| Incoming and missed calls | Internal builds only | **Yes** |
| Duration, reliably | Android only | **Yes** |
| Call recording | No | Yes, where lawful |
| Customer sees the agent's personal number | Yes | No — a virtual number |
| Permissions needed | `READ_CALL_LOG` (restricted) | **None** |
| Cost | Free | Per minute, plus a number rental |

The trade is money and a dependency for coverage and parity. It also removes
the permission problem entirely: nothing reads the phone, so nothing has to be
declared to Google, and nothing changes per platform.

**Recommendation.** If call tracking is meant to be a real, comparable number
across a team — the basis for targets, reports and payouts — this is the route
to take, and it is the only one that makes iOS equal to Android. Keep the
device-call route as the Android-internal option for organizations that will
not pay per minute.

### Shared design that makes this work

- One `CallLog` model for every platform, with `source` (`app`, `device`) and
  `direction`.
- Screens read capability from the client, not the platform name: each counter
  renders a number, an em dash for "not tracked here", and a single line
  explaining which is which.
- Reports state their basis ("calls placed from LeadBee"), so an Android and an
  iOS member are never silently compared on different denominators.

## Decisions still open

1. **How calls are placed.** Through the handset (free; Android-only tracking,
   partial on Play) or through a telephony provider (per-minute cost; full
   tracking, equal on iOS and Android). This is the decision the rest depend on.
2. **Distribution.** Play listing (this document's default), or private
   distribution to unlock full call-log tracking on Android.
3. **Post-call confirmation.** Whether agents are prompted after a call to
   confirm outcome and duration. Without telephony it is the only way to
   capture what the OS hides, and it costs the agent a tap.
4. **Retention.** How long call records are kept, and who may export them —
   and, with telephony, whether calls are recorded and how consent is given.


Next: the mobile side — a "Call Report" group in the drawer with Call Tracking and Call Activity, the tracking screen with tabs and the analytics icon, and recording a call when Call is tapped on a lead.

One honest note on the tabs: on a Play build, Incoming, Missed and Rejected can't be measured. I'll show those tabs as untracked rather than as zero, so nobody reads an empty tab as "no missed calls".
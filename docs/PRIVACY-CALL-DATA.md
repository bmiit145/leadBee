# How LeadBee handles call data

Last updated: 17 September 2026

This explains what LeadBee does with the calls on your phone, in plain terms.
It covers the Android app's use of the call log permission
(`android.permission.READ_CALL_LOG`) and is the policy referred to on the
consent screen shown before the app asks for that permission.

LeadBee is a customer relationship management app for businesses. Your employer
subscribes to it, and you sign in with an account they control. Call data is
handled for one purpose: **recording the calls you make and receive with the
customers in your employer's LeadBee account.**

## What LeadBee reads

When you allow it, LeadBee reads the call log on your phone: the number, the
date and time, whether the call was incoming, outgoing, missed or rejected, and
how long it lasted. LeadBee never reads, records or listens to the content of
any call.

## What leaves your phone — and what does not

**Your phone checks each call before anything is sent.** Every number in the
call log is compared with the customer numbers in your employer's LeadBee
account.

- **A call to or from a customer in LeadBee** is sent to your employer's
  LeadBee account: the number, time, direction and duration, and which customer
  and employee it belongs to.
- **Every other call stays on your phone.** Calls to your family, your doctor,
  your friends, a job interview, or any number that is not a customer in
  LeadBee are never uploaded, never stored on our servers, and never visible to
  your employer. They are discarded on the device.

LeadBee does not read your contacts, your messages, or the content of calls.

## Who can see the calls that are stored

- **You** see the calls you made and received with customers.
- **Managers and owners of your organization** see calls across their team.
  This is the point of a CRM: your employer already knows which customers you
  are calling on their behalf.
- **Nobody else.** Call data is never sold, never shared with advertisers, and
  never used for advertising or profiling. It is not shared with other
  organizations using LeadBee.

## Consent, and taking it back

The app explains this before it asks for the permission, and you choose. If you
decline:

- LeadBee keeps working. Leads, tasks, meetings and everything else are
  unaffected.
- The call sections simply stay empty.

You can withdraw consent at any time in **Profile → Settings → Call tracking**,
or by turning the permission off in Android Settings. From that moment the app
stops reading the call log. Calls already recorded against customers remain in
your employer's account as part of their business records — the same as a note
or a meeting you logged — and requests to erase those go to your employer, who
controls that data.

## How long it is kept

Call records are kept while your employer's account is active, under their
retention settings. When an organization is deleted, its call records are
deleted with it.

## Security

Call data travels over an encrypted connection (HTTPS), is stored in an access
controlled database, and is separated per organization: one business can never
read another's data.

## Who is responsible

Your employer is the controller of this data; LeadBee processes it on their
behalf under their instructions. Questions about what your employer does with
it go to them. Questions about how the app handles it go to the LeadBee team.

## Your rights

Depending on where you live (including under India's DPDP Act and the GDPR),
you may ask for a copy of your data, ask for it to be corrected or erased, or
object to how it is used. Ask your employer, who holds the account; LeadBee
supports them in answering.

## Contact

Write to the address published on the LeadBee Play Store listing, or contact
your organization's LeadBee administrator.

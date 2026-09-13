import { Types } from 'mongoose';
import { buildApp } from '../app.js';
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { Organization } from '../models/Organization.js';
import { User } from '../models/User.js';
import { Lead } from '../models/Lead.js';
import { Notification } from '../models/Notification.js';
import { LeadDropReason } from '../models/LeadDropReason.js';
import { PurposeOfInquiry } from '../models/PurposeOfInquiry.js';
import { Account } from '../models/Account.js';
import { Role } from '../models/Role.js';
import { AuditLog } from '../models/AuditLog.js';
import { LEAD_STAGE_ORDER } from '../config/constants.js';
import { withoutTenantScope } from '../lib/tenantContext.js';
import '../models/index.js';

/**
 * End-to-end smoke test against a live database, driven through Fastify's
 * `inject` so it exercises the real request lifecycle — plugins, auth, tenant
 * scoping, validation, serialisation — without binding a port.
 *
 * The assertion that matters most is CROSS-TENANT ISOLATION: tenant A must not
 * be able to read tenant B's lead, even when it knows the exact id. Everything
 * else here is a smoke check; that one is the product's core safety property.
 */

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    passed += 1;
    process.stdout.write(`  PASS  ${name}\n`);
  } else {
    failed += 1;
    failures.push(name);
    process.stdout.write(`  FAIL  ${name}${detail ? ` — ${JSON.stringify(detail)}` : ''}\n`);
  }
}

function section(title: string): void {
  process.stdout.write(`\n${title}\n${'-'.repeat(title.length)}\n`);
}

async function main(): Promise<void> {
  await connectDatabase();
  const app = await buildApp();
  await app.ready();

  // ─── Health ─────────────────────────────────────────────────────────────────
  section('Health');
  const health = await app.inject({ method: 'GET', url: '/api/v1/health' });
  check('GET /health returns 200', health.statusCode === 200, health.statusCode);

  const ready = await app.inject({ method: 'GET', url: '/api/v1/health/ready' });
  check('GET /health/ready reports database up', ready.statusCode === 200, ready.json());

  // ─── Tenant auth ────────────────────────────────────────────────────────────
  section('Tenant authentication');
  const badLogin = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { phone: '9000000001', password: 'wrong-password' },
  });
  check('Wrong password is rejected', badLogin.statusCode === 401, badLogin.statusCode);
  check(
    'Failure message does not reveal whether the phone exists',
    /invalid email, mobile number or password/i.test(badLogin.json()?.error?.message ?? ''),
    badLogin.json()?.error?.message
  );

  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { phone: '9000000001', password: 'Password@123' },
  });
  check('Owner can sign in', login.statusCode === 200, login.json());

  // One person, one account: the same password works with the email too. The
  // login above sends `phone`, the field older app builds still use.
  const emailLogin = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { identifier: 'owner@acme.test', password: 'Password@123' },
  });
  check('Owner can sign in with their email instead of their mobile', emailLogin.statusCode === 200, emailLogin.json());

  const ownerToken = login.json()?.data?.accessToken as string;
  const ownerAuth = { authorization: `Bearer ${ownerToken}` };
  check('Login returns an access token', Boolean(ownerToken));
  check(
    'Login response omits the password hash',
    login.json()?.data?.user?.password === undefined
  );
  check(
    'Login response omits organizationId from the user object',
    login.json()?.data?.user?.organizationId === undefined
  );

  const me = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: ownerAuth });
  check('GET /auth/me succeeds', me.statusCode === 200, me.statusCode);
  check('Owner is an organizer', me.json()?.data?.isOrganizer === true);
  check(
    'Organization is returned with the session',
    me.json()?.data?.organization?.slug === 'acme-realty',
    me.json()?.data?.organization?.slug
  );

  const noToken = await app.inject({ method: 'GET', url: '/api/v1/leads' });
  check('Unauthenticated request is refused', noToken.statusCode === 401, noToken.statusCode);

  const garbageToken = await app.inject({
    method: 'GET',
    url: '/api/v1/leads',
    headers: { authorization: 'Bearer not-a-real-token' },
  });
  check('Malformed token is refused', garbageToken.statusCode === 401);

  // ─── Leads ──────────────────────────────────────────────────────────────────
  section('Leads');
  const list = await app.inject({ method: 'GET', url: '/api/v1/leads', headers: ownerAuth });
  check('Lead list returns 200', list.statusCode === 200, list.statusCode);
  check('Seeded leads are visible to the organizer', (list.json()?.total ?? 0) === 40, list.json()?.total);
  check(
    'List response carries the pagination envelope',
    typeof list.json()?.totalPages === 'number' && typeof list.json()?.page === 'number'
  );

  const created = await app.inject({
    method: 'POST',
    url: '/api/v1/leads',
    headers: ownerAuth,
    payload: {
      contactName: 'Smoke Test Contact',
      contactPhone: '9998887771',
      priority: 'hot',
      source: 'referral',
    },
  });
  check('Lead can be created', created.statusCode === 201, created.json());
  const leadId = created.json()?.data?._id as string;
  check(
    'Created lead gets a per-tenant lead number',
    /^L-\d{4}$/.test(created.json()?.data?.leadNumber ?? ''),
    created.json()?.data?.leadNumber
  );

  const invalid = await app.inject({
    method: 'POST',
    url: '/api/v1/leads',
    headers: ownerAuth,
    payload: { contactPhone: '123' },
  });
  check('Lead without a name is rejected', invalid.statusCode === 422, invalid.statusCode);

  const stageOk = await app.inject({
    method: 'PUT',
    url: `/api/v1/leads/${leadId}/stage`,
    headers: ownerAuth,
    payload: { stage: 'follow_up' },
  });
  check('Valid stage transition is accepted', stageOk.statusCode === 200, stageOk.json());

  // Terminal stages may only reopen to `new` or `follow_up`.
  await app.inject({
    method: 'PUT',
    url: `/api/v1/leads/${leadId}/stage`,
    headers: ownerAuth,
    payload: { stage: 'order_received' },
  });
  const badStage = await app.inject({
    method: 'PUT',
    url: `/api/v1/leads/${leadId}/stage`,
    headers: ownerAuth,
    payload: { stage: 'meeting' },
  });
  check(
    'Illegal transition out of a terminal stage is refused',
    badStage.statusCode === 400,
    badStage.json()?.error?.message
  );

  const stats = await app.inject({
    method: 'GET',
    url: '/api/v1/leads/stats/dashboard',
    headers: ownerAuth,
  });
  check('Dashboard stats return 200', stats.statusCode === 200);
  check(
    'Stats cover every stage in LEAD_STAGE_ORDER',
    Object.keys(stats.json()?.data?.byStage ?? {}).length === LEAD_STAGE_ORDER.length,
    Object.keys(stats.json()?.data?.byStage ?? {}).length
  );

  const thread = await app.inject({
    method: 'POST',
    url: `/api/v1/leads/${leadId}/thread`,
    headers: ownerAuth,
    payload: { channel: 'notes', text: 'A note from the smoke test' },
  });
  check('Thread entry can be posted', thread.statusCode === 201, thread.json());

  const callLog = await app.inject({
    method: 'POST',
    url: `/api/v1/leads/${leadId}/call-logs`,
    headers: ownerAuth,
    payload: { outcome: 'answered', duration: 120, notes: 'Spoke briefly' },
  });
  check('Call log can be added', callLog.statusCode === 201, callLog.json());

  const afterCall = await app.inject({
    method: 'GET',
    url: `/api/v1/leads/${leadId}`,
    headers: ownerAuth,
  });
  check(
    'Call log denormalises onto the lead',
    afterCall.json()?.data?.callCount === 1 &&
      afterCall.json()?.data?.latestCallLog?.outcome === 'answered',
    { callCount: afterCall.json()?.data?.callCount }
  );

  // ─── Agent visibility ───────────────────────────────────────────────────────
  section('Within-tenant authorization');
  const agentLogin = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { phone: '9000000003', password: 'Password@123' },
  });
  check('Agent can sign in', agentLogin.statusCode === 200);
  const agentAuth = { authorization: `Bearer ${agentLogin.json()?.data?.accessToken}` };

  const agentMe = await app.inject({
    method: 'GET',
    url: '/api/v1/auth/me',
    headers: agentAuth,
  });
  check('Agent is not an organizer', agentMe.json()?.data?.isOrganizer === false);

  const agentList = await app.inject({
    method: 'GET',
    url: '/api/v1/leads',
    headers: agentAuth,
  });
  const agentTotal = agentList.json()?.total ?? 0;
  check(
    'Agent sees only their own book, not the whole organization',
    agentTotal > 0 && agentTotal < 40,
    { agentTotal, orgTotal: 40 }
  );

  const agentAssign = await app.inject({
    method: 'PUT',
    url: `/api/v1/leads/${leadId}/assign`,
    headers: agentAuth,
    payload: { assignedTo: agentLogin.json()?.data?.user?._id },
  });
  check('Agent cannot assign leads', agentAssign.statusCode === 403, agentAssign.statusCode);

  const agentDelete = await app.inject({
    method: 'DELETE',
    url: `/api/v1/leads/${leadId}`,
    headers: agentAuth,
  });
  check('Agent cannot delete leads', agentDelete.statusCode === 403, agentDelete.statusCode);

  const ownerId = login.json()?.data?.user?._id as string;
  const agentId = agentLogin.json()?.data?.user?._id as string;

  const agentHandoff = await app.inject({
    method: 'POST',
    url: '/api/v1/leads',
    headers: agentAuth,
    payload: { contactName: 'Agent Handoff', contactPhone: '9998887772', assignedTo: ownerId },
  });
  check(
    'Agent cannot create a lead straight into someone else’s book',
    agentHandoff.statusCode === 403,
    agentHandoff.statusCode
  );

  const agentOwnLeadId = agentList.json()?.data?.[0]?._id as string | undefined;
  const agentReassign = await app.inject({
    method: 'PUT',
    url: `/api/v1/leads/${agentOwnLeadId}`,
    headers: agentAuth,
    payload: { assignedTo: ownerId },
  });
  check(
    'Agent cannot reassign a lead through the generic update',
    agentReassign.statusCode === 403,
    agentReassign.statusCode
  );

  const ownerAssigns = await app.inject({
    method: 'PUT',
    url: `/api/v1/leads/${leadId}/assign`,
    headers: ownerAuth,
    payload: { assignedTo: agentId },
  });
  check('Organizer can assign a lead to an agent', ownerAssigns.statusCode === 200, ownerAssigns.json());

  const agentInbox = await app.inject({
    method: 'GET',
    url: '/api/v1/notifications',
    headers: agentAuth,
  });
  const handoffNotice = (agentInbox.json()?.data ?? []).find(
    (n: { type?: string; entityId?: string }) => n.type === 'lead_assigned' && n.entityId === leadId
  ) as { _id: string } | undefined;
  check('Assigning a lead notifies the assignee', Boolean(handoffNotice), agentInbox.json()?.total);

  const unread = await app.inject({
    method: 'GET',
    url: '/api/v1/notifications/unread-count',
    headers: agentAuth,
  });
  check('Unread count includes the new notification', (unread.json()?.data?.count ?? 0) > 0);

  const ownerInboxRead = await app.inject({
    method: 'PATCH',
    url: `/api/v1/notifications/${handoffNotice?._id}/read`,
    headers: ownerAuth,
  });
  check(
    'A notification cannot be marked read by anyone but its recipient',
    ownerInboxRead.statusCode === 404,
    ownerInboxRead.statusCode
  );

  const selfReset = await app.inject({
    method: 'POST',
    url: `/api/v1/users/${ownerId}/reset-password`,
    headers: ownerAuth,
    payload: { newPassword: 'Password@123' },
  });
  check(
    'Nobody resets their own password through user management',
    selfReset.statusCode === 403,
    selfReset.statusCode
  );

  const agentRecord = await app.inject({
    method: 'GET',
    url: `/api/v1/users/${agentId}`,
    headers: ownerAuth,
  });
  const originalDesignation = (agentRecord.json()?.data?.designation as string | undefined) ?? '';
  const smokeDesignation = `Smoke ${Date.now()}`;
  const memberUpdate = await app.inject({
    method: 'PUT',
    url: `/api/v1/users/${agentId}`,
    headers: ownerAuth,
    payload: { designation: smokeDesignation },
  });
  check('Organizer can update a team member', memberUpdate.statusCode === 200, memberUpdate.json());

  const auditEntry = await withoutTenantScope('smoke test verification', () =>
    AuditLog.findOne({ entityId: agentId, action: 'user_updated' }).sort({ createdAt: -1 }).lean()
  );
  check(
    'A team member change is written to the tenant audit trail, with only what changed',
    auditEntry?.after?.designation === smokeDesignation &&
      auditEntry?.actorName !== undefined &&
      Object.keys(auditEntry?.after ?? {}).length === 1,
    auditEntry?.after
  );

  await app.inject({
    method: 'PUT',
    url: `/api/v1/users/${agentId}`,
    headers: ownerAuth,
    payload: { designation: originalDesignation },
  });

  const dropReasonName = `Smoke drop reason ${Date.now()}`;
  const agentDropReason = await app.inject({
    method: 'POST',
    url: '/api/v1/drop-reasons',
    headers: agentAuth,
    payload: { name: dropReasonName },
  });
  check('Agent cannot add drop tags', agentDropReason.statusCode === 403, agentDropReason.statusCode);

  const ownerDropReason = await app.inject({
    method: 'POST',
    url: '/api/v1/drop-reasons',
    headers: ownerAuth,
    payload: { name: dropReasonName },
  });
  check('Organizer can add a drop tag', ownerDropReason.statusCode === 201, ownerDropReason.json());
  const dropReasonId = ownerDropReason.json()?.data?._id as string;

  // Projects and meeting purposes are company-wide vocabulary. They used to
  // need nothing but a signed-in user, so any agent could rename the list
  // everybody else picks from.
  const agentProject = await app.inject({
    method: 'POST',
    url: '/api/v1/projects',
    headers: agentAuth,
    payload: { name: `Smoke project ${Date.now()}` },
  });
  check('Agent cannot create a company-wide project', agentProject.statusCode === 403, agentProject.statusCode);

  const purposeName = `Smoke purpose ${Date.now()}`;
  const agentPurpose = await app.inject({
    method: 'POST',
    url: '/api/v1/purposes',
    headers: agentAuth,
    payload: { name: purposeName },
  });
  check('Agent cannot add a meeting purpose', agentPurpose.statusCode === 403, agentPurpose.statusCode);

  const ownerPurpose = await app.inject({
    method: 'POST',
    url: '/api/v1/purposes',
    headers: ownerAuth,
    payload: { name: purposeName },
  });
  check('Organizer can add a meeting purpose', ownerPurpose.statusCode === 201, ownerPurpose.json());
  const purposeId = ownerPurpose.json()?.data?._id as string;

  // The app has always called these two; until now neither route existed, so
  // renaming and drag-to-reorder failed with a 404 nobody surfaced.
  const renamedPurpose = `${purposeName} renamed`;
  const purposeRename = await app.inject({
    method: 'PUT',
    url: `/api/v1/purposes/${purposeId}`,
    headers: ownerAuth,
    payload: { name: renamedPurpose },
  });
  check(
    'Organizer can rename a meeting purpose',
    purposeRename.statusCode === 200 && purposeRename.json()?.data?.name === renamedPurpose,
    purposeRename.json()
  );

  const purposeReorder = await app.inject({
    method: 'PUT',
    url: '/api/v1/purposes/reorder',
    headers: ownerAuth,
    payload: { orderedIds: [purposeId] },
  });
  const reordered = await withoutTenantScope('smoke test verification', () =>
    PurposeOfInquiry.findById(purposeId).lean()
  );
  check(
    'Reorder writes the new sort position',
    purposeReorder.statusCode === 200 && reordered?.sortOrder === 0,
    reordered?.sortOrder
  );

  const agentReorder = await app.inject({
    method: 'PUT',
    url: '/api/v1/purposes/reorder',
    headers: agentAuth,
    payload: { orderedIds: [purposeId] },
  });
  check('Agent cannot reorder meeting purposes', agentReorder.statusCode === 403, agentReorder.statusCode);

  // ─── CROSS-TENANT ISOLATION ─────────────────────────────────────────────────
  section('Cross-tenant isolation (the one that matters)');

  const secondOrgSlug = `smoke-tenant-${Date.now()}`;
  // Kept, not inlined: the account checks later sign this owner in by email and
  // the cleanup removes their account.
  const tenantBOwnerEmail = `owner-${Date.now()}@smoke.test`;
  const tenantBOwnerPhone = `9${Date.now().toString().slice(-9)}`;
  const signup = await app.inject({
    method: 'POST',
    url: '/api/v1/signup',
    payload: {
      organizationName: 'Smoke Tenant',
      slug: secondOrgSlug,
      ownerName: 'Second Owner',
      ownerPhone: tenantBOwnerPhone,
      ownerEmail: tenantBOwnerEmail,
      password: 'Password@123',
    },
  });
  check('Self-serve signup provisions a second tenant', signup.statusCode === 201, signup.json());
  const tenantBAuth = { authorization: `Bearer ${signup.json()?.data?.accessToken}` };

  const tenantBList = await app.inject({
    method: 'GET',
    url: '/api/v1/leads',
    headers: tenantBAuth,
  });
  check(
    'A brand-new tenant sees zero leads, not tenant A’s 40',
    tenantBList.json()?.total === 0,
    tenantBList.json()?.total
  );

  // The critical one: tenant B knows tenant A's lead id exactly and asks for it.
  const crossRead = await app.inject({
    method: 'GET',
    url: `/api/v1/leads/${leadId}`,
    headers: tenantBAuth,
  });
  check(
    'Tenant B cannot READ tenant A’s lead by id',
    crossRead.statusCode === 404,
    crossRead.statusCode
  );

  const crossUpdate = await app.inject({
    method: 'PUT',
    url: `/api/v1/leads/${leadId}`,
    headers: tenantBAuth,
    payload: { contactName: 'Hijacked' },
  });
  check(
    'Tenant B cannot UPDATE tenant A’s lead by id',
    crossUpdate.statusCode === 404,
    crossUpdate.statusCode
  );

  const crossDelete = await app.inject({
    method: 'DELETE',
    url: `/api/v1/leads/${leadId}`,
    headers: tenantBAuth,
  });
  check(
    'Tenant B cannot DELETE tenant A’s lead by id',
    crossDelete.statusCode === 404 || crossDelete.statusCode === 403,
    crossDelete.statusCode
  );

  const crossThread = await app.inject({
    method: 'GET',
    url: `/api/v1/leads/${leadId}/thread?channel=notes`,
    headers: tenantBAuth,
  });
  check(
    'Tenant B cannot read tenant A’s lead thread',
    crossThread.statusCode === 404,
    crossThread.statusCode
  );

  const crossNotification = await app.inject({
    method: 'PATCH',
    url: `/api/v1/notifications/${handoffNotice?._id}/read`,
    headers: tenantBAuth,
  });
  check(
    'Tenant B cannot touch tenant A’s notification by id',
    crossNotification.statusCode === 404,
    crossNotification.statusCode
  );

  const tenantBDropReasons = await app.inject({
    method: 'GET',
    url: '/api/v1/drop-reasons',
    headers: tenantBAuth,
  });
  const tenantBReasonNames = (tenantBDropReasons.json()?.data ?? []).map(
    (reason: { name: string }) => reason.name
  );
  check(
    'A new tenant starts with its own drop tags, and never sees tenant A’s',
    tenantBReasonNames.length > 0 && !tenantBReasonNames.includes(dropReasonName),
    tenantBReasonNames
  );

  const crossDropReason = await app.inject({
    method: 'DELETE',
    url: `/api/v1/drop-reasons/${dropReasonId}`,
    headers: tenantBAuth,
  });
  check(
    'Tenant B cannot remove tenant A’s drop tag by id',
    crossDropReason.statusCode === 404,
    crossDropReason.statusCode
  );

  // Reorder writes through a single `updateMany`, so the tenant plugin filters
  // it. Tenant B's owner clears the organizer guard — only the scope stops the
  // write, which is exactly the property worth asserting. A throwaway id takes
  // position 0, so tenant A's purpose would move to 1 if the scope leaked.
  const crossReorder = await app.inject({
    method: 'PUT',
    url: '/api/v1/purposes/reorder',
    headers: tenantBAuth,
    payload: { orderedIds: [new Types.ObjectId().toString(), purposeId] },
  });
  const stillFirst = await withoutTenantScope('smoke test verification', () =>
    PurposeOfInquiry.findById(purposeId).lean()
  );
  check(
    'Tenant B cannot reorder tenant A’s meeting purposes',
    crossReorder.statusCode === 200 && stillFirst?.sortOrder === 0,
    stillFirst?.sortOrder
  );

  // Verify at the data layer too: tenant A's lead genuinely still says what it did.
  const untouched = await withoutTenantScope('smoke test verification', () =>
    Lead.findById(leadId).lean()
  );
  check(
    'Tenant A’s lead was not mutated by any of the above',
    untouched?.contactName === 'Smoke Test Contact',
    untouched?.contactName
  );

  const tenantBNumbering = await app.inject({
    method: 'POST',
    url: '/api/v1/leads',
    headers: tenantBAuth,
    payload: { contactName: 'Tenant B First Lead', contactPhone: '9111111111' },
  });
  check(
    'Lead numbering restarts per tenant (B’s first lead is L-0001)',
    tenantBNumbering.json()?.data?.leadNumber === 'L-0001',
    tenantBNumbering.json()?.data?.leadNumber
  );

  // ─── Platform realm separation ──────────────────────────────────────────────
  section('Platform control plane');
  const tenantTokenOnPlatform = await app.inject({
    method: 'GET',
    url: '/api/v1/platform/organizations',
    headers: ownerAuth,
  });
  check(
    'A tenant token is refused by the control plane',
    tenantTokenOnPlatform.statusCode === 401,
    tenantTokenOnPlatform.statusCode
  );

  const platformLogin = await app.inject({
    method: 'POST',
    url: '/api/v1/platform/auth/login',
    payload: { email: 'owner@leadbee.io', password: 'ChangeMe!2024' },
  });
  check('Platform admin can sign in', platformLogin.statusCode === 200, platformLogin.json());
  const platformAuth = {
    authorization: `Bearer ${platformLogin.json()?.data?.accessToken}`,
  };

  // ─── ACCOUNT REGISTRATION ───────────────────────────────────────────────────
  section('Account registration and the accounts console');

  // Registration is rate-limited per IP. A random address per run keeps
  // back-to-back smoke runs inside the limit without loosening it for real
  // callers (`trustProxy` is on, so the API reads x-forwarded-for).
  const octet = () => Math.floor(Math.random() * 254) + 1;
  const registrationHeaders = { 'x-forwarded-for': `10.${octet()}.${octet()}.${octet()}` };

  const accountEmail = `smoke-${Date.now()}@leadbee.test`;
  const lockEmail = `smoke-lock-${Date.now()}@leadbee.test`;
  const registration = {
    firstName: 'Smoke',
    lastName: 'Registrant',
    email: accountEmail,
    // Each smoke identity gets its own leading digit, so no two collide now that
    // a mobile number belongs to one person.
    phone: `7${Date.now().toString().slice(-9)}`,
    password: 'Password@123',
    acceptedTerms: true,
  };

  const registerAccount = (payload: Record<string, unknown>) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/accounts/register',
      headers: registrationHeaders,
      payload,
    });
  const verifyAccount = (payload: Record<string, unknown>) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/accounts/verify-email',
      headers: registrationHeaders,
      payload,
    });

  const firstRegistration = await registerAccount(registration);
  const firstReceipt = firstRegistration.json()?.data;
  check(
    'A person can register without an organization',
    firstRegistration.statusCode === 202 &&
      typeof firstReceipt?.registrationToken === 'string' &&
      /^\d{6}$/.test(String(firstReceipt?.devCode)),
    firstRegistration.json()
  );

  const withoutTerms = await registerAccount({ ...registration, acceptedTerms: false });
  // 422: a schema refusal, the API's convention for invalid input. Service
  // refusals (like a suspension without a reason, below) are 400.
  check(
    'Registration refuses a submission that did not accept the terms',
    withoutTerms.statusCode === 422,
    withoutTerms.statusCode
  );

  const secondRegistration = await registerAccount(registration);
  const secondReceipt = secondRegistration.json()?.data;
  check(
    'Registering an unverified address again rotates the registration token',
    secondRegistration.statusCode === 202 &&
      typeof secondReceipt?.registrationToken === 'string' &&
      secondReceipt.registrationToken !== firstReceipt?.registrationToken,
    secondRegistration.statusCode
  );

  // The pre-registration hijack: a code must only confirm the attempt that holds
  // the current token, never an earlier one.
  const staleToken = await verifyAccount({
    email: accountEmail,
    code: firstReceipt?.devCode,
    registrationToken: firstReceipt?.registrationToken,
  });
  check(
    'A replaced registration token cannot confirm the email, even with the right code',
    staleToken.statusCode === 400 &&
      staleToken.json()?.error?.code === 'INVALID_VERIFICATION_CODE',
    staleToken.json()
  );

  const wrongCode = firstReceipt?.devCode === '000000' ? '111111' : '000000';
  const wrongGuess = await verifyAccount({
    email: accountEmail,
    code: wrongCode,
    registrationToken: secondReceipt?.registrationToken,
  });
  check('A wrong verification code is refused', wrongGuess.statusCode === 400, wrongGuess.statusCode);

  const confirmed = await verifyAccount({
    email: accountEmail,
    code: firstReceipt?.devCode,
    registrationToken: secondReceipt?.registrationToken,
  });
  check('The emailed code confirms the address', confirmed.statusCode === 200, confirmed.json());

  // A confirmed person with no organization signs in to an account session —
  // the "create or join an organization" step — not to a 403.
  const signInWithoutOrg = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: registrationHeaders,
    payload: { identifier: accountEmail, password: registration.password },
  });
  const noOrgSession = signInWithoutOrg.json()?.data;
  check(
    'A confirmed person with no organization signs in to an account session',
    signInWithoutOrg.statusCode === 200 &&
      noOrgSession?.session === 'account' &&
      noOrgSession?.organization === null &&
      noOrgSession?.account?.email === accountEmail &&
      !('password' in (noOrgSession?.account ?? {})) &&
      !('refreshTokens' in (noOrgSession?.account ?? {})),
    signInWithoutOrg.json()
  );
  const accountSessionAuth = { authorization: `Bearer ${noOrgSession?.accessToken}` };

  const accountMe = await app.inject({
    method: 'GET',
    url: '/api/v1/accounts/me',
    headers: accountSessionAuth,
  });
  check(
    'The account session reads its own account, with no organizations',
    accountMe.statusCode === 200 && accountMe.json()?.data?.organizationCount === 0,
    accountMe.json()
  );

  const accountTokenOnTenant = await app.inject({
    method: 'GET',
    url: '/api/v1/leads',
    headers: accountSessionAuth,
  });
  check(
    'An account token cannot reach tenant routes',
    accountTokenOnTenant.statusCode === 401,
    accountTokenOnTenant.statusCode
  );

  const tenantTokenOnAccount = await app.inject({
    method: 'GET',
    url: '/api/v1/accounts/me',
    headers: ownerAuth,
  });
  check(
    'A tenant token cannot be used as an account session',
    tenantTokenOnAccount.statusCode === 401,
    tenantTokenOnAccount.statusCode
  );

  const refreshAccountSession = (refreshToken: unknown) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/accounts/session/refresh',
      headers: registrationHeaders,
      payload: { refreshToken },
    });
  const rotatedAccountSession = await refreshAccountSession(noOrgSession?.refreshToken);
  const rotatedAccountTokens = rotatedAccountSession.json()?.data;
  check(
    'An account session refresh rotates the token',
    rotatedAccountSession.statusCode === 200 &&
      typeof rotatedAccountTokens?.refreshToken === 'string' &&
      rotatedAccountTokens.refreshToken !== noOrgSession?.refreshToken,
    rotatedAccountSession.statusCode
  );

  const replayedAccountRefresh = await refreshAccountSession(noOrgSession?.refreshToken);
  const afterReplay = await refreshAccountSession(rotatedAccountTokens?.refreshToken);
  check(
    'Replaying a used account refresh token ends every account session',
    replayedAccountRefresh.statusCode === 401 && afterReplay.statusCode === 401,
    [replayedAccountRefresh.statusCode, afterReplay.statusCode]
  );

  const accountLogout = await app.inject({
    method: 'POST',
    url: '/api/v1/accounts/logout',
    headers: accountSessionAuth,
    payload: {},
  });
  check('An account session can sign out', accountLogout.statusCode === 200, accountLogout.statusCode);

  // An email and a mobile number each belong to one person (ADR-0004), and
  // registration says so plainly.
  const repeatVerified = await registerAccount(registration);
  check(
    'Registering an email and mobile that already have an account is refused',
    repeatVerified.statusCode === 409 && repeatVerified.json()?.error?.code === 'ACCOUNT_EXISTS',
    repeatVerified.json()
  );

  const takenEmail = await registerAccount({
    ...registration,
    email: 'owner@acme.test',
    phone: `6${Date.now().toString().slice(-9)}`,
  });
  check(
    'An email already tied to another mobile cannot be registered again',
    takenEmail.statusCode === 409 && takenEmail.json()?.error?.code === 'EMAIL_IN_USE',
    takenEmail.json()
  );

  const takenPhone = await registerAccount({
    ...registration,
    email: `smoke-phone-${Date.now()}@leadbee.test`,
    phone: '9000000001',
  });
  check(
    'A mobile already tied to another email cannot be registered again',
    takenPhone.statusCode === 409 && takenPhone.json()?.error?.code === 'PHONE_IN_USE',
    takenPhone.json()
  );

  const lockRegistration = await registerAccount({
    ...registration,
    email: lockEmail,
    phone: `8${Date.now().toString().slice(-9)}`,
  });
  const lockReceipt = lockRegistration.json()?.data;
  const lockWrong = lockReceipt?.devCode === '000000' ? '111111' : '000000';
  for (let guess = 0; guess < 5; guess += 1) {
    await verifyAccount({
      email: lockEmail,
      code: lockWrong,
      registrationToken: lockReceipt?.registrationToken,
    });
  }
  const afterLockout = await verifyAccount({
    email: lockEmail,
    code: lockReceipt?.devCode,
    registrationToken: lockReceipt?.registrationToken,
  });
  check(
    'Five wrong guesses retire the code, so the right code no longer works',
    afterLockout.statusCode === 400,
    afterLockout.statusCode
  );

  // The lockout registration never confirmed its email.
  const unconfirmedSignIn = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: registrationHeaders,
    payload: { identifier: lockEmail, password: registration.password },
  });
  check(
    'A registration whose email was never confirmed cannot sign in',
    unconfirmedSignIn.statusCode === 403 &&
      unconfirmedSignIn.json()?.error?.code === 'EMAIL_NOT_VERIFIED',
    unconfirmedSignIn.json()
  );

  const resendUnknown = await app.inject({
    method: 'POST',
    url: '/api/v1/accounts/resend-verification',
    headers: registrationHeaders,
    payload: {
      email: `nobody-${Date.now()}@leadbee.test`,
      registrationToken: firstReceipt?.registrationToken,
    },
  });
  check(
    'Resend answers 202 for an address that was never registered',
    resendUnknown.statusCode === 202,
    resendUnknown.statusCode
  );

  const tenantOnAccounts = await app.inject({
    method: 'GET',
    url: '/api/v1/platform/accounts',
    headers: ownerAuth,
  });
  check(
    'A tenant token cannot reach the accounts console',
    tenantOnAccounts.statusCode === 401 || tenantOnAccounts.statusCode === 403,
    tenantOnAccounts.statusCode
  );

  const findAccount = async (email: string) => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/platform/accounts?search=${encodeURIComponent(email)}`,
      headers: platformAuth,
    });
    return response.json()?.data?.[0] as Record<string, unknown> | undefined;
  };

  const listedAccount = await findAccount(accountEmail);
  check(
    'The console lists the registered account as verified',
    listedAccount?.email === accountEmail && Boolean(listedAccount?.emailVerifiedAt),
    listedAccount
  );
  check(
    'Account rows carry no password or verification hash',
    Boolean(listedAccount) &&
      !('password' in (listedAccount ?? {})) &&
      !('verification' in (listedAccount ?? {})),
    Object.keys(listedAccount ?? {})
  );
  const accountId = String(listedAccount?._id);

  const lockedAccountId = String((await findAccount(lockEmail))?._id);
  const lockedDetail = await app.inject({
    method: 'GET',
    url: `/api/v1/platform/accounts/${lockedAccountId}`,
    headers: platformAuth,
  });
  const pendingCode = lockedDetail.json()?.data?.pendingVerification;
  check(
    'Detail reports guesses used on a pending code, and never its hash',
    pendingCode?.attempts === 5 && !('codeHash' in (pendingCode ?? {})),
    pendingCode
  );

  const accountStats = await app.inject({
    method: 'GET',
    url: '/api/v1/platform/accounts/stats',
    headers: platformAuth,
  });
  check(
    'Account stats count the new registrations',
    accountStats.statusCode === 200 && (accountStats.json()?.data?.total ?? 0) >= 2,
    accountStats.json()
  );

  const setAccountStatus = (payload: Record<string, unknown>) =>
    app.inject({
      method: 'PATCH',
      url: `/api/v1/platform/accounts/${accountId}/status`,
      headers: platformAuth,
      payload,
    });

  const suspendWithoutReason = await setAccountStatus({ status: 'suspended' });
  check(
    'Suspending an account requires a reason',
    suspendWithoutReason.statusCode === 400,
    suspendWithoutReason.statusCode
  );

  const suspendedAccount = await setAccountStatus({
    status: 'suspended',
    reason: 'Smoke test suspension',
  });
  const suspendedData = suspendedAccount.json()?.data;
  check(
    'A platform admin can suspend an account, audited with the reason',
    suspendedAccount.statusCode === 200 &&
      suspendedData?.status === 'suspended' &&
      suspendedData?.activity?.[0]?.action === 'account_suspended' &&
      suspendedData?.activity?.[0]?.reason === 'Smoke test suspension',
    suspendedData
  );

  const suspendedAccountMe = await app.inject({
    method: 'GET',
    url: '/api/v1/accounts/me',
    headers: accountSessionAuth,
  });
  check(
    'Suspension blocks an account session it already holds',
    suspendedAccountMe.statusCode === 403 &&
      suspendedAccountMe.json()?.error?.code === 'ACCOUNT_SUSPENDED',
    suspendedAccountMe.json()
  );

  const suspendAgain = await setAccountStatus({ status: 'suspended', reason: 'Again' });
  check(
    'Repeating a suspension writes no second audit entry',
    suspendAgain.json()?.data?.activity?.length === suspendedData?.activity?.length,
    suspendAgain.json()?.data?.activity?.length
  );

  const reactivatedAccount = await setAccountStatus({ status: 'active' });
  check(
    'A suspended account can be reactivated',
    reactivatedAccount.json()?.data?.status === 'active',
    reactivatedAccount.statusCode
  );

  const verifyVerified = await app.inject({
    method: 'POST',
    url: `/api/v1/platform/accounts/${accountId}/verify-email`,
    headers: platformAuth,
    payload: { reason: 'Smoke test' },
  });
  check(
    'Manually verifying an already verified email is refused',
    verifyVerified.statusCode === 409,
    verifyVerified.statusCode
  );

  const manualVerify = await app.inject({
    method: 'POST',
    url: `/api/v1/platform/accounts/${lockedAccountId}/verify-email`,
    headers: platformAuth,
    payload: { reason: 'Smoke test manual verification' },
  });
  check(
    'Support can verify an email manually, which retires the pending code',
    manualVerify.statusCode === 200 &&
      manualVerify.json()?.data?.emailVerifiedVia === 'platform_admin' &&
      manualVerify.json()?.data?.pendingVerification === null,
    manualVerify.json()
  );

  const deleteMismatch = await app.inject({
    method: 'DELETE',
    url: `/api/v1/platform/accounts/${accountId}`,
    headers: platformAuth,
    payload: { reason: 'Smoke cleanup', confirmEmail: 'someone-else@leadbee.test' },
  });
  check(
    'Deletion refuses a confirmation that does not match the email',
    deleteMismatch.statusCode === 400,
    deleteMismatch.statusCode
  );

  for (const [id, email] of [
    [accountId, accountEmail],
    [lockedAccountId, lockEmail],
  ] as const) {
    await app.inject({
      method: 'DELETE',
      url: `/api/v1/platform/accounts/${id}`,
      headers: platformAuth,
      payload: { reason: 'Smoke cleanup', confirmEmail: email },
    });
  }
  const afterDelete = await app.inject({
    method: 'GET',
    url: `/api/v1/platform/accounts/${accountId}`,
    headers: platformAuth,
  });
  check('A deleted account is gone', afterDelete.statusCode === 404, afterDelete.statusCode);

  // ─── A member is a person with an account ───────────────────────────────────
  const ownerAccount = await findAccount('owner@acme.test');
  const ownerAccountId = String(ownerAccount?._id);
  check(
    'An organization member appears as an account, with the organization counted',
    (ownerAccount?.organizations as { count?: number } | undefined)?.count === 1,
    ownerAccount
  );

  const ownerDetail = await app.inject({
    method: 'GET',
    url: `/api/v1/platform/accounts/${ownerAccountId}`,
    headers: platformAuth,
  });
  const ownerMembership = ownerDetail.json()?.data?.memberships?.[0];
  check(
    'Account detail lists the membership with its organization and role',
    ownerMembership?.role === 'owner' && Boolean(ownerMembership?.organization?.name),
    ownerDetail.json()?.data?.memberships
  );

  const deleteMember = await app.inject({
    method: 'DELETE',
    url: `/api/v1/platform/accounts/${ownerAccountId}`,
    headers: platformAuth,
    payload: { reason: 'Smoke test', confirmEmail: 'owner@acme.test' },
  });
  check(
    'An account that still belongs to an organization cannot be deleted',
    deleteMember.statusCode === 409,
    deleteMember.statusCode
  );

  // Suspension follows the person into every organization, including a token
  // they already hold.
  const tenantBAccountId = String((await findAccount(tenantBOwnerEmail))?._id);
  const setTenantBAccount = (payload: Record<string, unknown>) =>
    app.inject({
      method: 'PATCH',
      url: `/api/v1/platform/accounts/${tenantBAccountId}/status`,
      headers: platformAuth,
      payload,
    });

  const suspendPerson = await setTenantBAccount({
    status: 'suspended',
    reason: 'Smoke test account suspension',
  });
  check('A member’s account can be suspended', suspendPerson.statusCode === 200, suspendPerson.json());

  const suspendedToken = await app.inject({
    method: 'GET',
    url: '/api/v1/leads',
    headers: tenantBAuth,
  });
  check(
    'Suspending the account blocks a token it already holds',
    suspendedToken.statusCode === 403 && suspendedToken.json()?.error?.code === 'ACCOUNT_SUSPENDED',
    suspendedToken.json()
  );

  const suspendedLogin = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { identifier: tenantBOwnerEmail, password: 'Password@123' },
  });
  check(
    'A suspended account cannot sign in',
    suspendedLogin.statusCode === 403 && suspendedLogin.json()?.error?.code === 'ACCOUNT_SUSPENDED',
    suspendedLogin.json()
  );

  await setTenantBAccount({ status: 'active' });
  const restoredLogin = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { identifier: tenantBOwnerEmail, password: 'Password@123' },
  });
  check(
    'Reactivated, the person signs in with their email again',
    restoredLogin.statusCode === 200,
    restoredLogin.json()
  );

  const platformTokenOnTenant = await app.inject({
    method: 'GET',
    url: '/api/v1/leads',
    headers: platformAuth,
  });
  check(
    'A platform token is refused by the tenant API',
    platformTokenOnTenant.statusCode === 401,
    platformTokenOnTenant.statusCode
  );

  const orgs = await app.inject({
    method: 'GET',
    url: '/api/v1/platform/organizations',
    headers: platformAuth,
  });
  check('Control plane lists organizations', orgs.statusCode === 200);

  // ─── Provisioning creates or links the owner's account (ADR-0004) ───────────
  // The console's "Provision tenant" dialog calls exactly this endpoint.
  const provisionStamp = Date.now();
  const provisionedOwnerEmail = `provisioned-${provisionStamp}@smoke.test`;
  const provisionOrg = (payload: Record<string, unknown>) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/platform/organizations',
      headers: platformAuth,
      payload: { status: 'active', ...payload },
    });

  const provisionNew = await provisionOrg({
    organizationName: `Smoke Provisioned ${provisionStamp}`,
    ownerName: 'Provisioned Owner',
    ownerPhone: `6${provisionStamp.toString().slice(-9)}`,
    ownerEmail: provisionedOwnerEmail,
    ownerPassword: 'Password@123',
  });
  const provisionedOrgName = provisionNew.json()?.data?.organization?.name as string | undefined;
  const provisionedOrgId = provisionNew.json()?.data?.organization?._id as string | undefined;
  check(
    'Provisioning a tenant for a new person creates their account',
    provisionNew.statusCode === 201 && provisionNew.json()?.data?.ownerAccountCreated === true,
    provisionNew.json()
  );

  const provisionedLogin = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { identifier: provisionedOwnerEmail, password: 'Password@123' },
  });
  check(
    'The provisioned owner signs in with their email and lands in the new organization',
    provisionedLogin.statusCode === 200 &&
      provisionedLogin.json()?.data?.organization?._id === provisionedOrgId,
    provisionedLogin.json()
  );

  const provisionedAccount = await findAccount(provisionedOwnerEmail);
  check(
    'The provisioned owner appears in Accounts with the organization',
    (provisionedAccount?.organizations as { names?: string[] } | undefined)?.names?.includes(
      provisionedOrgName ?? ''
    ) === true,
    provisionedAccount
  );

  // ─── A registered person creates their own organization ─────────────────────
  // A fresh registrant, so the earlier account-console checks keep an account
  // with no memberships.
  const creatorEmail = `creator-${provisionStamp}@smoke.test`;
  const creatorRegistration = await registerAccount({
    ...registration,
    firstName: 'Creator',
    email: creatorEmail,
    phone: `8${(provisionStamp + 7).toString().slice(-9)}`,
  });
  const creatorReceipt = creatorRegistration.json()?.data;
  await verifyAccount({
    email: creatorEmail,
    code: creatorReceipt?.devCode,
    registrationToken: creatorReceipt?.registrationToken,
  });
  const creatorSignIn = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: registrationHeaders,
    payload: { identifier: creatorEmail, password: registration.password },
  });
  const creatorSession = creatorSignIn.json()?.data;
  const creatorAuth = { authorization: `Bearer ${creatorSession?.accessToken}` };
  const createOwnOrganization = (payload: Record<string, unknown>) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/accounts/organizations',
      headers: { ...creatorAuth, ...registrationHeaders },
      payload,
    });

  const takenHandle = await createOwnOrganization({
    organizationName: 'Smoke Taken Handle',
    slug: provisionNew.json()?.data?.organization?.slug,
  });
  check(
    'Creating an organization with a taken handle is refused',
    creatorSession?.session === 'account' && takenHandle.statusCode === 409,
    takenHandle.json()
  );

  const tenantTokenCreates = await app.inject({
    method: 'POST',
    url: '/api/v1/accounts/organizations',
    headers: ownerAuth,
    payload: { organizationName: 'Smoke Tenant Token Org' },
  });
  check(
    'A tenant token cannot create an organization from the account route',
    tenantTokenCreates.statusCode === 401,
    tenantTokenCreates.statusCode
  );

  const ownOrganization = await createOwnOrganization({
    organizationName: `Smoke Own Org ${provisionStamp}`,
  });
  const ownOrganizationData = ownOrganization.json()?.data;
  const createdOrgId = ownOrganizationData?.organization?._id as string | undefined;
  check(
    'A person with no organization creates one, owns it, and is signed into it',
    ownOrganization.statusCode === 201 &&
      ownOrganizationData?.session === 'tenant' &&
      ownOrganizationData?.user?.role === 'owner' &&
      ownOrganizationData?.user?.email === creatorEmail,
    ownOrganization.json()
  );

  const createdOrgMe = await app.inject({
    method: 'GET',
    url: '/api/v1/auth/me',
    headers: { authorization: `Bearer ${ownOrganizationData?.accessToken}` },
  });
  check(
    'The returned tenant session opens the new organization',
    createdOrgMe.statusCode === 200 && createdOrgMe.json()?.data?.organization?._id === createdOrgId,
    createdOrgMe.statusCode
  );

  const staleAccountRefresh = await app.inject({
    method: 'POST',
    url: '/api/v1/accounts/session/refresh',
    headers: registrationHeaders,
    payload: { refreshToken: creatorSession?.refreshToken },
  });
  const secondOwnOrganization = await createOwnOrganization({
    organizationName: `Smoke Second Org ${provisionStamp}`,
  });
  check(
    'Creating an organization ends the account session, and a second create is refused',
    staleAccountRefresh.statusCode === 401 && secondOwnOrganization.statusCode === 409,
    [staleAccountRefresh.statusCode, secondOwnOrganization.statusCode]
  );

  const creatorLogin = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: registrationHeaders,
    payload: { identifier: creatorEmail, password: registration.password },
  });
  check(
    'Signing in afterwards opens the organization, not the no-organization step',
    creatorLogin.statusCode === 200 &&
      creatorLogin.json()?.data?.session === 'tenant' &&
      creatorLogin.json()?.data?.organization?._id === createdOrgId,
    creatorLogin.json()
  );

  // An existing person: linked, not duplicated, and no password needed.
  const provisionLinked = await provisionOrg({
    organizationName: `Smoke Linked ${provisionStamp}`,
    ownerName: 'Manish Manager',
    ownerPhone: '9000000002',
    ownerEmail: 'manager@acme.test',
  });
  const linkedOrgId = provisionLinked.json()?.data?.organization?._id as string | undefined;
  check(
    'Provisioning for someone who already has an account links it, without a password',
    provisionLinked.statusCode === 201 && provisionLinked.json()?.data?.ownerAccountCreated === false,
    provisionLinked.json()
  );

  const twoOrgLogin = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { identifier: 'manager@acme.test', password: 'Password@123' },
  });
  check(
    'That person now has one sign-in for both organizations',
    twoOrgLogin.statusCode === 409 &&
      twoOrgLogin.json()?.error?.code === 'ORGANIZATION_SELECTION_REQUIRED' &&
      twoOrgLogin.json()?.error?.details?.organizations?.length === 2,
    twoOrgLogin.json()
  );

  const newWithoutPassword = await provisionOrg({
    organizationName: `Smoke No Password ${provisionStamp}`,
    ownerName: 'No Password',
    ownerPhone: `6${(provisionStamp + 1).toString().slice(-9)}`,
    ownerEmail: `no-password-${provisionStamp}@smoke.test`,
  });
  check(
    'A new owner without a password is refused before anything is created',
    newWithoutPassword.statusCode === 400,
    newWithoutPassword.json()
  );

  const conflictSlug = `smoke-conflict-${provisionStamp}`;
  const provisionConflict = await provisionOrg({
    organizationName: `Smoke Conflict ${provisionStamp}`,
    slug: conflictSlug,
    ownerName: 'Somebody Else',
    ownerPhone: `6${(provisionStamp + 2).toString().slice(-9)}`,
    ownerEmail: 'owner@acme.test',
    ownerPassword: 'Password@123',
  });
  const conflictOrgExists = await withoutTenantScope('smoke test verification', () =>
    Organization.exists({ slug: conflictSlug })
  );
  check(
    'An owner email already tied to another phone is refused, and no organization is left behind',
    provisionConflict.statusCode === 409 &&
      provisionConflict.json()?.error?.code === 'EMAIL_IN_USE' &&
      conflictOrgExists === null,
    provisionConflict.json()
  );
  check(
    'Control plane sees across tenants',
    (orgs.json()?.total ?? 0) >= 2,
    orgs.json()?.total
  );

  const metrics = await app.inject({
    method: 'GET',
    url: '/api/v1/platform/metrics',
    headers: platformAuth,
  });
  check('Estate metrics return 200', metrics.statusCode === 200, metrics.json());
  check(
    'Metrics aggregate across every tenant',
    (metrics.json()?.data?.totals?.organizations ?? 0) >= 2
  );

  // ─── Suspension takes effect immediately ────────────────────────────────────
  section('Suspension');
  const orgB = await withoutTenantScope('smoke test lookup', () =>
    Organization.findOne({ slug: secondOrgSlug }).lean()
  );

  const suspend = await app.inject({
    method: 'PATCH',
    url: `/api/v1/platform/organizations/${orgB!._id}/status`,
    headers: platformAuth,
    payload: { status: 'suspended', reason: 'Smoke test suspension' },
  });
  check('Platform can suspend a tenant', suspend.statusCode === 200, suspend.json());

  // Same token as before the suspension — it has not expired, so this proves the
  // check is per-request rather than per-token.
  const afterSuspend = await app.inject({
    method: 'GET',
    url: '/api/v1/leads',
    headers: tenantBAuth,
  });
  check(
    'Suspension blocks an already-issued token on its next request',
    afterSuspend.statusCode === 403,
    afterSuspend.statusCode
  );
  check(
    'Suspension is reported with a distinguishable code',
    afterSuspend.json()?.error?.code === 'ORGANIZATION_INACTIVE',
    afterSuspend.json()?.error?.code
  );

  const reactivate = await app.inject({
    method: 'PATCH',
    url: `/api/v1/platform/organizations/${orgB!._id}/status`,
    headers: platformAuth,
    payload: { status: 'active' },
  });
  check('Platform can reactivate a tenant', reactivate.statusCode === 200);

  const afterReactivate = await app.inject({
    method: 'GET',
    url: '/api/v1/leads',
    headers: tenantBAuth,
  });
  check('Reactivation restores access', afterReactivate.statusCode === 200);

  const audit = await app.inject({
    method: 'GET',
    url: '/api/v1/platform/audit',
    headers: platformAuth,
  });
  check('Suspension was written to the platform audit log', (audit.json()?.total ?? 0) > 0);

  // ─── Cleanup ────────────────────────────────────────────────────────────────
  await withoutTenantScope('smoke test cleanup', async () => {
    await Lead.deleteMany({ organizationId: orgB!._id });
    await User.deleteMany({ organizationId: orgB!._id });
    await LeadDropReason.deleteMany({ organizationId: orgB!._id });
    await PurposeOfInquiry.deleteMany({ organizationId: orgB!._id });
    await Notification.deleteMany({ organizationId: orgB!._id });
    await Organization.deleteOne({ _id: orgB!._id });
    await Lead.deleteOne({ _id: leadId });
    await Notification.deleteMany({ entityId: leadId });
    await LeadDropReason.deleteOne({ _id: dropReasonId });
    await PurposeOfInquiry.deleteOne({ _id: purposeId });
    // Normally already erased through the console; this catches a run that
    // failed part-way.
    await Account.deleteMany({
      email: {
        $in: [accountEmail, lockEmail, tenantBOwnerEmail, provisionedOwnerEmail, creatorEmail],
      },
    });
    // The provisioned organizations. The linked one's owner is the seeded
    // manager, whose account stays — only that extra membership goes.
    for (const organizationId of [provisionedOrgId, linkedOrgId, createdOrgId]) {
      if (!organizationId) continue;
      await Lead.deleteMany({ organizationId });
      await User.deleteMany({ organizationId });
      await Role.deleteMany({ organizationId });
      await LeadDropReason.deleteMany({ organizationId });
      await PurposeOfInquiry.deleteMany({ organizationId });
      await Notification.deleteMany({ organizationId });
      await Organization.deleteOne({ _id: organizationId });
    }
  });

  await app.close();
  await disconnectDatabase();

  process.stdout.write(`\n${'='.repeat(56)}\n`);
  process.stdout.write(`  ${passed} passed, ${failed} failed\n`);
  if (failed > 0) {
    process.stdout.write(`\n  Failures:\n${failures.map((f) => `    - ${f}`).join('\n')}\n`);
  }
  process.stdout.write(`${'='.repeat(56)}\n`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (err) => {
  process.stderr.write(`\nsmoke test crashed: ${err?.stack ?? err}\n`);
  await disconnectDatabase().catch(() => undefined);
  process.exit(1);
});

import { Types } from 'mongoose';
import { buildApp } from '../app.js';
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { Organization } from '../models/Organization.js';
import { User } from '../models/User.js';
import { Lead } from '../models/Lead.js';
import { Notification } from '../models/Notification.js';
import { LeadDropReason } from '../models/LeadDropReason.js';
import { PurposeOfInquiry } from '../models/PurposeOfInquiry.js';
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
    /invalid phone number or password/i.test(badLogin.json()?.error?.message ?? ''),
    badLogin.json()?.error?.message
  );

  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { phone: '9000000001', password: 'Password@123' },
  });
  check('Owner can sign in', login.statusCode === 200, login.json());

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
  const signup = await app.inject({
    method: 'POST',
    url: '/api/v1/signup',
    payload: {
      organizationName: 'Smoke Tenant',
      slug: secondOrgSlug,
      ownerName: 'Second Owner',
      ownerPhone: `9${Date.now().toString().slice(-9)}`,
      ownerEmail: `owner-${Date.now()}@smoke.test`,
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

import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { PlatformAdmin } from '../models/PlatformAdmin.js';
import { Organization } from '../models/Organization.js';
import { Lead } from '../models/Lead.js';
import { User } from '../models/User.js';
import { Project } from '../models/Project.js';
import { organizationService } from '../modules/organizations/organization.service.js';
import { runInTenantScope } from '../lib/tenantContext.js';
import { nextDisplayNumber } from '../lib/counters.js';
import {
  LEAD_PRIORITY_ORDER,
  LEAD_SOURCE_ORDER,
  LEAD_STAGE_ORDER,
  PLANS,
  ORG_STATUSES,
} from '../config/constants.js';
import '../models/index.js';

/**
 * Idempotent seed.
 *
 * Safe to run repeatedly: it creates what is missing and leaves what exists
 * alone, so it can be pointed at a half-set-up environment without wiping it.
 */
async function seed(): Promise<void> {
  await connectDatabase();

  // ─── Platform owner ─────────────────────────────────────────────────────────
  if (env.PLATFORM_BOOTSTRAP_EMAIL && env.PLATFORM_BOOTSTRAP_PASSWORD) {
    const existing = await PlatformAdmin.findOne({
      email: env.PLATFORM_BOOTSTRAP_EMAIL.toLowerCase(),
    });
    if (existing) {
      logger.info({ email: existing.email }, 'platform owner already exists — skipped');
    } else {
      const admin = await PlatformAdmin.create({
        name: env.PLATFORM_BOOTSTRAP_NAME,
        email: env.PLATFORM_BOOTSTRAP_EMAIL,
        password: env.PLATFORM_BOOTSTRAP_PASSWORD,
        role: 'owner',
      });
      logger.info({ email: admin.email }, 'platform owner created');
    }
  } else {
    logger.warn(
      'PLATFORM_BOOTSTRAP_EMAIL / _PASSWORD not set — no platform admin created'
    );
  }

  // ─── Demo tenant, development only ──────────────────────────────────────────
  // Never in production: a known phone and password on a live estate is a
  // standing invitation.
  if (env.isProduction) {
    logger.info('production — skipping demo tenant');
    await disconnectDatabase();
    return;
  }

  const demoSlug = 'acme-realty';
  const existingOrg = await Organization.findOne({ slug: demoSlug });
  if (existingOrg) {
    logger.info({ slug: demoSlug }, 'demo organization already exists — skipped');
    await disconnectDatabase();
    return;
  }

  const { organization, owner } = await organizationService.provision({
    organizationName: 'Acme Realty',
    slug: demoSlug,
    ownerName: 'Asha Owner',
    ownerPhone: '9000000001',
    ownerEmail: 'owner@acme.test',
    ownerPassword: 'Password@123',
    plan: PLANS.GROWTH,
    status: ORG_STATUSES.ACTIVE,
    source: 'platform_provisioned',
  });

  await runInTenantScope(
    {
      organizationId: organization._id,
      userId: owner._id,
      role: owner.role,
      permissions: ['*'],
    },
    async () => {
      const managerRole = await mongoose
        .model('Role')
        .findOne({ organizationId: organization._id, name: 'manager' })
        .select('_id')
        .lean();
      const agentRole = await mongoose
        .model('Role')
        .findOne({ organizationId: organization._id, name: 'user' })
        .select('_id')
        .lean();

      const [manager, agent] = await Promise.all([
        User.create({
          organizationId: organization._id,
          name: 'Manish Manager',
          phone: '9000000002',
          email: 'manager@acme.test',
          password: 'Password@123',
          role: 'manager',
          roleId: (managerRole as { _id: mongoose.Types.ObjectId } | null)?._id,
        }),
        User.create({
          organizationId: organization._id,
          name: 'Anil Agent',
          phone: '9000000003',
          email: 'agent@acme.test',
          password: 'Password@123',
          role: 'user',
          roleId: (agentRole as { _id: mongoose.Types.ObjectId } | null)?._id,
        }),
      ]);

      const projects = await Project.insertMany([
        { organizationId: organization._id, name: 'Skyline Towers', createdBy: owner._id, sortOrder: 0 },
        { organizationId: organization._id, name: 'Green Valley', createdBy: owner._id, sortOrder: 1 },
      ]);

      const agents = [owner._id, manager._id, agent._id];
      const now = Date.now();
      const day = 24 * 60 * 60 * 1000;

      // Spread across stages, priorities and follow-up dates so the dashboard,
      // reminder tabs and filter chips all have something to show.
      for (let i = 0; i < 40; i += 1) {
        const leadNumber = await nextDisplayNumber('lead');
        await Lead.create({
          organizationId: organization._id,
          leadNumber,
          contactName: `Demo Contact ${i + 1}`,
          contactPhone: `98765${String(10000 + i).slice(-5)}`,
          contactEmail: i % 3 === 0 ? `contact${i + 1}@example.test` : undefined,
          source: LEAD_SOURCE_ORDER[i % LEAD_SOURCE_ORDER.length],
          priority: LEAD_PRIORITY_ORDER[i % LEAD_PRIORITY_ORDER.length],
          stage: LEAD_STAGE_ORDER[i % LEAD_STAGE_ORDER.length],
          project: projects[i % projects.length]!._id,
          interestedIn: i % 2 === 0 ? '3 BHK' : '2 BHK',
          budgetMin: 3_000_000 + (i % 5) * 500_000,
          budgetMax: 5_000_000 + (i % 5) * 500_000,
          assignedTo: agents[i % agents.length],
          assignedBy: owner._id,
          assignedAt: new Date(now - i * day),
          // A third overdue, a third today/tomorrow, a third future.
          nextFollowUpAt: new Date(now + ((i % 6) - 2) * day),
          isBookmarked: i % 7 === 0,
          createdBy: owner._id,
        });
      }

      await Organization.updateOne(
        { _id: organization._id },
        { $set: { 'usage.users': 3, 'usage.leads': 40 } }
      );
    }
  );

  logger.info(
    {
      organization: organization.slug,
      signIn: 'phone 9000000001 / 9000000002 / 9000000003, password Password@123',
    },
    'demo tenant seeded'
  );

  await disconnectDatabase();
}

seed().catch(async (err) => {
  logger.fatal({ err }, 'seed failed');
  await disconnectDatabase().catch(() => undefined);
  process.exit(1);
});

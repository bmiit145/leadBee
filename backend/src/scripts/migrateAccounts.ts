import type { Types } from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { maskEmail } from '../lib/mailer.js';
import { withoutTenantScope } from '../lib/tenantContext.js';
import { Account } from '../models/Account.js';
import { User } from '../models/User.js';
import { joinName, splitName } from '../modules/accounts/identity.js';
import '../models/index.js';

/**
 * Backfill: give every membership an account (ADR-0004).
 *
 *   npm run migrate:accounts                  dry run — prints the plan, writes nothing
 *   npm run migrate:accounts -- --apply       writes
 *
 * Memberships that share an email or a mobile number are treated as one person
 * and linked to one account. Credentials move to the account; the most recently
 * used membership's password is kept, and the membership rows lose theirs.
 *
 * It refuses to apply while any membership cannot be linked cleanly — no email,
 * one person with two different emails or mobiles, identifiers already split
 * across existing accounts — because an unlinked membership cannot sign in.
 * `--allow-partial` applies the clean part anyway and leaves the rest listed.
 *
 * In production, `--apply` also needs `--confirm-backup` (BE-18). Idempotent:
 * rows that already have an account are skipped, so it can be re-run.
 */

interface LegacyMembership {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  name?: string;
  email?: string;
  phone?: string;
  password?: string;
  lastLoginAt?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

interface ExistingAccount {
  _id: Types.ObjectId;
  firstName: string;
  lastName?: string;
  email: string;
  phone: string;
}

interface Plan {
  memberships: LegacyMembership[];
  email: string;
  phone: string;
  /** The membership whose name and password the new account takes. */
  chosen: LegacyMembership;
  existing: ExistingAccount | null;
}

type ProblemKind =
  | 'missing_email'
  | 'missing_phone'
  | 'missing_password'
  | 'conflicting_identifiers'
  | 'clashes_with_existing_account';

interface Problem {
  kind: ProblemKind;
  memberships: string[];
  organizations: string[];
  detail: string;
}

const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const allowPartial = args.has('--allow-partial');
const confirmBackup = args.has('--confirm-backup');

async function migrate(): Promise<void> {
  if (apply && env.isProduction && !confirmBackup) {
    logger.fatal(
      'Refusing to apply in production without --confirm-backup. Take a backup of ' +
        'the users and accounts collections first.'
    );
    process.exitCode = 1;
    return;
  }

  await connectDatabase();
  try {
    await withoutTenantScope('migration: link every membership to one account', run);
  } finally {
    await disconnectDatabase();
  }
}

async function run(): Promise<void> {
  // Registrations written before `source` existed.
  const unlabeledAccounts = await Account.countDocuments({ source: { $exists: false } });

  // Through the driver: the Mongoose schema no longer declares `password` on a
  // membership, and this is the one place that still needs to read it.
  const memberships = (await User.collection
    .find(
      { accountId: { $exists: false } },
      {
        projection: {
          organizationId: 1,
          name: 1,
          email: 1,
          phone: 1,
          password: 1,
          lastLoginAt: 1,
          createdAt: 1,
          updatedAt: 1,
        },
      }
    )
    .toArray()) as unknown as LegacyMembership[];

  const plans: Plan[] = [];
  const problems: Problem[] = [];

  for (const group of groupByPerson(memberships)) {
    const problem = (kind: ProblemKind, detail: string) =>
      problems.push({
        kind,
        detail,
        memberships: group.map((m) => m._id.toString()),
        organizations: [...new Set(group.map((m) => m.organizationId.toString()))],
      });

    const emails = new Set(group.map((m) => m.email?.trim().toLowerCase()).filter(isText));
    const phones = new Set(group.map((m) => m.phone?.trim()).filter(isText));

    if (group.some((m) => !isText(m.email))) {
      problem('missing_email', 'A membership has no email, and an account needs one.');
      continue;
    }
    if (group.some((m) => !isText(m.phone))) {
      problem('missing_phone', 'A membership has no mobile number, and an account needs one.');
      continue;
    }
    if (emails.size > 1 || phones.size > 1) {
      problem(
        'conflicting_identifiers',
        `Linked memberships carry ${emails.size} emails and ${phones.size} mobile numbers; ` +
          'decide which belong to this person before migrating.'
      );
      continue;
    }

    const withPassword = group.filter((m) => isText(m.password));
    if (withPassword.length === 0) {
      problem('missing_password', 'No membership has a password to move to the account.');
      continue;
    }

    const email = [...emails][0]!;
    const phone = [...phones][0]!;

    const [byEmail, byPhone] = await Promise.all([
      Account.findOne({ email }).select('firstName lastName email phone').lean<ExistingAccount>(),
      Account.findOne({ phone }).select('firstName lastName email phone').lean<ExistingAccount>(),
    ]);

    let existing: ExistingAccount | null = null;
    if (byEmail || byPhone) {
      if (!byEmail || !byPhone || !byEmail._id.equals(byPhone._id)) {
        problem(
          'clashes_with_existing_account',
          `${maskEmail(email)} / ${maskPhone(phone)} is already partly held by another account.`
        );
        continue;
      }
      existing = byEmail;
    }

    const chosen = [...withPassword].sort(mostRecentlyUsedFirst)[0]!;
    plans.push({ memberships: group, email, phone, chosen, existing });
  }

  const report = {
    mode: apply ? 'apply' : 'dry-run',
    membershipsWithoutAccount: memberships.length,
    people: plans.length + problems.length,
    accountsToCreate: plans.filter((plan) => !plan.existing).length,
    linkedToExistingAccount: plans.filter((plan) => plan.existing).length,
    // A person in several organizations had several passwords; they keep one.
    peopleInSeveralOrganizations: plans
      .filter((plan) => plan.memberships.length > 1)
      .map((plan) => ({
        email: maskEmail(plan.email),
        memberships: plan.memberships.length,
        passwordKeptFromOrganization: plan.chosen.organizationId.toString(),
      })),
    registrationsMissingSource: unlabeledAccounts,
    problems,
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

  if (!apply) {
    process.stdout.write('\nDry run — nothing written. Re-run with --apply to migrate.\n');
    return;
  }

  if (problems.length > 0 && !allowPartial) {
    logger.error(
      { problems: problems.length },
      'Not applied: some memberships cannot be linked cleanly. Resolve them, or pass --allow-partial.'
    );
    process.exitCode = 1;
    return;
  }

  if (unlabeledAccounts > 0) {
    await Account.updateMany({ source: { $exists: false } }, { $set: { source: 'registration' } });
  }

  let accountsCreated = 0;
  let membershipsLinked = 0;

  for (const plan of plans) {
    let accountId: Types.ObjectId;
    let copy: { name: string; email: string; phone: string };

    if (plan.existing) {
      accountId = plan.existing._id;
      copy = {
        name: joinName(plan.existing.firstName, plan.existing.lastName),
        email: plan.existing.email,
        phone: plan.existing.phone,
      };
    } else {
      const { firstName, lastName } = splitName(plan.chosen.name ?? '');
      const earliest =
        plan.memberships
          .map((m) => m.createdAt)
          .filter((date): date is Date => date instanceof Date)
          .sort((a, b) => a.getTime() - b.getTime())[0] ?? new Date();

      const account = new Account({
        firstName: firstName || plan.email.split('@')[0],
        lastName,
        email: plan.email,
        phone: plan.phone,
        password: plan.chosen.password,
        status: 'active',
        source: 'backfill',
      });
      await account.validate();

      // Inserted through the driver, not `save()`: the value is already a bcrypt
      // hash, and the save hook would hash it a second time — and the person
      // could never sign in again.
      await Account.collection.insertOne({
        ...account.toObject(),
        createdAt: earliest,
        updatedAt: new Date(),
      });

      accountId = account._id;
      copy = { name: joinName(account.firstName, account.lastName), email: plan.email, phone: plan.phone };
      accountsCreated += 1;
    }

    const result = await User.collection.updateMany(
      { _id: { $in: plan.memberships.map((m) => m._id) }, accountId: { $exists: false } },
      { $set: { accountId, ...copy }, $unset: { password: '' } }
    );
    membershipsLinked += result.modifiedCount;
  }

  process.stdout.write(
    `\nApplied: ${accountsCreated} accounts created, ${membershipsLinked} memberships linked` +
      (problems.length ? `, ${problems.length} people left unlinked (see problems above)` : '') +
      '.\n'
  );
}

/** Memberships that share an email or a mobile number are one person. */
function groupByPerson(memberships: LegacyMembership[]): LegacyMembership[][] {
  const parent = memberships.map((_, index) => index);
  const find = (index: number): number => {
    const next = parent[index]!;
    if (next === index) return index;
    const root = find(next);
    parent[index] = root;
    return root;
  };

  const firstSeen = new Map<string, number>();
  memberships.forEach((membership, index) => {
    const keys = [
      isText(membership.email) ? `email:${membership.email.trim().toLowerCase()}` : null,
      isText(membership.phone) ? `phone:${membership.phone.trim()}` : null,
    ].filter(isText);

    for (const key of keys) {
      const seen = firstSeen.get(key);
      if (seen === undefined) firstSeen.set(key, index);
      else parent[find(index)] = find(seen);
    }
  });

  const groups = new Map<number, LegacyMembership[]>();
  memberships.forEach((membership, index) => {
    const root = find(index);
    groups.set(root, [...(groups.get(root) ?? []), membership]);
  });
  return [...groups.values()];
}

function mostRecentlyUsedFirst(a: LegacyMembership, b: LegacyMembership): number {
  const time = (m: LegacyMembership) => (m.lastLoginAt ?? m.updatedAt ?? m.createdAt)?.getTime() ?? 0;
  return time(b) - time(a);
}

function isText(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function maskPhone(phone: string): string {
  return `***${phone.slice(-3)}`;
}

migrate().catch(async (err) => {
  logger.fatal({ err }, 'account migration failed');
  await disconnectDatabase().catch(() => undefined);
  process.exit(1);
});

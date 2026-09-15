/**
 * Moves lead bookmarks from one shared flag to each person's own.
 *
 * `Lead.isBookmarked` was a single flag: one person bookmarking a lead
 * bookmarked it for everyone. It is now `Lead.bookmarkedBy`, a list of people.
 * A lead that was bookmarked keeps that bookmark for the person it belongs to —
 * its assignee, or its creator when unassigned — which is the only person the
 * old flag can be attributed to.
 *
 *   npx tsx src/scripts/migrateLeadBookmarks.ts            # dry run
 *   npx tsx src/scripts/migrateLeadBookmarks.ts --apply
 *
 * Runs across every tenant by nature, against the raw collection: there is no
 * request, so no tenant scope, and each update is keyed on the lead's own fields.
 */
import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../config/database.js';

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  await connectDatabase();

  const leads = mongoose.connection.db!.collection('leads');
  const bookmarked = await leads.countDocuments({ isBookmarked: true });
  const withLegacyField = await leads.countDocuments({ isBookmarked: { $exists: true } });
  const legacyIndex = (await leads.indexes()).find((index) => 'isBookmarked' in index.key);

  process.stdout.write(
    `Leads bookmarked under the old flag: ${bookmarked}\n` +
      `Leads still carrying the old field: ${withLegacyField}\n` +
      `Old bookmark index: ${legacyIndex?.name ?? 'none'}\n`
  );

  if (!apply) {
    process.stdout.write('\nDry run. Re-run with --apply to migrate.\n');
    await disconnectDatabase();
    return;
  }

  const moved = await leads.updateMany({ isBookmarked: true }, [
    {
      $set: {
        bookmarkedBy: {
          $setUnion: [
            { $ifNull: ['$bookmarkedBy', []] },
            [{ $ifNull: ['$assignedTo', '$createdBy'] }],
          ],
        },
      },
    },
  ]);
  const cleared = await leads.updateMany(
    { isBookmarked: { $exists: true } },
    { $unset: { isBookmarked: '' } }
  );
  if (legacyIndex?.name) await leads.dropIndex(legacyIndex.name);

  process.stdout.write(
    `\nMoved ${moved.modifiedCount} bookmark(s) to their owners; ` +
      `cleared the old field on ${cleared.modifiedCount} lead(s)` +
      `${legacyIndex?.name ? `; dropped index ${legacyIndex.name}` : ''}.\n`
  );
  await disconnectDatabase();
}

main().catch(async (error) => {
  process.stderr.write(`Bookmark migration failed: ${error?.stack ?? error}\n`);
  await disconnectDatabase().catch(() => undefined);
  process.exit(1);
});

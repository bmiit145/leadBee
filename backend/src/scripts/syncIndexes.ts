import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { logger } from '../lib/logger.js';
import '../models/index.js';

/**
 * Build every declared index, and report any that exist in the database but are
 * no longer declared in code.
 *
 * `autoIndex` is off in production — building an index on request is how a
 * deploy turns into an outage — so this runs as an explicit deploy step against
 * a maintenance window.
 *
 * It does **not** drop stale indexes. Dropping one that a running query planner
 * still depends on is a self-inflicted incident; the list is printed so a human
 * can decide.
 */
async function syncIndexes(): Promise<void> {
  await connectDatabase();

  const modelNames = mongoose.modelNames().sort();
  logger.info({ models: modelNames.length }, 'building indexes');

  for (const name of modelNames) {
    const model = mongoose.model(name);
    const declared = model.schema.indexes();

    try {
      await model.createIndexes();

      const existing = await model.collection.indexes();
      const declaredKeys = new Set(
        declared.map(([fields]) => JSON.stringify(fields))
      );
      const stale = existing
        .filter((idx) => idx.name !== '_id_')
        .filter((idx) => !declaredKeys.has(JSON.stringify(idx.key)))
        .map((idx) => idx.name);

      logger.info(
        { model: name, declared: declared.length, stale: stale.length },
        stale.length ? `built — stale indexes present: ${stale.join(', ')}` : 'built'
      );
    } catch (err) {
      logger.error({ err, model: name }, 'index build failed');
      throw err;
    }
  }

  logger.info('index sync complete');
  await disconnectDatabase();
}

syncIndexes().catch(async (err) => {
  logger.fatal({ err }, 'index sync failed');
  await disconnectDatabase().catch(() => undefined);
  process.exit(1);
});

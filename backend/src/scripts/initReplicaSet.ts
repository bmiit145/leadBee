import { MongoClient } from 'mongodb';

/**
 * Initiate a single-node replica set.
 *
 * A standalone mongod cannot run multi-document transactions — that needs an
 * oplog, which only a replica set has. A one-member set gives local development
 * the same transactional semantics as production without needing three nodes,
 * so `provision()` can use a real `withTransaction` instead of hand-rolled
 * rollback.
 *
 * Idempotent: re-running against an initiated set reports the existing config
 * rather than failing.
 */
async function main(): Promise<void> {
  const client = new MongoClient('mongodb://127.0.0.1:27017/?directConnection=true', {
    serverSelectionTimeoutMS: 15_000,
  });

  await client.connect();
  const admin = client.db('admin');

  try {
    const status = await admin.command({ replSetGetStatus: 1 });
    process.stdout.write(
      `Replica set "${status.set}" already initiated — state: ${status.myState === 1 ? 'PRIMARY' : status.myState}\n`
    );
    await client.close();
    return;
  } catch (err) {
    const code = (err as { code?: number }).code;
    // 94 = NotYetInitialized. Anything else is a real problem.
    if (code !== 94) {
      process.stderr.write(`Unexpected replSetGetStatus error: ${String(err)}\n`);
      await client.close();
      process.exit(1);
    }
  }

  await admin.command({
    replSetInitiate: {
      _id: 'rs0',
      members: [{ _id: 0, host: '127.0.0.1:27017' }],
    },
  });
  process.stdout.write('Replica set rs0 initiated. Waiting for PRIMARY…\n');

  // Election on a single-node set takes a second or two; the seed script needs
  // a writable primary, so wait rather than racing it.
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const status = await admin.command({ replSetGetStatus: 1 });
      if (status.myState === 1) {
        process.stdout.write('PRIMARY ready.\n');
        await client.close();
        return;
      }
    } catch {
      // Still electing.
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  process.stderr.write('Timed out waiting for PRIMARY\n');
  await client.close();
  process.exit(1);
}

main().catch((err) => {
  process.stderr.write(`replica set init failed: ${err?.stack ?? err}\n`);
  process.exit(1);
});

import mongoose, { type ClientSession } from 'mongoose';

/**
 * Does this deployment support multi-document transactions?
 *
 * True only on a replica set or sharded cluster. Probed once and cached — the
 * answer cannot change without a reconnect, and asking on every write would add
 * a round trip to it.
 */
let transactionSupport: boolean | undefined;

export async function supportsTransactions(): Promise<boolean> {
  if (transactionSupport !== undefined) return transactionSupport;
  try {
    const admin = mongoose.connection.db?.admin();
    const info = await admin?.command({ hello: 1 });
    // `setName` is present only on a replica set member; `msg: 'isdbgrid'`
    // identifies a mongos in front of a sharded cluster.
    transactionSupport = Boolean(info?.setName) || info?.msg === 'isdbgrid';
  } catch {
    transactionSupport = false;
  }
  return transactionSupport;
}

/**
 * Runs `work` inside a transaction when the deployment has one, and plainly
 * when it does not.
 *
 * Only for work that is already correct step by step — each write conditional
 * on the state the previous one left — so that a transaction adds crash
 * atomicity rather than being what makes it correct. Anything that is only
 * correct *inside* a transaction must require one instead of calling this.
 */
export async function withOptionalTransaction<T>(
  work: (session: ClientSession | undefined) => Promise<T>
): Promise<T> {
  if (!(await supportsTransactions())) return work(undefined);

  const session = await mongoose.startSession();
  try {
    let result: T | undefined;
    await session.withTransaction(async () => {
      result = await work(session);
    });
    return result as T;
  } finally {
    await session.endSession();
  }
}

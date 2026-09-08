import { Counter } from '../models/Counter.js';
import { requireOrganizationId } from './tenantContext.js';

/**
 * Human-facing sequence numbers (`L-0001`, `M-0007`, `T-0042`).
 *
 * The sequence is **per organization**, not global. Tenant A's first lead and
 * tenant B's first lead are both `L-0001`, and neither can see the other's
 * numbering rate — which would otherwise be a quiet business-intelligence leak.
 */
export type CounterKey = 'lead' | 'meeting' | 'task' | 'visit';

const PREFIX: Record<CounterKey, string> = {
  lead: 'L',
  meeting: 'M',
  task: 'T',
  visit: 'V',
};

/**
 * `findOneAndUpdate` with `$inc` is atomic on a single document, so concurrent
 * callers cannot be handed the same number even under load. The upsert makes the
 * first call for a new tenant self-initialising.
 */
export async function nextSequence(key: CounterKey): Promise<number> {
  const organizationId = requireOrganizationId();
  const counter = await Counter.findOneAndUpdate(
    { organizationId, key },
    { $inc: { seq: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  ).lean();
  return counter!.seq;
}

/** `L-0001`-style display number for the given entity, scoped to the tenant. */
export async function nextDisplayNumber(key: CounterKey): Promise<string> {
  const seq = await nextSequence(key);
  return `${PREFIX[key]}-${String(seq).padStart(4, '0')}`;
}

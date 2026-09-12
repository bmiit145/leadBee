/**
 * The fields whose values differ between two snapshots of a record, as a
 * matching pair of `before` / `after` objects.
 *
 * An audit entry records what changed, not the whole document: a trail full of
 * unchanged fields hides the one that matters. Values are compared by their
 * JSON form so ObjectIds, dates and arrays compare by content, not identity.
 * A field present on one side only is reported with `null` on the other.
 */
export function changedFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>
): { before: Record<string, unknown>; after: Record<string, unknown> } | null {
  const changedBefore: Record<string, unknown> = {};
  const changedAfter: Record<string, unknown> = {};

  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const was = before[key] ?? null;
    const now = after[key] ?? null;
    if (JSON.stringify(was) === JSON.stringify(now)) continue;
    changedBefore[key] = was;
    changedAfter[key] = now;
  }

  return Object.keys(changedAfter).length > 0 ? { before: changedBefore, after: changedAfter } : null;
}

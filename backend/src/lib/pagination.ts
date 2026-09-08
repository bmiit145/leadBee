export interface PageParams {
  page: number;
  limit: number;
  skip: number;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/**
 * Skip/limit paging, capped at 100 rows.
 *
 * Deep offsets are slow — `skip: 200_000` walks the index for every one of those
 * rows. It is fine here because the UI paginates a filtered, tenant-scoped list
 * that is never that deep. When an export needs the whole set, use
 * `cursorParams` below rather than raising the cap.
 */
export function pageParams(input: { page?: number; limit?: number } = {}): PageParams {
  const page = Math.max(1, Math.trunc(input.page ?? 1));
  const limit = Math.min(MAX_LIMIT, Math.max(1, Math.trunc(input.limit ?? DEFAULT_LIMIT)));
  return { page, limit, skip: (page - 1) * limit };
}

/**
 * Keyset paging for large sweeps (exports, background jobs). Ordering is by
 * `_id` descending, so the cursor is the last `_id` seen — constant cost per
 * page no matter how deep it goes.
 */
export function cursorFilter(cursor?: string): Record<string, unknown> {
  return cursor ? { _id: { $lt: cursor } } : {};
}

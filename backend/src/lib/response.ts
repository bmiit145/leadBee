/**
 * The response envelope.
 *
 * `{ success, data }` for a single resource and `{ success, data, total, page,
 * limit, totalPages }` for a list — the exact shape the mobile client already
 * unwraps. It is boring on purpose: the clients depend on it byte for byte.
 */

export interface SingleResponse<T> {
  success: true;
  data: T;
}

export interface ListResponse<T> {
  success: true;
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface MessageResponse {
  success: true;
  message: string;
}

export function ok<T>(data: T): SingleResponse<T> {
  return { success: true, data };
}

export function message(text: string): MessageResponse {
  return { success: true, message: text };
}

export function paginated<T>(
  data: T[],
  total: number,
  page: number,
  limit: number
): ListResponse<T> {
  return {
    success: true,
    data,
    total,
    page,
    limit,
    totalPages: limit > 0 ? Math.ceil(total / limit) : 0,
  };
}

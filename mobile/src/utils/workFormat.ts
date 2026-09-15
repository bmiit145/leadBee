/** Strips spaces/dashes and adds the India country code when it's a bare 10-digit number. */
export function toDialable(raw: string): string {
  const digits = (raw || '').replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) return digits;
  return digits.length === 10 ? `+91${digits}` : digits;
}

/** Compact ₹ label, e.g. 1500000 -> "₹15L". Returns null when no budget is set. */
export function formatBudget(min?: number, max?: number): string | null {
  const value = max ?? min;
  if (!value || value <= 0) return null;
  if (value >= 10_000_000) return `₹${+(value / 10_000_000).toFixed(2)}Cr`;
  if (value >= 100_000) return `₹${+(value / 100_000).toFixed(2)}L`;
  if (value >= 1_000) return `₹${+(value / 1_000).toFixed(2)}K`;
  return `₹${value}`;
}

/** "walk_in" -> "Walk In", "99acres" -> "99ACRES". */
export function sourceLabel(source: string): string {
  return source
    .split('_')
    .map((w) => (w.length <= 3 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

/** The API's own message for a failed request, or `fallback` when there is none (offline, timeout). */
export function apiErrorMessage(error: unknown, fallback: string): string {
  const message = (error as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error
    ?.message;
  return message || fallback;
}

export function apiStatus(error: unknown): number | undefined {
  return (error as { response?: { status?: number } })?.response?.status;
}

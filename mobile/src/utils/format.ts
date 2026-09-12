import { getCurrentLanguage } from '../i18n';

/**
 * BCP-47 tag for the app's current language.
 *
 * Dates go through `Intl` rather than being hand-assembled (MOB-17), so a
 * Gujarati user sees Gujarati month names without any per-screen code.
 */
export function localeTag(): string {
  return getCurrentLanguage() === 'gu' ? 'gu-IN' : 'en-IN';
}

/** An ISO date formatted for display, or `undefined` when missing or invalid. */
export function formatDate(
  iso: string | undefined,
  options: Intl.DateTimeFormatOptions
): string | undefined {
  if (!iso) return undefined;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toLocaleDateString(localeTag(), options);
}

/** An ISO timestamp's time of day for display, or `undefined` when missing or invalid. */
export function formatTime(iso: string | undefined): string | undefined {
  if (!iso) return undefined;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toLocaleTimeString(localeTag(), { hour: 'numeric', minute: '2-digit' });
}

/**
 * `professional` → `Professional`, `past_due` → `Past Due`.
 *
 * For display only. Plan keys come from the catalogue at runtime and the app
 * must never branch on them — see the `Plan` type.
 */
export function toTitleCase(value: string): string {
  return value
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

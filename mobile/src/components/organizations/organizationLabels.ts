import type { OrganizationSummary } from '../../types';
import { toTitleCase } from '../../utils/format';

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** "Trial", "Payment due"… — falling back to the raw status for one added later. */
export function organizationStatusLabel(status: string, t: Translate): string {
  return t(`organizations.status.${status}`, { defaultValue: toTitleCase(status.replace(/_/g, ' ')) });
}

/** "Owner · Trial" — the second line under an organization's name. */
export function organizationMeta(org: OrganizationSummary, t: Translate): string {
  return `${toTitleCase(org.role)} · ${organizationStatusLabel(org.status, t)}`;
}

/**
 * Why this organization cannot be opened, or `null` when it can. One place, so
 * the switcher and the Organizations screen always agree on what is selectable.
 */
export function organizationUnavailableReason(
  org: OrganizationSummary,
  t: Translate
): string | null {
  if (!org.membershipActive) return t('organizations.deactivated');
  if (!org.usable) return organizationStatusLabel(org.status, t);
  return null;
}

import { BadgeCheck, CircleDashed } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AccountStatus } from '@/types';

/**
 * Account status and email verification.
 *
 * Same principle as the organization chips — weight and fill before hue — with
 * one difference: nearly every account is active, so "active" is an outline
 * rather than a solid block. A column of identical solid chips carries no
 * information and hides the one row that matters, which is the suspended one.
 */
export function AccountStatusChip({
  status,
  className,
}: {
  status: AccountStatus;
  className?: string;
}) {
  const suspended = status === 'suspended';
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium tracking-wide',
        suspended
          ? 'border-[var(--danger-border)] bg-[var(--danger-surface)] text-[var(--danger)]'
          : 'border-[var(--border-strong)] bg-transparent text-[var(--text)]',
        className
      )}
    >
      {suspended ? 'Suspended' : 'Active'}
    </span>
  );
}

export function VerificationChip({
  verifiedAt,
  className,
}: {
  verifiedAt: string | null;
  className?: string;
}) {
  const verified = Boolean(verifiedAt);
  const Icon = verified ? BadgeCheck : CircleDashed;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-[12px]',
        verified ? 'text-[var(--text)]' : 'text-[var(--text-muted)]',
        className
      )}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
      {verified ? 'Verified' : 'Unverified'}
    </span>
  );
}

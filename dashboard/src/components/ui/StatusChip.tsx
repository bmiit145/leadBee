import { cn } from '@/lib/utils';
import type { OrgStatus, PlanKey } from '@/types';

/**
 * Status, encoded by **fill and weight** rather than by hue.
 *
 * A solid chip reads as "live", an outline as "dormant", a dashed border as
 * "provisional". That ordering survives greyscale printing, low-quality
 * projectors and the ~8% of men who cannot separate red from green — none of
 * which a red/amber/green palette does.
 *
 * `suspended` is the one exception: it borrows the system's single accent,
 * because an operator scanning a list of two hundred tenants needs the
 * switched-off ones to be findable at a glance.
 */

const STATUS_STYLES: Record<OrgStatus, string> = {
  active: 'bg-[var(--accent)] text-[var(--accent-text)] border-transparent',
  trialing:
    'bg-transparent text-[var(--text)] border-dashed border-[var(--border-strong)]',
  past_due:
    'bg-[var(--surface)] text-[var(--text)] border-[var(--text-subtle)] border-dotted',
  suspended:
    'bg-[var(--danger-surface)] text-[var(--danger)] border-[var(--danger-border)]',
  cancelled:
    'bg-transparent text-[var(--text-subtle)] border-[var(--border)] line-through',
};

const STATUS_LABELS: Record<OrgStatus, string> = {
  active: 'Active',
  trialing: 'Trial',
  past_due: 'Past due',
  suspended: 'Suspended',
  cancelled: 'Cancelled',
};

export function StatusChip({
  status,
  className,
}: {
  status: OrgStatus;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium tracking-wide',
        STATUS_STYLES[status],
        className
      )}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

/**
 * Plan tier, shown as filled rungs rather than a coloured label — the shape
 * carries the ordering without needing the reader to know which colour outranks
 * which.
 *
 * Rank and label are **server-provided**. They used to be hardcoded tables here,
 * which meant the client decided which plan outranked which — commercial policy
 * living in a chip component, and two of the six places a new plan had to be
 * declared. The catalogue owns both now; this renders whatever it is given.
 *
 * `rungs` is capped rather than assumed to be four, so a catalogue with seven
 * plans does not silently render every one of them as full.
 */
const RUNGS = 4;

export function PlanChip({
  plan,
  label,
  sortOrder,
  className,
}: {
  plan: PlanKey;
  /** Display name from the catalogue. Falls back to the raw key. */
  label?: string;
  /** Catalogue rank. Absent while the catalogue loads — renders no rungs. */
  sortOrder?: number;
  className?: string;
}) {
  const rank = Math.min(Math.max(sortOrder ?? 0, 0), RUNGS);
  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      <span className="flex gap-[2px]" aria-hidden>
        {Array.from({ length: RUNGS }, (_, i) => i + 1).map((step) => (
          <span
            key={step}
            className={cn(
              'h-3 w-[3px] rounded-full',
              step <= rank ? 'bg-[var(--text)]' : 'bg-[var(--border-strong)]'
            )}
          />
        ))}
      </span>
      <span className="text-[13px] text-[var(--text)]">{label ?? plan}</span>
    </span>
  );
}

/** Active / inactive for a tenant user row. */
export function ActiveDot({ active }: { active: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px]">
      <span
        className={cn(
          'h-1.5 w-1.5 rounded-full',
          active
            ? 'bg-[var(--text)]'
            : 'bg-transparent ring-1 ring-[var(--text-subtle)]'
        )}
        aria-hidden
      />
      <span className={active ? 'text-[var(--text)]' : 'text-[var(--text-subtle)]'}>
        {active ? 'Active' : 'Inactive'}
      </span>
    </span>
  );
}

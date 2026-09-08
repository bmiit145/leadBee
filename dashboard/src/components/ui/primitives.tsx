import {
  forwardRef,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { cn } from '@/lib/utils';

/**
 * The small shared pieces — surfaces, fields, table shell, loading and empty
 * states. One file because each is a dozen lines and splitting them would mean
 * eleven imports at every call site.
 */

// ─── Surfaces ─────────────────────────────────────────────────────────────────

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-xl border border-[var(--border)] bg-[var(--surface-raised)]',
        className
      )}
      {...props}
    />
  );
}

export function CardHeader({
  title,
  description,
  action,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex items-start justify-between gap-4 border-b border-[var(--border)] px-5 py-4',
        className
      )}
    >
      <div className="min-w-0">
        <h2 className="truncate text-[15px] font-semibold text-[var(--text)]">{title}</h2>
        {description && (
          <p className="mt-0.5 text-[13px] text-[var(--text-muted)]">{description}</p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

// ─── Fields ───────────────────────────────────────────────────────────────────

const fieldBase =
  'w-full rounded-lg border border-[var(--border-strong)] bg-[var(--bg)] px-3 ' +
  'text-sm text-[var(--text)] placeholder:text-[var(--text-subtle)] ' +
  'transition-colors focus:border-[var(--text)] focus:outline-none ' +
  'disabled:cursor-not-allowed disabled:opacity-50';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return <input ref={ref} className={cn(fieldBase, 'h-9', className)} {...props} />;
  }
);

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...props }, ref) {
  return (
    <textarea ref={ref} className={cn(fieldBase, 'min-h-20 py-2', className)} {...props} />
  );
});

export const Select = forwardRef<
  HTMLSelectElement,
  SelectHTMLAttributes<HTMLSelectElement>
>(function Select({ className, ...props }, ref) {
  return (
    <select ref={ref} className={cn(fieldBase, 'h-9 cursor-pointer', className)} {...props} />
  );
});

export function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
  className,
}: {
  label: string;
  hint?: string;
  error?: string;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <label
        htmlFor={htmlFor}
        className="block text-[13px] font-medium text-[var(--text)]"
      >
        {label}
      </label>
      {children}
      {/* aria-live so a validation message that appears after submit is
          announced, not just drawn. */}
      {error ? (
        <p role="alert" className="text-[12px] text-[var(--danger)]">
          {error}
        </p>
      ) : hint ? (
        <p className="text-[12px] text-[var(--text-muted)]">{hint}</p>
      ) : null}
    </div>
  );
}

// ─── Table shell ──────────────────────────────────────────────────────────────

/** Wraps a table so wide content scrolls inside its own box, never the page. */
export function TableWrap({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('w-full overflow-x-auto', className)} {...props} />;
}

export function Table({ className, ...props }: HTMLAttributes<HTMLTableElement>) {
  return (
    <table
      className={cn('w-full border-collapse text-sm', className)}
      {...props}
    />
  );
}

export function Th({ className, ...props }: HTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn(
        'border-b border-[var(--border)] px-4 py-2.5 text-left text-[12px] ' +
          'font-medium uppercase tracking-wider text-[var(--text-muted)]',
        className
      )}
      {...props}
    />
  );
}

export function Td({ className, ...props }: HTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      className={cn('border-b border-[var(--border)] px-4 py-3 align-middle', className)}
      {...props}
    />
  );
}

export function Tr({ className, ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr className={cn('transition-colors hover:bg-[var(--surface)]', className)} {...props} />
  );
}

// ─── Loading / empty ──────────────────────────────────────────────────────────

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn('animate-pulse rounded-md bg-[var(--border)]', className)}
      aria-hidden
    />
  );
}

/**
 * Skeleton rows sized to the table they replace.
 *
 * Matching the real row height is the whole point — a shorter placeholder makes
 * the page jump when data lands, which reads as a glitch.
 */
export function TableSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <tbody>
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <tr key={rowIndex}>
          {Array.from({ length: cols }).map((__, colIndex) => (
            <td key={colIndex} className="border-b border-[var(--border)] px-4 py-3">
              <Skeleton className="h-4" />
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      {icon && <div className="mb-3 text-[var(--text-subtle)]">{icon}</div>}
      <p className="text-sm font-medium text-[var(--text)]">{title}</p>
      {description && (
        <p className="mt-1 max-w-sm text-[13px] text-[var(--text-muted)]">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <p className="text-sm font-medium text-[var(--danger)]">Could not load this</p>
      <p className="mt-1 max-w-sm text-[13px] text-[var(--text-muted)]">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-4 text-[13px] font-medium text-[var(--text)] underline underline-offset-4"
        >
          Try again
        </button>
      )}
    </div>
  );
}

// ─── Stat tile ────────────────────────────────────────────────────────────────

export function StatTile({
  label,
  value,
  sub,
  loading,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  loading?: boolean;
}) {
  return (
    <Card className="px-5 py-4">
      <p className="text-[12px] uppercase tracking-wider text-[var(--text-muted)]">
        {label}
      </p>
      {loading ? (
        <Skeleton className="mt-2 h-8 w-20" />
      ) : (
        <p className="tabular mt-1.5 text-[28px] font-semibold leading-none text-[var(--text)]">
          {value}
        </p>
      )}
      {sub && !loading && (
        <p className="mt-1.5 text-[12px] text-[var(--text-muted)]">{sub}</p>
      )}
    </Card>
  );
}

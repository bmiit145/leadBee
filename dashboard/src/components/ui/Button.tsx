import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const button = cva(
  'inline-flex items-center justify-center gap-2 rounded-lg font-medium ' +
    'transition-colors duration-150 select-none whitespace-nowrap ' +
    'disabled:pointer-events-none disabled:opacity-45',
  {
    variants: {
      variant: {
        // Solid near-black (near-white in dark) — the single strongest weight in
        // the system, so there is never a question which action is primary.
        primary:
          'bg-[var(--accent)] text-[var(--accent-text)] hover:bg-[var(--accent-hover)]',
        outline:
          'border border-[var(--border-strong)] bg-transparent text-[var(--text)] ' +
          'hover:bg-[var(--surface)]',
        ghost: 'bg-transparent text-[var(--text-muted)] hover:bg-[var(--surface)] hover:text-[var(--text)]',
        // The only coloured control in the interface. It stays rare so it keeps
        // its meaning.
        danger:
          'border border-[var(--danger-border)] bg-[var(--danger-surface)] ' +
          'text-[var(--danger)] hover:brightness-95',
      },
      size: {
        sm: 'h-8 px-3 text-[13px]',
        md: 'h-9 px-4 text-sm',
        lg: 'h-10 px-5 text-sm',
        icon: 'h-9 w-9 p-0',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  }
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof button> {
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, loading, disabled, children, ...props },
  ref
) {
  return (
    <button
      ref={ref}
      // Disabling while in flight is what actually prevents the double-submit;
      // the spinner only explains why nothing is happening.
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(button({ variant, size }), className)}
      {...props}
    >
      {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
      {children}
    </button>
  );
});

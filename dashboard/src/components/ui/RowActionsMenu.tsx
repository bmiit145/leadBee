import { useId, useState, type ReactNode } from 'react';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import { MoreVertical } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface RowAction {
  key: string;
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  /** Destructive actions read in the danger colour, so they are never picked by habit. */
  tone?: 'default' | 'danger';
  disabled?: boolean;
  /** Shown under the label — used to say *why* an action is disabled. */
  hint?: string;
  /** Draws a rule above this item, to set destructive actions apart. */
  separated?: boolean;
}

/**
 * The "⋮" menu at the end of a table row.
 *
 * One quiet control per row instead of a strip of buttons: a list of two hundred
 * rows stays scannable, and actions that do not apply to a row (reactivating an
 * active account) are simply absent rather than disabled clutter. Presentational
 * only — the page decides which actions exist and what they do (DASH-3).
 *
 * Selecting an item closes the menu first, so a dialog the action opens is not
 * stacked under a menu that is still animating out.
 */
export function RowActionsMenu({
  label,
  actions,
}: {
  /** Accessible name for the trigger, e.g. "Actions for Priya Shah". */
  label: string;
  actions: RowAction[];
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const menuId = useId();
  const open = anchor !== null;

  if (actions.length === 0) return null;

  return (
    <>
      <button
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={(event) => setAnchor(event.currentTarget)}
        className={cn(
          'inline-flex h-8 w-8 items-center justify-center rounded-lg transition-colors',
          'text-[var(--text-muted)] hover:bg-[var(--surface)] hover:text-[var(--text)]',
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--text)]',
          open && 'bg-[var(--surface)] text-[var(--text)]'
        )}
      >
        <MoreVertical className="h-4 w-4" aria-hidden />
      </button>

      <Menu
        id={menuId}
        anchorEl={anchor}
        open={open}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{
          paper: {
            sx: {
              mt: 0.5,
              minWidth: 210,
              bgcolor: 'var(--surface-raised)',
              backgroundImage: 'none',
              border: '1px solid var(--border)',
              borderRadius: '10px',
              boxShadow: '0 10px 30px rgba(0, 0, 0, 0.12)',
            },
          },
        }}
      >
        {actions.map((action) => (
          <MenuItem
            key={action.key}
            disabled={action.disabled}
            onClick={() => {
              setAnchor(null);
              action.onSelect();
            }}
            sx={{
              gap: 1.25,
              px: 1.5,
              py: 1,
              alignItems: 'flex-start',
              fontSize: 13,
              color: action.tone === 'danger' ? 'var(--danger)' : 'var(--text)',
              borderTop: action.separated ? '1px solid var(--border)' : undefined,
              '&:hover': { bgcolor: 'var(--surface)' },
              '&.Mui-focusVisible': { bgcolor: 'var(--surface)' },
              '&.Mui-disabled': { opacity: 0.6 },
            }}
          >
            {action.icon && (
              <span className="mt-[1px] flex h-4 w-4 shrink-0 items-center justify-center" aria-hidden>
                {action.icon}
              </span>
            )}
            <span className="min-w-0">
              <span className="block leading-5">{action.label}</span>
              {action.hint && (
                <span className="block whitespace-normal text-[11px] leading-4 text-[var(--text-muted)]">
                  {action.hint}
                </span>
              )}
            </span>
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}

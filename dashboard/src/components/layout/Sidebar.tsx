import { NavLink } from 'react-router-dom';
import { Building2, LayoutDashboard, ScrollText, Settings, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/stores/auth.store';

interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  /** Hidden when the signed-in admin lacks this. */
  permission?: string;
}

const NAV: NavItem[] = [
  { to: '/overview', label: 'Overview', icon: LayoutDashboard, permission: 'metrics.view' },
  { to: '/organizations', label: 'Organizations', icon: Building2, permission: 'orgs.view' },
  { to: '/audit', label: 'Audit log', icon: ScrollText, permission: 'audit.view' },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { can } = useAuth();
  const items = NAV.filter((item) => !item.permission || can(item.permission));

  return (
    <>
      {/* Scrim, mobile only. */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          onClick={onClose}
          aria-hidden
        />
      )}

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-60 shrink-0 flex-col border-r',
          'border-[var(--border)] bg-[var(--surface)] transition-transform duration-200',
          'lg:static lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="flex h-14 items-center justify-between border-b border-[var(--border)] px-4">
          <div className="flex items-center gap-2">
            <span
              className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--accent)] text-[13px]"
              aria-hidden
            >
              🐝
            </span>
            <div className="leading-tight">
              <p className="text-[14px] font-semibold text-[var(--text)]">LeadBee</p>
              <p className="text-[11px] text-[var(--text-muted)]">Control plane</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-[var(--text-muted)] lg:hidden"
            aria-label="Close navigation"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto p-3">
          {items.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              onClick={onClose}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors',
                  isActive
                    ? 'bg-[var(--accent)] text-[var(--accent-text)]'
                    : 'text-[var(--text-muted)] hover:bg-[var(--border)] hover:text-[var(--text)]'
                )
              }
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-[var(--border)] px-4 py-3">
          <p className="text-[11px] text-[var(--text-subtle)]">
            Every action here is audited.
          </p>
        </div>
      </aside>
    </>
  );
}

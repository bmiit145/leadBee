import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogOut, Menu, Moon, Sun } from 'lucide-react';
import { useAuth } from '@/stores/auth.store';
import { useThemeMode } from '@/stores/theme.store';
import { Button } from '@/components/ui/Button';

export function Header({ onMenuClick }: { onMenuClick: () => void }) {
  const { admin, logout } = useAuth();
  const { mode, toggle } = useThemeMode();
  const navigate = useNavigate();
  const [signingOut, setSigningOut] = useState(false);

  async function handleLogout() {
    setSigningOut(true);
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-[var(--border)] bg-[var(--bg)] px-4 sm:px-6">
      <button
        onClick={onMenuClick}
        className="text-[var(--text-muted)] hover:text-[var(--text)] lg:hidden"
        aria-label="Open navigation"
      >
        <Menu className="h-5 w-5" />
      </button>

      <div className="flex-1" />

      <button
        onClick={toggle}
        className="flex h-9 w-9 items-center justify-center rounded-lg text-[var(--text-muted)] transition-colors hover:bg-[var(--surface)] hover:text-[var(--text)]"
        aria-label={`Switch to ${mode === 'dark' ? 'light' : 'dark'} theme`}
      >
        {mode === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      </button>

      <div className="hidden items-center gap-2.5 border-l border-[var(--border)] pl-3 sm:flex">
        <div className="text-right leading-tight">
          <p className="text-[13px] font-medium text-[var(--text)]">{admin?.name}</p>
          <p className="text-[11px] capitalize text-[var(--text-muted)]">{admin?.role}</p>
        </div>
        <span
          className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--accent)] text-[12px] font-semibold text-[var(--accent-text)]"
          aria-hidden
        >
          {admin?.name?.charAt(0).toUpperCase() ?? '?'}
        </span>
      </div>

      <Button
        variant="ghost"
        size="icon"
        onClick={handleLogout}
        loading={signingOut}
        aria-label="Sign out"
      >
        {!signingOut && <LogOut className="h-4 w-4" />}
      </Button>
    </header>
  );
}

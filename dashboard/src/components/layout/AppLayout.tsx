import { useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/stores/auth.store';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { Skeleton } from '@/components/ui/primitives';

export function AppLayout() {
  const { admin, loading } = useAuth();
  const location = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // The session probe has not settled. Redirecting now would bounce anyone who
  // reloads the page straight to /login despite a valid token.
  if (loading) {
    return (
      <div className="flex h-full">
        <div className="hidden w-60 shrink-0 border-r border-[var(--border)] p-4 lg:block">
          <Skeleton className="h-8 w-32" />
          <div className="mt-6 space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-8" />
            ))}
          </div>
        </div>
        <div className="flex-1 p-6">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="mt-6 h-64" />
        </div>
      </div>
    );
  }

  if (!admin) {
    // Remember where they were headed so login can return them there.
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return (
    <div className="flex h-full bg-[var(--bg)]">
      <Sidebar open={mobileNavOpen} onClose={() => setMobileNavOpen(false)} />

      <div className="flex min-w-0 flex-1 flex-col">
        <Header onMenuClick={() => setMobileNavOpen(true)} />
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}

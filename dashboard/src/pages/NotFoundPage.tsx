import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';

export function NotFoundPage() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <p className="font-mono text-[13px] text-[var(--text-subtle)]">404</p>
      <h1 className="mt-2 text-xl font-semibold text-[var(--text)]">Page not found</h1>
      <p className="mt-1 max-w-sm text-[13px] text-[var(--text-muted)]">
        That route does not exist in the console.
      </p>
      <Link to="/overview" className="mt-5">
        <Button variant="outline">Back to overview</Button>
      </Link>
    </div>
  );
}

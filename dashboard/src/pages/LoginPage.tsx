import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/stores/auth.store';
import { errorCode, errorMessage } from '@/services/api';
import { Button } from '@/components/ui/Button';
import { Card, Field, Input } from '@/components/ui/primitives';

export function LoginPage() {
  const { admin, loading, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  /** Only rendered once the API has told us this account has 2FA enrolled. */
  const [totpRequired, setTotpRequired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!loading && admin) {
    const from = (location.state as { from?: string } | null)?.from;
    return <Navigate to={from ?? '/overview'} replace />;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password, totpRequired ? totp : undefined);
      navigate('/overview', { replace: true });
    } catch (err) {
      // Not a failure — the account has 2FA and we simply have not asked yet.
      if (errorCode(err) === 'TOTP_REQUIRED') {
        setTotpRequired(true);
        setError(null);
      } else {
        setError(errorMessage(err, 'Could not sign in'));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-[var(--bg)] px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <span
            className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--accent)] text-lg"
            aria-hidden
          >
            🐝
          </span>
          <h1 className="text-xl font-semibold text-[var(--text)]">LeadBee Console</h1>
          <p className="mt-1 text-[13px] text-[var(--text-muted)]">
            Platform administration
          </p>
        </div>

        <Card className="p-6">
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <Field label="Email" htmlFor="email">
              <Input
                id="email"
                type="email"
                autoComplete="username"
                required
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@leadbee.io"
              />
            </Field>

            <Field label="Password" htmlFor="password">
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
            </Field>

            {totpRequired && (
              <Field
                label="Two-factor code"
                htmlFor="totp"
                hint="Six digits from your authenticator app"
              >
                <Input
                  id="totp"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  required
                  autoFocus
                  value={totp}
                  onChange={(e) => setTotp(e.target.value.replace(/\D/g, ''))}
                  placeholder="000000"
                  className="tabular tracking-[0.3em]"
                />
              </Field>
            )}

            {error && (
              <p
                role="alert"
                className="rounded-lg border border-[var(--danger-border)] bg-[var(--danger-surface)] px-3 py-2 text-[13px] text-[var(--danger)]"
              >
                {error}
              </p>
            )}

            <Button type="submit" loading={submitting} className="w-full">
              Sign in
            </Button>
          </form>
        </Card>

        <p className="mt-6 text-center text-[12px] text-[var(--text-subtle)]">
          This console reaches every tenant. Sessions are audited.
        </p>
      </div>
    </div>
  );
}

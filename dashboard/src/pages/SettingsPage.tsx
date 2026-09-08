import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ShieldCheck, ShieldAlert } from 'lucide-react';
import { platformService } from '@/services/platform.service';
import { errorMessage } from '@/services/api';
import { useAuth } from '@/stores/auth.store';
import { formatDateTime } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader, Field, Input } from '@/components/ui/primitives';

export function SettingsPage() {
  const { admin, refresh } = useAuth();
  const [enrolment, setEnrolment] = useState<{ secret: string; otpauthUrl: string } | null>(
    null
  );
  const [code, setCode] = useState('');

  const begin = useMutation({
    mutationFn: () => platformService.beginTotp(),
    onSuccess: setEnrolment,
    onError: (error) => toast.error(errorMessage(error)),
  });

  const confirm = useMutation({
    mutationFn: () => platformService.confirmTotp(code),
    onSuccess: async () => {
      toast.success('Two-factor authentication enabled');
      setEnrolment(null);
      setCode('');
      await refresh();
    },
    onError: (error) => toast.error(errorMessage(error, 'That code did not match')),
  });

  return (
    <div className="max-w-2xl space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-[var(--text)]">Settings</h1>
        <p className="mt-0.5 text-[13px] text-[var(--text-muted)]">
          Your platform account.
        </p>
      </div>

      <Card>
        <CardHeader title="Account" />
        <dl className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2">
          <div>
            <dt className="text-[12px] uppercase tracking-wider text-[var(--text-muted)]">
              Name
            </dt>
            <dd className="mt-1 text-[13px] text-[var(--text)]">{admin?.name}</dd>
          </div>
          <div>
            <dt className="text-[12px] uppercase tracking-wider text-[var(--text-muted)]">
              Email
            </dt>
            <dd className="mt-1 text-[13px] text-[var(--text)]">{admin?.email}</dd>
          </div>
          <div>
            <dt className="text-[12px] uppercase tracking-wider text-[var(--text-muted)]">
              Role
            </dt>
            <dd className="mt-1 text-[13px] capitalize text-[var(--text)]">{admin?.role}</dd>
          </div>
          <div>
            <dt className="text-[12px] uppercase tracking-wider text-[var(--text-muted)]">
              Last sign-in
            </dt>
            <dd className="mt-1 text-[13px] text-[var(--text)]">
              {formatDateTime(admin?.lastLoginAt)}
              {admin?.lastLoginIp && (
                <span className="block text-[12px] text-[var(--text-muted)]">
                  from {admin.lastLoginIp}
                </span>
              )}
            </dd>
          </div>
        </dl>
      </Card>

      <Card>
        <CardHeader
          title="Two-factor authentication"
          description="This account can reach every tenant. Enrol an authenticator app."
        />
        <div className="p-5">
          {admin?.totpEnabled ? (
            <div className="flex items-center gap-2.5">
              <ShieldCheck className="h-4 w-4 text-[var(--text)]" aria-hidden />
              <p className="text-[13px] text-[var(--text)]">
                Two-factor is enabled on this account.
              </p>
            </div>
          ) : enrolment ? (
            <div className="space-y-4">
              <p className="text-[13px] text-[var(--text-muted)]">
                Add this secret to your authenticator app, then enter the six-digit
                code it shows to finish.
              </p>
              <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                <p className="text-[12px] uppercase tracking-wider text-[var(--text-muted)]">
                  Secret
                </p>
                <code className="mt-1 block break-all font-mono text-[13px] text-[var(--text)]">
                  {enrolment.secret}
                </code>
              </div>
              <Field label="Verification code" htmlFor="code">
                <Input
                  id="code"
                  inputMode="numeric"
                  maxLength={6}
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  placeholder="000000"
                  className="tabular w-40 tracking-[0.3em]"
                />
              </Field>
              <div className="flex gap-2">
                <Button
                  loading={confirm.isPending}
                  disabled={code.length !== 6}
                  onClick={() => confirm.mutate()}
                >
                  Enable
                </Button>
                <Button variant="ghost" onClick={() => setEnrolment(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2.5">
                <ShieldAlert className="h-4 w-4 text-[var(--danger)]" aria-hidden />
                <p className="text-[13px] text-[var(--text)]">
                  Two-factor is not enabled.
                </p>
              </div>
              <Button loading={begin.isPending} onClick={() => begin.mutate()}>
                Set up two-factor
              </Button>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

import { useEffect, useState, type FormEvent } from 'react';
import Dialog from '@mui/material/Dialog';
import { AlertTriangle, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Field, Input, Textarea } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';

const REASON_MIN = 3;

/**
 * Confirmation for an account action (DASH-13).
 *
 * States the consequence, collects a reason for the audit log, and — for
 * actions that cannot be undone — asks for the email typed back. Account rows
 * look alike in a long list; typing the address is what stops "delete the
 * wrong person" from being one misclick away.
 *
 * The page owns the mutation and closes the dialog on success, so a failed
 * request leaves the reason in place to retry.
 */
export function AccountActionDialog({
  open,
  tone,
  title,
  description,
  confirmLabel,
  reasonRequired = false,
  reasonPlaceholder,
  typeToConfirm,
  loading,
  onConfirm,
  onClose,
}: {
  open: boolean;
  tone: 'danger' | 'primary';
  title: string;
  description: string;
  confirmLabel: string;
  reasonRequired?: boolean;
  reasonPlaceholder?: string;
  /** When set, the operator must type this (case-insensitive) to confirm. */
  typeToConfirm?: string;
  loading: boolean;
  onConfirm: (reason: string, confirmation: string) => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const [confirmation, setConfirmation] = useState('');

  // Reopened for another action, the dialog must not carry the last reason.
  useEffect(() => {
    if (!open) {
      setReason('');
      setConfirmation('');
    }
  }, [open]);

  const reasonOk = !reasonRequired || reason.trim().length >= REASON_MIN;
  const confirmOk =
    !typeToConfirm ||
    confirmation.trim().toLowerCase() === typeToConfirm.trim().toLowerCase();

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!reasonOk || !confirmOk || loading) return;
    onConfirm(reason.trim(), confirmation.trim());
  }

  const danger = tone === 'danger';
  const Icon = danger ? AlertTriangle : ShieldCheck;

  return (
    <Dialog
      open={open}
      // Closing mid-request would hide the outcome of an irreversible action.
      onClose={loading ? undefined : onClose}
      maxWidth="xs"
      fullWidth
      slotProps={{
        paper: {
          sx: {
            bgcolor: 'var(--surface-raised)',
            backgroundImage: 'none',
            border: '1px solid var(--border)',
            borderRadius: '12px',
          },
        },
      }}
    >
      <form onSubmit={handleSubmit} noValidate>
        <div className="flex items-start gap-3 border-b border-[var(--border)] px-5 py-4">
          <span
            className={cn(
              'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
              danger ? 'bg-[var(--danger-surface)]' : 'bg-[var(--surface)]'
            )}
          >
            <Icon
              className={cn('h-4 w-4', danger ? 'text-[var(--danger)]' : 'text-[var(--text)]')}
              aria-hidden
            />
          </span>
          <div>
            <h2 className="text-[15px] font-semibold text-[var(--text)]">{title}</h2>
            <p className="mt-0.5 text-[13px] text-[var(--text-muted)]">{description}</p>
          </div>
        </div>

        <div className="space-y-4 px-5 py-5">
          <Field
            label={reasonRequired ? 'Reason' : 'Reason (optional)'}
            htmlFor="account-action-reason"
            hint="Recorded in the platform audit log."
          >
            <Textarea
              id="account-action-reason"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={reasonPlaceholder}
              maxLength={500}
            />
          </Field>

          {typeToConfirm && (
            <Field label={`Type "${typeToConfirm}" to confirm`} htmlFor="account-action-confirm">
              <Input
                id="account-action-confirm"
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
                placeholder={typeToConfirm}
                autoComplete="off"
                spellCheck={false}
              />
            </Field>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-[var(--border)] px-5 py-4">
          <Button type="button" variant="ghost" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant={danger ? 'danger' : 'primary'}
            disabled={!reasonOk || !confirmOk}
            loading={loading}
          >
            {confirmLabel}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

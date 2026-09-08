import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import Dialog from '@mui/material/Dialog';
import { AlertTriangle } from 'lucide-react';
import { platformService } from '@/services/platform.service';
import { errorMessage } from '@/services/api';
import { Button } from '@/components/ui/Button';
import { Field, Input, Textarea } from '@/components/ui/primitives';

/**
 * Suspension locks every user of a tenant out of the product, so it asks for two
 * things a plain confirm dialog would not: a written reason, which goes to the
 * platform audit log, and the organization's name typed out.
 *
 * The type-to-confirm is not ceremony — this list is scanned quickly and the
 * rows look alike, and suspending the wrong customer is a support incident that
 * starts with them being unable to work.
 */
export function SuspendDialog({
  open,
  organizationId,
  organizationName,
  onClose,
  onSuspended,
}: {
  open: boolean;
  organizationId: string;
  organizationName: string;
  onClose: () => void;
  onSuspended: () => void;
}) {
  const [reason, setReason] = useState('');
  const [confirmation, setConfirmation] = useState('');

  const confirmed = confirmation.trim() === organizationName.trim();

  const mutation = useMutation({
    mutationFn: () =>
      platformService.setOrganizationStatus(organizationId, 'suspended', reason),
    onSuccess: () => {
      toast.success(`${organizationName} suspended`);
      onSuspended();
      handleClose();
    },
    onError: (error) => toast.error(errorMessage(error, 'Could not suspend')),
  });

  function handleClose() {
    setReason('');
    setConfirmation('');
    mutation.reset();
    onClose();
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!confirmed) return;
    mutation.mutate();
  }

  return (
    <Dialog
      open={open}
      onClose={handleClose}
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
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--danger-surface)]">
            <AlertTriangle className="h-4 w-4 text-[var(--danger)]" aria-hidden />
          </span>
          <div>
            <h2 className="text-[15px] font-semibold text-[var(--text)]">
              Suspend this organization?
            </h2>
            <p className="mt-0.5 text-[13px] text-[var(--text-muted)]">
              Every user loses access on their next request. Data is kept and the
              suspension can be lifted at any time.
            </p>
          </div>
        </div>

        <div className="space-y-4 px-5 py-5">
          <Field
            label="Reason"
            htmlFor="reason"
            hint="Recorded in the platform audit log."
          >
            <Textarea
              id="reason"
              required
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Non-payment after three reminders…"
            />
          </Field>

          <Field
            label={`Type "${organizationName}" to confirm`}
            htmlFor="confirmation"
          >
            <Input
              id="confirmation"
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              placeholder={organizationName}
              autoComplete="off"
            />
          </Field>
        </div>

        <div className="flex justify-end gap-2 border-t border-[var(--border)] px-5 py-4">
          <Button type="button" variant="ghost" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="danger"
            disabled={!confirmed || !reason.trim()}
            loading={mutation.isPending}
          >
            Suspend
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

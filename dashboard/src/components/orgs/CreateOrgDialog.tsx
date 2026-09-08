import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import Dialog from '@mui/material/Dialog';
import { platformService } from '@/services/platform.service';
import { errorMessage } from '@/services/api';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select } from '@/components/ui/primitives';
import type { Plan } from '@/types';

interface FormState {
  organizationName: string;
  slug: string;
  ownerName: string;
  ownerPhone: string;
  ownerEmail: string;
  ownerPassword: string;
  plan: Plan;
}

const EMPTY: FormState = {
  organizationName: '',
  slug: '',
  ownerName: '',
  ownerPhone: '',
  ownerEmail: '',
  ownerPassword: '',
  plan: 'starter',
};

/** `Acme Realty Pvt. Ltd.` → `acme-realty-pvt-ltd`, mirroring the server. */
function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

export function CreateOrgDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [form, setForm] = useState<FormState>(EMPTY);
  // Once the operator edits the handle by hand, stop overwriting it from the name.
  const [slugTouched, setSlugTouched] = useState(false);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const mutation = useMutation({
    mutationFn: () =>
      platformService.createOrganization({
        organizationName: form.organizationName,
        slug: form.slug || undefined,
        ownerName: form.ownerName,
        ownerPhone: form.ownerPhone,
        ownerEmail: form.ownerEmail,
        ownerPassword: form.ownerPassword,
        plan: form.plan,
        // Provisioned tenants start active — a sales-led customer should not
        // land in a trial that quietly expires on them.
        status: 'active',
      }),
    onSuccess: (result) => {
      toast.success(`${result.organization.name} provisioned`);
      void queryClient.invalidateQueries({ queryKey: ['platform', 'organizations'] });
      void queryClient.invalidateQueries({ queryKey: ['platform', 'metrics'] });
      handleClose();
      navigate(`/organizations/${result.organization._id}`);
    },
    onError: (error) => toast.error(errorMessage(error, 'Could not provision tenant')),
  });

  function handleClose() {
    setForm(EMPTY);
    setSlugTouched(false);
    mutation.reset();
    onClose();
  }

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      if (key === 'organizationName' && !slugTouched) {
        next.slug = slugify(String(value));
      }
      return next;
    });
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    mutation.mutate();
  }

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="sm"
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
        <div className="border-b border-[var(--border)] px-5 py-4">
          <h2 className="text-[15px] font-semibold text-[var(--text)]">
            Provision a tenant
          </h2>
          <p className="mt-0.5 text-[13px] text-[var(--text-muted)]">
            Creates the organization, its built-in roles and the owner account.
          </p>
        </div>

        <div className="space-y-4 px-5 py-5">
          <Field label="Organization name" htmlFor="orgName">
            <Input
              id="orgName"
              required
              autoFocus
              value={form.organizationName}
              onChange={(e) => update('organizationName', e.target.value)}
              placeholder="Acme Realty"
            />
          </Field>

          <Field
            label="Handle"
            htmlFor="slug"
            hint="Lowercase letters, numbers and hyphens. Must be unique."
          >
            <Input
              id="slug"
              value={form.slug}
              onChange={(e) => {
                setSlugTouched(true);
                update('slug', slugify(e.target.value));
              }}
              placeholder="acme-realty"
              className="font-mono text-[13px]"
            />
          </Field>

          <div className="h-px bg-[var(--border)]" />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Owner name" htmlFor="ownerName">
              <Input
                id="ownerName"
                required
                value={form.ownerName}
                onChange={(e) => update('ownerName', e.target.value)}
                placeholder="Asha Sharma"
              />
            </Field>

            <Field label="Owner phone" htmlFor="ownerPhone" hint="Used to sign in">
              <Input
                id="ownerPhone"
                required
                value={form.ownerPhone}
                onChange={(e) => update('ownerPhone', e.target.value)}
                placeholder="9000000001"
              />
            </Field>
          </div>

          <Field label="Owner email" htmlFor="ownerEmail">
            <Input
              id="ownerEmail"
              type="email"
              required
              value={form.ownerEmail}
              onChange={(e) => update('ownerEmail', e.target.value)}
              placeholder="asha@acme.com"
            />
          </Field>

          <Field
            label="Temporary password"
            htmlFor="ownerPassword"
            hint="At least 8 characters. Share it over a channel you trust."
          >
            <Input
              id="ownerPassword"
              required
              minLength={8}
              value={form.ownerPassword}
              onChange={(e) => update('ownerPassword', e.target.value)}
              placeholder="••••••••"
            />
          </Field>

          <Field label="Plan" htmlFor="plan">
            <Select
              id="plan"
              value={form.plan}
              onChange={(e) => update('plan', e.target.value as Plan)}
            >
              <option value="trial">Trial</option>
              <option value="starter">Starter</option>
              <option value="growth">Growth</option>
              <option value="enterprise">Enterprise</option>
            </Select>
          </Field>
        </div>

        <div className="flex justify-end gap-2 border-t border-[var(--border)] px-5 py-4">
          <Button type="button" variant="ghost" onClick={handleClose}>
            Cancel
          </Button>
          <Button type="submit" loading={mutation.isPending}>
            Provision
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

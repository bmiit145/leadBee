import { useEffect, useState, type FormEvent } from 'react';
import Dialog from '@mui/material/Dialog';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { platformService, queryKeys, type OrganizationUpdatePayload } from '@/services/platform.service';
import { errorMessage } from '@/services/api';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/primitives';
import { mobilePhoneError } from '@/lib/phone';
import type { OrganizationDetail } from '@/types';

interface FormState {
  organizationName: string;
  slug: string;
  billingEmail: string;
  contactPhone: string;
  ownerName: string;
  ownerPhone: string;
  ownerEmail: string;
}

function emptyForm(): FormState {
  return {
    organizationName: '',
    slug: '',
    billingEmail: '',
    contactPhone: '',
    ownerName: '',
    ownerPhone: '',
    ownerEmail: '',
  };
}

function toForm(org: OrganizationDetail): FormState {
  return {
    organizationName: org.name,
    slug: org.slug,
    billingEmail: org.billingEmail ?? '',
    contactPhone: org.contactPhone ?? '',
    ownerName: org.owner?.name ?? '',
    ownerPhone: org.owner?.phone ?? '',
    ownerEmail: org.owner?.email ?? '',
  };
}

export function EditOrganizationDialog({
  open,
  organization,
  onClose,
  onSaved,
}: {
  open: boolean;
  organization: OrganizationDetail | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(() =>
    organization ? toForm(organization) : emptyForm()
  );

  useEffect(() => {
    if (organization) setForm(toForm(organization));
  }, [organization]);

  const ownerPhoneError = form.ownerPhone ? mobilePhoneError(form.ownerPhone) : undefined;

  const mutation = useMutation({
    mutationFn: () => {
      if (!organization) throw new Error('Organization not loaded');
      const payload: OrganizationUpdatePayload = {
        organizationName: form.organizationName.trim(),
        slug: form.slug.trim().toLowerCase(),
        billingEmail: form.billingEmail.trim() || null,
        contactPhone: form.contactPhone.trim() || null,
        ownerName: form.ownerName.trim(),
        ownerPhone: form.ownerPhone.trim(),
        ownerEmail: form.ownerEmail.trim() || null,
      };
      return platformService.updateOrganization(organization._id, payload);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.organization(organization?._id ?? '') });
      void queryClient.invalidateQueries({ queryKey: ['platform', 'organizations'] });
      onSaved();
    },
    onError: (error) => {
      // Keep server validation errors visible because the backend is authoritative.
      void Promise.resolve(errorMessage(error, 'Could not update organization'));
    },
  });

  function update(key: keyof FormState, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!form.organizationName.trim() || !form.slug.trim() || !form.ownerName.trim()) return;
    if (ownerPhoneError) return;
    mutation.mutate();
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
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
      <form onSubmit={submit} noValidate>
        <div className="border-b border-[var(--border)] px-5 py-4">
          <h2 className="text-[15px] font-semibold text-[var(--text)]">Edit organization</h2>
          <p className="mt-0.5 text-[13px] text-[var(--text-muted)]">
            Update tenant contact details and the primary owner profile.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 px-5 py-5 sm:grid-cols-2">
          <Field label="Organization name" htmlFor="edit-org-name">
            <Input id="edit-org-name" required value={form.organizationName} onChange={(e) => update('organizationName', e.target.value)} />
          </Field>
          <Field label="Handle" htmlFor="edit-org-slug" hint="Lowercase letters, numbers and hyphens.">
            <Input id="edit-org-slug" required value={form.slug} onChange={(e) => update('slug', e.target.value)} className="font-mono text-[13px]" />
          </Field>
          <Field label="Billing email" htmlFor="edit-billing-email">
            <Input id="edit-billing-email" type="email" value={form.billingEmail} onChange={(e) => update('billingEmail', e.target.value)} />
          </Field>
          <Field label="Contact phone" htmlFor="edit-contact-phone">
            <Input id="edit-contact-phone" type="tel" value={form.contactPhone} onChange={(e) => update('contactPhone', e.target.value)} placeholder="+91 9876543210" />
          </Field>
          <Field label="Owner name" htmlFor="edit-owner-name">
            <Input id="edit-owner-name" required value={form.ownerName} onChange={(e) => update('ownerName', e.target.value)} />
          </Field>
          <Field label="Owner phone" htmlFor="edit-owner-phone" error={ownerPhoneError} hint="Validated as a mobile number. Default country: India.">
            <Input id="edit-owner-phone" required type="tel" value={form.ownerPhone} onChange={(e) => update('ownerPhone', e.target.value)} placeholder="+91 9876543210" />
          </Field>
          <Field label="Owner email" htmlFor="edit-owner-email">
            <Input id="edit-owner-email" type="email" value={form.ownerEmail} onChange={(e) => update('ownerEmail', e.target.value)} />
          </Field>
        </div>

        <div className="flex justify-end gap-2 border-t border-[var(--border)] px-5 py-4">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={mutation.isPending} disabled={!organization || !form.organizationName.trim() || !form.slug.trim() || !form.ownerName.trim() || !form.ownerPhone.trim() || Boolean(ownerPhoneError)}>
            Save changes
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

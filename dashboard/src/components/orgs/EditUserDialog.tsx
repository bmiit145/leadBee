import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Dialog from '@mui/material/Dialog';
import { platformService, queryKeys } from '@/services/platform.service';
import { errorMessage } from '@/services/api';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select } from '@/components/ui/primitives';
import { DEFAULT_PHONE_COUNTRY, normalizePhone, validatePhone } from '@/lib/phone';
import type { TenantUser } from '@/types';

interface FormState {
  name: string;
  phone: string;
  email: string;
  designation: string;
  role: string;
  password: string;
}

function toForm(user: TenantUser): FormState {
  return {
    name: user.name,
    phone: user.phone,
    email: user.email ?? '',
    designation: user.designation ?? '',
    role: user.role,
    password: '',
  };
}

const ROLES = ['user', 'partner', 'manager', 'admin', 'owner'];

export function EditUserDialog({
  open,
  organizationId,
  user,
  onClose,
}: {
  open: boolean;
  organizationId: string;
  user: TenantUser | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(() => (user ? toForm(user) : { name: '', phone: '', email: '', designation: '', role: 'user', password: '' }));

  useEffect(() => {
    if (user) setForm(toForm(user));
  }, [user]);

  const mutation = useMutation({
    mutationFn: () => {
      if (!user) throw new Error('User not selected');
      const phone = normalizePhone(form.phone, DEFAULT_PHONE_COUNTRY);
      if (!phone) throw new Error('Enter a valid phone number');
      return platformService.updateOrganizationUser(organizationId, user._id, {
        name: form.name.trim(),
        phone,
        email: form.email.trim() || null,
        designation: form.designation.trim() || null,
        role: form.role,
        ...(form.password ? { password: form.password } : {}),
        phoneCountry: DEFAULT_PHONE_COUNTRY,
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.organizationUsers(organizationId, 1) });
      void queryClient.invalidateQueries({ queryKey: ['platform', 'organization', organizationId, 'users'] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.organization(organizationId) });
      onClose();
    },
    onError: (error) => errorMessage(error, 'Could not update user'),
  });

  const phoneError = form.phone && !validatePhone(form.phone).valid ? validatePhone(form.phone).message : undefined;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!validatePhone(form.phone).valid || !form.name.trim()) return;
    mutation.mutate();
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth slotProps={{ paper: { sx: { bgcolor: 'var(--surface-raised)', backgroundImage: 'none', border: '1px solid var(--border)', borderRadius: '12px' } } }}>
      <form onSubmit={submit} noValidate>
        <div className="border-b border-[var(--border)] px-5 py-4">
          <h2 className="text-[15px] font-semibold text-[var(--text)]">Edit user</h2>
          <p className="mt-0.5 text-[13px] text-[var(--text-muted)]">Changes to phone or password invalidate the user’s current sessions.</p>
        </div>
        <div className="grid grid-cols-1 gap-4 px-5 py-5 sm:grid-cols-2">
          <Field label="Name" htmlFor="edit-user-name"><Input id="edit-user-name" required value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} /></Field>
          <Field label="Role" htmlFor="edit-user-role"><Select id="edit-user-role" value={form.role} onChange={(e) => setForm((p) => ({ ...p, role: e.target.value }))}>{ROLES.map((role) => <option key={role} value={role}>{role}</option>)}</Select></Field>
          <Field label="Phone" htmlFor="edit-user-phone" error={phoneError} hint="Validated against international numbering metadata and stored in E.164."><Input id="edit-user-phone" required type="tel" value={form.phone} onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))} placeholder="+91 9876543210" /></Field>
          <Field label="Email" htmlFor="edit-user-email"><Input id="edit-user-email" type="email" value={form.email} onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))} /></Field>
          <Field label="Designation" htmlFor="edit-user-designation"><Input id="edit-user-designation" value={form.designation} onChange={(e) => setForm((p) => ({ ...p, designation: e.target.value }))} placeholder="Sales Manager" /></Field>
          <Field label="Reset password" htmlFor="edit-user-password" hint="Leave blank to keep the current password."><Input id="edit-user-password" type="password" minLength={8} value={form.password} onChange={(e) => setForm((p) => ({ ...p, password: e.target.value }))} autoComplete="new-password" /></Field>
        </div>
        <div className="flex justify-end gap-2 border-t border-[var(--border)] px-5 py-4">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={mutation.isPending} disabled={!user || !form.name.trim() || !form.phone.trim() || Boolean(phoneError)}>Save changes</Button>
        </div>
      </form>
    </Dialog>
  );
}

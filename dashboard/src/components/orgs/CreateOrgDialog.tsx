import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import Dialog from '@mui/material/Dialog';
import { platformService } from '@/services/platform.service';
import { errorMessage } from '@/services/api';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select } from '@/components/ui/primitives';
import type { PlanKey } from '@/types';
import { useAssignablePlans } from '@/hooks/usePlans';
import { isValidMobilePhone, mobilePhoneError } from '@/lib/phone';

interface FormState {
  organizationName: string;
  slug: string;
  ownerName: string;
  ownerPhone: string;
  ownerEmail: string;
  ownerPassword: string;
  plan: PlanKey;
}

const EMPTY: FormState = {
  organizationName: '',
  slug: '',
  ownerName: '',
  ownerPhone: '',
  ownerEmail: '',
  ownerPassword: '',
  // Filled from the catalogue once it loads — there is no longer a plan key
  // this component can assume exists.
  plan: '',
};

const MIN_PASSWORD = 8;
/** Loose on purpose: the API owns the real rule; this only catches typos early. */
const EMAIL_PATTERN = /^\S+@\S+\.\S+$/;

/** `Acme Realty Pvt. Ltd.` → `acme-realty-pvt-ltd`, mirroring the server. */
function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

/**
 * Provision an organization for a sales-led customer.
 *
 * The owner is a person, and a person has one LeadBee account (ADR-0004). If the
 * email and phone already belong to someone, the organization is created with
 * that account as its owner and the password here is not used — they keep the
 * one they sign in with. An email or phone that belongs to a *different* person
 * is refused by the API, and nothing is created.
 */
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
  // Errors are shown once the operator has left the field or tried to submit,
  // so a value is not marked wrong while it is still being typed.
  const [phoneTouched, setPhoneTouched] = useState(false);
  const [emailTouched, setEmailTouched] = useState(false);
  const [passwordTouched, setPasswordTouched] = useState(false);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const { plans, isLoading: plansLoading } = useAssignablePlans();
  const selectedPlan = plans.find((p) => p.key === form.plan);

  // Default to the first assignable plan once the catalogue arrives. Done as an
  // effect rather than in `EMPTY` because there is no plan key the client can
  // assume exists — that assumption was the old hardcoded 'starter'.
  useEffect(() => {
    if (!form.plan && plans.length > 0) {
      setForm((prev) => (prev.plan ? prev : { ...prev, plan: plans[0]!.key }));
    }
  }, [plans, form.plan]);

  const emailError =
    emailTouched && !EMAIL_PATTERN.test(form.ownerEmail.trim())
      ? 'Enter the owner’s email — they can sign in with it.'
      : undefined;
  // Optional, because an existing account keeps its own password. When given,
  // it must meet the same minimum the API enforces.
  const passwordError =
    passwordTouched && form.ownerPassword.length > 0 && form.ownerPassword.length < MIN_PASSWORD
      ? `At least ${MIN_PASSWORD} characters.`
      : undefined;

  const mutation = useMutation({
    mutationFn: () =>
      platformService.createOrganization({
        organizationName: form.organizationName,
        slug: form.slug || undefined,
        ownerName: form.ownerName,
        ownerPhone: form.ownerPhone,
        ownerEmail: form.ownerEmail.trim(),
        ownerPassword: form.ownerPassword || undefined,
        plan: form.plan,
        // Provisioned tenants start active — a sales-led customer should not
        // land in a trial that quietly expires on them.
        status: 'active',
      }),
    onSuccess: (result) => {
      if (result.ownerAccountCreated) {
        toast.success(`${result.organization.name} provisioned`);
      } else {
        // Say so plainly: an operator who typed a password must not go and
        // share it, because it is not the one this person signs in with.
        toast.success(
          `${result.organization.name} provisioned. ${result.owner.name} already had a LeadBee account, so they were made owner with it and keep their own password.`,
          { duration: 8000 }
        );
      }
      void queryClient.invalidateQueries({ queryKey: ['platform', 'organizations'] });
      void queryClient.invalidateQueries({ queryKey: ['platform', 'accounts'] });
      void queryClient.invalidateQueries({ queryKey: ['platform', 'metrics'] });
      handleClose();
      navigate(`/organizations/${result.organization._id}`);
    },
    // 409 names the clash — "This email is already linked to a different mobile
    // number" — and 400 asks for a password when the owner is new.
    onError: (error) => toast.error(errorMessage(error, 'Could not provision tenant')),
  });

  function handleClose() {
    setForm(EMPTY);
    setSlugTouched(false);
    setPhoneTouched(false);
    setEmailTouched(false);
    setPasswordTouched(false);
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

    // The form is `noValidate`, so nothing else stops a submit. Without this the
    // owner phone reaches the API unchecked — which is how a nine-digit number
    // was provisioned as an owner who could then never sign in.
    const phoneOk = isValidMobilePhone(form.ownerPhone);
    const emailOk = EMAIL_PATTERN.test(form.ownerEmail.trim());
    const passwordOk = form.ownerPassword.length === 0 || form.ownerPassword.length >= MIN_PASSWORD;
    if (!phoneOk || !emailOk || !passwordOk) {
      setPhoneTouched(true);
      setEmailTouched(true);
      setPasswordTouched(true);
      return;
    }

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
            Creates the organization and its built-in roles, and makes the owner a member.
            If the owner already has a LeadBee account, that account is used.
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

            <Field
              label="Owner phone"
              htmlFor="ownerPhone"
              hint="They can sign in with this or their email"
              error={phoneTouched ? mobilePhoneError(form.ownerPhone) : undefined}
            >
              <Input
                id="ownerPhone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                required
                value={form.ownerPhone}
                onChange={(e) => update('ownerPhone', e.target.value)}
                onBlur={() => setPhoneTouched(true)}
                placeholder="9000000001"
              />
            </Field>
          </div>

          <Field
            label="Owner email"
            htmlFor="ownerEmail"
            hint="Must not already belong to someone with a different phone."
            error={emailError}
          >
            <Input
              id="ownerEmail"
              type="email"
              required
              value={form.ownerEmail}
              onChange={(e) => update('ownerEmail', e.target.value)}
              onBlur={() => setEmailTouched(true)}
              placeholder="asha@acme.com"
            />
          </Field>

          <Field
            label="Temporary password"
            htmlFor="ownerPassword"
            hint="Needed only if the owner is new to LeadBee — at least 8 characters, shared over a channel you trust. Someone who already has an account keeps their own password."
            error={passwordError}
          >
            <Input
              id="ownerPassword"
              type="password"
              autoComplete="new-password"
              minLength={MIN_PASSWORD}
              value={form.ownerPassword}
              onChange={(e) => update('ownerPassword', e.target.value)}
              onBlur={() => setPasswordTouched(true)}
              placeholder="••••••••"
            />
          </Field>

          <Field
            label="Plan"
            htmlFor="plan"
            hint={
              selectedPlan?.trialDays
                ? `Includes a ${selectedPlan.trialDays}-day trial.`
                : undefined
            }
          >
            <Select
              id="plan"
              value={form.plan}
              disabled={plansLoading}
              onChange={(e) => update('plan', e.target.value as PlanKey)}
            >
              {plansLoading && <option value="">Loading plans…</option>}
              {plans.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.name}
                </option>
              ))}
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

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Layers, Plus } from 'lucide-react';

import { platformService, queryKeys } from '@/services/platform.service';
import { errorMessage } from '@/services/api';
import { useAuth } from '@/stores/auth.store';
import { Button } from '@/components/ui/Button';
import {
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Select,
  Skeleton,
} from '@/components/ui/primitives';
import { PlanBuilder } from '@/components/plans/PlanBuilder';
import type { FeatureGrant, PlanStatus, PlanSummary } from '@/types';

/**
 * Plan administration.
 *
 * Editing a plan **publishes a new version** rather than mutating the current
 * one, so a tenant's terms cannot change because someone edited a form. The
 * version a customer holds is what they keep until they are migrated.
 */
export function PlansPage() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const editable = can('orgs.plan');

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftState | null>(null);

  const plansQuery = useQuery({
    queryKey: queryKeys.plans(),
    queryFn: () => platformService.listPlans(),
  });

  const catalogQuery = useQuery({
    queryKey: queryKeys.catalog,
    queryFn: () => platformService.catalog(),
  });

  const planQuery = useQuery({
    queryKey: queryKeys.plan(selectedKey ?? ''),
    queryFn: () => platformService.getPlan(selectedKey!),
    enabled: Boolean(selectedKey),
  });

  // Select the first plan once the list arrives.
  useEffect(() => {
    if (!selectedKey && plansQuery.data?.length) setSelectedKey(plansQuery.data[0]!.key);
  }, [plansQuery.data, selectedKey]);

  // Load the selected plan into an editable draft.
  useEffect(() => {
    if (planQuery.data?.plan) setDraft(toDraft(planQuery.data.plan));
  }, [planQuery.data]);

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['platform', 'plans'] });
    void queryClient.invalidateQueries({ queryKey: ['platform', 'plan'] });
  }

  const publish = useMutation({
    mutationFn: () =>
      platformService.publishPlanRevision(selectedKey!, {
        name: draft!.name,
        description: draft!.description || undefined,
        status: draft!.status,
        isPublic: draft!.isPublic,
        sortOrder: draft!.sortOrder,
        trialDays: draft!.trialDays,
        grants: draft!.grants,
      }),
    onSuccess: (plan) => {
      toast.success(`Published ${plan.name} v${plan.version}`);
      invalidate();
    },
    onError: (error) => toast.error(errorMessage(error, 'Could not publish revision')),
  });

  const create = useMutation({
    mutationFn: (input: { key: string; name: string }) =>
      platformService.createPlan({
        key: input.key,
        name: input.name,
        status: 'draft',
        trialDays: 0,
        grants: [],
      }),
    onSuccess: (plan) => {
      toast.success(`${plan.name} created as a draft`);
      setSelectedKey(plan.key);
      invalidate();
    },
    onError: (error) => toast.error(errorMessage(error, 'Could not create plan')),
  });

  if (plansQuery.isError) {
    return <ErrorState message={errorMessage(plansQuery.error)} />;
  }

  const plans = plansQuery.data ?? [];
  const usage = planQuery.data?.usage ?? [];
  const subscribers = usage.reduce((sum, u) => sum + u.organizations, 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[18px] font-semibold text-[var(--text)]">Plans</h1>
          <p className="text-[13px] text-[var(--text-muted)]">
            Modules and features are registered by the backend. Pick what each plan
            includes — no deploy required.
          </p>
        </div>
        {editable && <NewPlanButton onCreate={create.mutate} pending={create.isPending} />}
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[240px_1fr]">
        {/* ─── Plan list ─────────────────────────────────────────────────── */}
        <Card className="h-fit">
          <CardHeader title="Catalogue" />
          <div className="p-2">
            {plansQuery.isPending ? (
              <div className="space-y-2 p-2">
                {[0, 1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-9 w-full" />
                ))}
              </div>
            ) : plans.length === 0 ? (
              <EmptyState
                icon={<Layers className="h-5 w-5" aria-hidden />}
                title="No plans yet"
                description="Create one to start selling."
              />
            ) : (
              plans.map((plan) => (
                <PlanRow
                  key={plan.key}
                  plan={plan}
                  active={plan.key === selectedKey}
                  onSelect={() => setSelectedKey(plan.key)}
                />
              ))
            )}
          </div>
        </Card>

        {/* ─── Editor ────────────────────────────────────────────────────── */}
        <Card>
          {!draft || catalogQuery.isPending || planQuery.isPending ? (
            <div className="space-y-3 p-5">
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-40 w-full" />
            </div>
          ) : (
            <>
              <CardHeader
                title={`${draft.name} · v${draft.version}`}
                description={
                  subscribers > 0
                    ? `${subscribers} organization${subscribers === 1 ? '' : 's'} on this plan. Saving publishes v${draft.version + 1}; existing tenants stay on the version they hold.`
                    : 'No subscribers yet. Saving publishes the next version.'
                }
              />

              <div className="space-y-5 p-5">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <Field label="Name" htmlFor="planName">
                    <Input
                      id="planName"
                      value={draft.name}
                      disabled={!editable}
                      onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    />
                  </Field>

                  <Field
                    label="Trial days"
                    htmlFor="trialDays"
                    hint="0 means no trial."
                  >
                    <Input
                      id="trialDays"
                      type="number"
                      min={0}
                      max={365}
                      value={draft.trialDays}
                      disabled={!editable}
                      onChange={(e) =>
                        setDraft({ ...draft, trialDays: Math.max(0, Number(e.target.value)) })
                      }
                    />
                  </Field>

                  <Field label="Status" htmlFor="planStatus">
                    <Select
                      id="planStatus"
                      value={draft.status}
                      disabled={!editable}
                      onChange={(e) =>
                        setDraft({ ...draft, status: e.target.value as PlanStatus })
                      }
                    >
                      <option value="draft">Draft</option>
                      <option value="active">Active</option>
                      <option value="grandfathered">Grandfathered</option>
                      <option value="retired">Retired</option>
                    </Select>
                  </Field>

                  <Field label="Sort order" htmlFor="sortOrder" hint="Lower shows first.">
                    <Input
                      id="sortOrder"
                      type="number"
                      min={0}
                      value={draft.sortOrder}
                      disabled={!editable}
                      onChange={(e) =>
                        setDraft({ ...draft, sortOrder: Math.max(0, Number(e.target.value)) })
                      }
                    />
                  </Field>
                </div>

                <PlanBuilder
                  catalog={catalogQuery.data ?? []}
                  grants={draft.grants}
                  disabled={!editable}
                  onChange={(grants) => setDraft({ ...draft, grants })}
                />
              </div>

              {editable && (
                <div className="flex justify-end gap-2 border-t border-[var(--border)] px-5 py-4">
                  <Button
                    variant="ghost"
                    onClick={() => planQuery.data && setDraft(toDraft(planQuery.data.plan))}
                  >
                    Discard changes
                  </Button>
                  <Button loading={publish.isPending} onClick={() => publish.mutate()}>
                    Publish v{draft.version + 1}
                  </Button>
                </div>
              )}
            </>
          )}
        </Card>
      </div>
    </div>
  );
}

// ─── Pieces ───────────────────────────────────────────────────────────────────

interface DraftState {
  key: string;
  version: number;
  name: string;
  description: string;
  status: PlanStatus;
  isPublic: boolean;
  sortOrder: number;
  trialDays: number;
  grants: FeatureGrant[];
}

function toDraft(plan: PlanSummary): DraftState {
  return {
    key: plan.key,
    version: plan.version,
    name: plan.name,
    description: plan.description ?? '',
    status: plan.status,
    isPublic: plan.isPublic,
    sortOrder: plan.sortOrder,
    trialDays: plan.trialDays,
    grants: plan.grants ?? [],
  };
}

function PlanRow({
  plan,
  active,
  onSelect,
}: {
  plan: PlanSummary;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={
        'flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-[13px] transition-colors ' +
        (active
          ? 'bg-[var(--accent)] text-[var(--accent-text)]'
          : 'text-[var(--text-muted)] hover:bg-[var(--border)] hover:text-[var(--text)]')
      }
    >
      <span className="truncate">{plan.name}</span>
      <span className="ml-2 shrink-0 text-[11px] opacity-70">v{plan.version}</span>
    </button>
  );
}

function NewPlanButton({
  onCreate,
  pending,
}: {
  onCreate: (input: { key: string; name: string }) => void;
  pending: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');

  const key = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" aria-hidden />
        New plan
      </Button>
    );
  }

  return (
    <div className="flex items-end gap-2">
      <Field label="Plan name" htmlFor="newPlanName" hint={key ? `Key: ${key}` : undefined}>
        <Input
          id="newPlanName"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Professional"
        />
      </Field>
      <Button
        loading={pending}
        disabled={key.length < 2}
        onClick={() => {
          onCreate({ key, name: name.trim() });
          setName('');
          setOpen(false);
        }}
      >
        Create
      </Button>
      <Button variant="ghost" onClick={() => setOpen(false)}>
        Cancel
      </Button>
    </div>
  );
}

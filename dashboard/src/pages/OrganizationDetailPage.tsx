import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Ban, CheckCircle2, Edit3, Users } from 'lucide-react';
import { platformService, queryKeys } from '@/services/platform.service';
import { errorMessage } from '@/services/api';
import { formatDate, formatNumber, formatRelative, humanize } from '@/lib/utils';
import { useAuth } from '@/stores/auth.store';
import { Button } from '@/components/ui/Button';
import { ActiveDot, PlanChip, StatusChip } from '@/components/ui/StatusChip';
import { Card, CardHeader, EmptyState, ErrorState, Select, Skeleton, Table, TableSkeleton, TableWrap, Td, Th, Tr, Textarea } from '@/components/ui/primitives';
import { SuspendDialog } from '@/components/orgs/SuspendDialog';
import { EditOrganizationDialog } from '@/components/orgs/EditOrganizationDialog';
import { EditUserDialog } from '@/components/orgs/EditUserDialog';
import type { PlanKey, TenantUser } from '@/types';
import { planLabel, useAssignablePlans, usePlans } from '@/hooks/usePlans';

export function OrganizationDetailPage() {
  const { id = '' } = useParams();
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [suspendOpen, setSuspendOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editUser, setEditUser] = useState<TenantUser | null>(null);
  const [usersPage, setUsersPage] = useState(1);
  const [notes, setNotes] = useState<string | null>(null);

  const orgQuery = useQuery({ queryKey: queryKeys.organization(id), queryFn: () => platformService.getOrganization(id), enabled: Boolean(id) });
  const usersQuery = useQuery({ queryKey: queryKeys.organizationUsers(id, usersPage), queryFn: () => platformService.listOrganizationUsers(id, { page: usersPage, limit: 25 }), enabled: Boolean(id), placeholderData: (previous) => previous });

  function invalidateOrg() {
    void queryClient.invalidateQueries({ queryKey: queryKeys.organization(id) });
    void queryClient.invalidateQueries({ queryKey: ['platform', 'organizations'] });
    void queryClient.invalidateQueries({ queryKey: ['platform', 'metrics'] });
  }

  const reactivate = useMutation({
    mutationFn: () => platformService.setOrganizationStatus(id, 'active'),
    onSuccess: () => { toast.success('Organization reactivated'); invalidateOrg(); },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const { plans: allPlans } = usePlans();
  const { plans: assignablePlans } = useAssignablePlans();
  const changePlan = useMutation({
    mutationFn: (plan: PlanKey) => platformService.setOrganizationPlan(id, plan),
    onSuccess: (org) => { toast.success(`Moved to the ${org.plan} plan`); invalidateOrg(); },
    onError: (error) => toast.error(errorMessage(error, 'Could not change plan')),
  });

  const saveNotes = useMutation({
    mutationFn: (value: string) => platformService.setInternalNotes(id, value),
    onSuccess: () => { toast.success('Notes saved'); setNotes(null); invalidateOrg(); },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const toggleUser = useMutation({
    mutationFn: ({ userId, isActive }: { userId: string; isActive: boolean }) => platformService.setUserActive(id, userId, isActive),
    onSuccess: (user) => { toast.success(`${user.name} ${user.isActive ? 'reactivated' : 'deactivated'}`); void queryClient.invalidateQueries({ queryKey: ['platform', 'organization', id, 'users'] }); invalidateOrg(); },
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (orgQuery.isError) return <ErrorState message={errorMessage(orgQuery.error)} onRetry={() => void orgQuery.refetch()} />;

  const org = orgQuery.data;
  const suspended = org?.status === 'suspended';

  return (
    <div className="space-y-5">
      <Link to="/organizations" className="inline-flex items-center gap-1.5 text-[13px] text-[var(--text-muted)] hover:text-[var(--text)]">
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Organizations
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          {orgQuery.isPending ? <><Skeleton className="h-7 w-56" /><Skeleton className="mt-2 h-4 w-32" /></> : <>
            <div className="flex flex-wrap items-center gap-2.5"><h1 className="text-xl font-semibold text-[var(--text)]">{org?.name}</h1>{org && <StatusChip status={org.status} />}</div>
            <p className="mt-0.5 font-mono text-[13px] text-[var(--text-muted)]">{org?.slug}</p>
          </>}
        </div>
        {org && <div className="flex gap-2">
          {can('orgs.update') && <Button variant="outline" onClick={() => setEditOpen(true)}><Edit3 className="h-4 w-4" aria-hidden /> Edit</Button>}
          {can('orgs.suspend') && (suspended ? <Button onClick={() => reactivate.mutate()} loading={reactivate.isPending}><CheckCircle2 className="h-4 w-4" aria-hidden /> Reactivate</Button> : <Button variant="danger" onClick={() => setSuspendOpen(true)}><Ban className="h-4 w-4" aria-hidden /> Suspend</Button>)}
        </div>}
      </div>

      {suspended && org?.suspendedReason && <Card className="border-[var(--danger-border)] bg-[var(--danger-surface)] px-5 py-3.5"><p className="text-[13px] text-[var(--text)]"><span className="font-semibold text-[var(--danger)]">Suspended</span>{org.suspendedAt && ` on ${formatDate(org.suspendedAt)}`} — {org.suspendedReason}</p></Card>}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2"><CardHeader title="Account" /><dl className="grid grid-cols-1 gap-x-6 gap-y-4 p-5 sm:grid-cols-2">
          <Fact label="Plan">{orgQuery.isPending ? <Skeleton className="h-5 w-24" /> : can('orgs.plan') && org ? <Select value={org.plan} disabled={changePlan.isPending} onChange={(e) => changePlan.mutate(e.target.value as PlanKey)} className="w-auto" aria-label="Change plan">
            {!assignablePlans.some((p) => p.key === org.plan) && <option value={org.plan}>{planLabel(allPlans, org.plan)}</option>}{assignablePlans.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
          </Select> : org && <PlanChip plan={org.plan} label={planLabel(allPlans, org.plan)} sortOrder={allPlans.find((p) => p.key === org.plan)?.sortOrder} />}</Fact>
          <Fact label="Data tier"><span className="text-[13px] capitalize text-[var(--text)]">{org?.tier ?? '—'}</span></Fact>
          <Fact label="Users"><span className="tabular text-[13px] text-[var(--text)]">{formatNumber(org?.counts.activeUsers)} active{org && org.limits.maxUsers !== -1 && <span className="text-[var(--text-subtle)]"> of {org.limits.maxUsers} allowed</span>}</span></Fact>
          <Fact label="Leads"><span className="tabular text-[13px] text-[var(--text)]">{formatNumber(org?.counts.leads)}{org && org.limits.maxLeads !== -1 && <span className="text-[var(--text-subtle)]"> of {formatNumber(org.limits.maxLeads)}</span>}</span></Fact>
          <Fact label="Owner"><span className="text-[13px] text-[var(--text)]">{org?.owner?.name ?? '—'}{org?.owner?.email && <span className="block text-[12px] text-[var(--text-muted)]">{org.owner.email}</span>}</span></Fact>
          <Fact label="Signed up"><span className="text-[13px] text-[var(--text)]">{formatDate(org?.createdAt)}<span className="block text-[12px] text-[var(--text-muted)]">{humanize(org?.signupSource)}</span></span></Fact>
          {org?.trialEndsAt && <Fact label="Trial ends"><span className="text-[13px] text-[var(--text)]">{formatDate(org.trialEndsAt)}<span className="block text-[12px] text-[var(--text-muted)]">{formatRelative(org.trialEndsAt)}</span></span></Fact>}
          <Fact label="Last activity"><span className="text-[13px] text-[var(--text)]">{formatRelative(org?.usage.lastActivityAt)}</span></Fact>
        </dl></Card>

        <Card><CardHeader title="Internal notes" description="Never shown to the tenant" /><div className="space-y-3 p-5">
          <Textarea value={notes ?? org?.internalNotes ?? ''} onChange={(e) => setNotes(e.target.value)} placeholder="Context the next person on this account will want…" rows={6} disabled={!can('orgs.update')} />
          {notes !== null && notes !== (org?.internalNotes ?? '') && <div className="flex gap-2"><Button size="sm" loading={saveNotes.isPending} onClick={() => saveNotes.mutate(notes)}>Save</Button><Button size="sm" variant="ghost" onClick={() => setNotes(null)}>Discard</Button></div>}
        </div></Card>
      </div>

      <Card><CardHeader title="Users" description="Deactivating ends that person’s sessions immediately" />
        {usersQuery.isError ? <ErrorState message={errorMessage(usersQuery.error)} onRetry={() => void usersQuery.refetch()} /> : <TableWrap><Table>
          <thead><tr><Th>Name</Th><Th>Role</Th><Th>Phone</Th><Th>Status</Th><Th>Last sign-in</Th><Th className="text-right">Action</Th></tr></thead>
          {usersQuery.isPending ? <TableSkeleton rows={5} cols={6} /> : usersQuery.data && usersQuery.data.data.length > 0 ? <tbody>{usersQuery.data.data.map((user) => <Tr key={user._id}>
            <Td><span className="font-medium text-[var(--text)]">{user.name}</span>{user.email && <span className="block text-[12px] text-[var(--text-muted)]">{user.email}</span>}</Td>
            <Td className="text-[13px] capitalize text-[var(--text)]">{user.role}</Td><Td className="tabular text-[13px] text-[var(--text-muted)]">{user.phone}</Td><Td><ActiveDot active={user.isActive} /></Td><Td className="text-[13px] text-[var(--text-muted)]">{formatRelative(user.lastLoginAt)}</Td>
            <Td className="text-right"><div className="flex justify-end gap-2">{can('users.update') && <Button size="sm" variant="outline" onClick={() => setEditUser(user)}>Edit</Button>}{can('users.deactivate') && <Button size="sm" variant={user.isActive ? 'outline' : 'primary'} loading={toggleUser.isPending && toggleUser.variables?.userId === user._id} onClick={() => toggleUser.mutate({ userId: user._id, isActive: !user.isActive })}>{user.isActive ? 'Deactivate' : 'Reactivate'}</Button>}</div></Td>
          </Tr>)}</tbody> : <tbody><tr><td colSpan={6}><EmptyState icon={<Users className="h-7 w-7" />} title="No users yet" description="This tenant has not added anyone beyond its owner." /></td></tr></tbody>}
        </Table></TableWrap>}
        {usersQuery.data && usersQuery.data.totalPages > 1 && <div className="flex items-center justify-between border-t border-[var(--border)] px-4 py-3"><p className="text-[13px] text-[var(--text-muted)]">Page {usersQuery.data.page} of {usersQuery.data.totalPages}</p><div className="flex gap-2"><Button variant="outline" size="sm" disabled={usersPage <= 1} onClick={() => setUsersPage((p) => p - 1)}>Previous</Button><Button variant="outline" size="sm" disabled={usersPage >= usersQuery.data.totalPages} onClick={() => setUsersPage((p) => p + 1)}>Next</Button></div></div>}
      </Card>

      <SuspendDialog open={suspendOpen} organizationId={id} organizationName={org?.name ?? ''} onClose={() => setSuspendOpen(false)} onSuspended={invalidateOrg} />
      {can('orgs.update') && <EditOrganizationDialog open={editOpen} organization={org ?? null} onClose={() => setEditOpen(false)} onSaved={() => { setEditOpen(false); toast.success('Organization updated'); invalidateOrg(); }} />}
      {can('users.update') && <EditUserDialog open={Boolean(editUser)} organizationId={id} user={editUser} onClose={() => setEditUser(null)} />}
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><dt className="text-[12px] uppercase tracking-wider text-[var(--text-muted)]">{label}</dt><dd className="mt-1">{children}</dd></div>;
}

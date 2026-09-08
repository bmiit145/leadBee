import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Building2, Plus, Search } from 'lucide-react';
import { platformService, queryKeys, type OrgListParams } from '@/services/platform.service';
import { errorMessage } from '@/services/api';
import { formatNumber, formatRelative } from '@/lib/utils';
import { useAuth } from '@/stores/auth.store';
import { Button } from '@/components/ui/Button';
import { PlanChip, StatusChip } from '@/components/ui/StatusChip';
import {
  Card,
  EmptyState,
  ErrorState,
  Input,
  Select,
  Table,
  TableSkeleton,
  TableWrap,
  Td,
  Th,
  Tr,
} from '@/components/ui/primitives';
import { CreateOrgDialog } from '@/components/orgs/CreateOrgDialog';
import type { OrgStatus, Plan } from '@/types';

const PAGE_SIZE = 25;

export function OrganizationsPage() {
  const { can } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [createOpen, setCreateOpen] = useState(false);

  const status = (searchParams.get('status') as OrgStatus | null) ?? undefined;
  const plan = (searchParams.get('plan') as Plan | null) ?? undefined;
  const sort = (searchParams.get('sort') as OrgListParams['sort']) ?? 'newest';
  const page = Number(searchParams.get('page') ?? 1);
  const urlSearch = searchParams.get('search') ?? '';

  // Typing is local; the URL (and therefore the query) only follows once the
  // user pauses. Without this, every keystroke is a request.
  const [searchInput, setSearchInput] = useState(urlSearch);
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchInput === urlSearch) return;
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        if (searchInput) next.set('search', searchInput);
        else next.delete('search');
        next.delete('page');
        return next;
      });
    }, 350);
    return () => clearTimeout(timer);
  }, [searchInput, urlSearch, setSearchParams]);

  const params = useMemo<OrgListParams>(
    () => ({
      page,
      limit: PAGE_SIZE,
      ...(status ? { status } : {}),
      ...(plan ? { plan } : {}),
      ...(urlSearch ? { search: urlSearch } : {}),
      sort,
    }),
    [page, status, plan, urlSearch, sort]
  );

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: queryKeys.organizations(params),
    queryFn: () => platformService.listOrganizations(params),
    // Keeps the previous page on screen while the next one loads, so paging
    // does not flash an empty table.
    placeholderData: (previous) => previous,
  });

  function setParam(key: string, value: string) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) next.set(key, value);
      else next.delete(key);
      if (key !== 'page') next.delete('page');
      return next;
    });
  }

  const totalPages = data?.totalPages ?? 1;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-[var(--text)]">Organizations</h1>
          <p className="mt-0.5 text-[13px] text-[var(--text-muted)]">
            {data ? `${formatNumber(data.total)} tenants` : 'Every tenant on the platform'}
          </p>
        </div>
        {can('orgs.create') && (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" aria-hidden />
            Provision tenant
          </Button>
        )}
      </div>

      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] p-3">
          <div className="relative min-w-[200px] flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-subtle)]"
              aria-hidden
            />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search name, handle or billing email"
              className="pl-9"
              aria-label="Search organizations"
            />
          </div>

          <Select
            value={status ?? ''}
            onChange={(e) => setParam('status', e.target.value)}
            aria-label="Filter by status"
            className="w-auto"
          >
            <option value="">All statuses</option>
            <option value="trialing">Trial</option>
            <option value="active">Active</option>
            <option value="past_due">Past due</option>
            <option value="suspended">Suspended</option>
            <option value="cancelled">Cancelled</option>
          </Select>

          <Select
            value={plan ?? ''}
            onChange={(e) => setParam('plan', e.target.value)}
            aria-label="Filter by plan"
            className="w-auto"
          >
            <option value="">All plans</option>
            <option value="trial">Trial</option>
            <option value="starter">Starter</option>
            <option value="growth">Growth</option>
            <option value="enterprise">Enterprise</option>
          </Select>

          <Select
            value={sort}
            onChange={(e) => setParam('sort', e.target.value)}
            aria-label="Sort"
            className="w-auto"
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="name">Name A–Z</option>
            <option value="users">Most users</option>
            <option value="leads">Most leads</option>
          </Select>
        </div>

        {isError ? (
          <ErrorState message={errorMessage(error)} onRetry={() => void refetch()} />
        ) : (
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>Organization</Th>
                  <Th>Status</Th>
                  <Th>Plan</Th>
                  <Th className="text-right">Users</Th>
                  <Th className="text-right">Leads</Th>
                  <Th>Last active</Th>
                  <Th>Joined</Th>
                </tr>
              </thead>

              {isPending ? (
                <TableSkeleton rows={8} cols={7} />
              ) : data && data.data.length > 0 ? (
                <tbody>
                  {data.data.map((org) => (
                    <Tr key={org._id}>
                      <Td>
                        <Link
                          to={`/organizations/${org._id}`}
                          className="block min-w-0 hover:underline"
                        >
                          <span className="block truncate font-medium text-[var(--text)]">
                            {org.name}
                          </span>
                          <span className="block truncate text-[12px] text-[var(--text-muted)]">
                            {org.slug}
                          </span>
                        </Link>
                      </Td>
                      <Td>
                        <StatusChip status={org.status} />
                      </Td>
                      <Td>
                        <PlanChip plan={org.plan} />
                      </Td>
                      <Td className="tabular text-right">
                        {formatNumber(org.usage.users)}
                        {org.limits.maxUsers !== -1 && (
                          <span className="text-[var(--text-subtle)]">
                            {' / '}
                            {org.limits.maxUsers}
                          </span>
                        )}
                      </Td>
                      <Td className="tabular text-right">{formatNumber(org.usage.leads)}</Td>
                      <Td className="text-[13px] text-[var(--text-muted)]">
                        {formatRelative(org.usage.lastActivityAt)}
                      </Td>
                      <Td className="text-[13px] text-[var(--text-muted)]">
                        {formatRelative(org.createdAt)}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              ) : (
                <tbody>
                  <tr>
                    <td colSpan={7}>
                      <EmptyState
                        icon={<Building2 className="h-7 w-7" />}
                        title="No organizations match"
                        description={
                          urlSearch || status || plan
                            ? 'Try clearing the filters above.'
                            : 'Provision the first tenant to get started.'
                        }
                      />
                    </td>
                  </tr>
                </tbody>
              )}
            </Table>
          </TableWrap>
        )}

        {data && totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-[var(--border)] px-4 py-3">
            <p className="text-[13px] text-[var(--text-muted)]">
              Page {data.page} of {totalPages}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={data.page <= 1}
                onClick={() => setParam('page', String(data.page - 1))}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={data.page >= totalPages}
                onClick={() => setParam('page', String(data.page + 1))}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </Card>

      <CreateOrgDialog open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}

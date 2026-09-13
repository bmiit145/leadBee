import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Search, UserRound } from 'lucide-react';
import { platformService, queryKeys, type AccountListParams } from '@/services/platform.service';
import { errorMessage } from '@/services/api';
import { cn, formatDateTime, formatNumber, formatRelative } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import {
  Card,
  EmptyState,
  ErrorState,
  Input,
  Select,
  StatTile,
  Table,
  TableSkeleton,
  TableWrap,
  Td,
  Th,
  Tr,
} from '@/components/ui/primitives';
import { AccountStatusChip, VerificationChip } from '@/components/accounts/AccountChips';
import type { AccountStatus, AccountVerificationFilter } from '@/types';

const PAGE_SIZE = 25;
const COLUMNS = 5;

/**
 * Everyone who has registered in the app — before, and whether or not, they
 * belong to an organization.
 *
 * Filters live in the URL, like the organizations list, so a filtered view can
 * be shared with a colleague and survives a reload.
 */
export function AccountsPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  const status = (searchParams.get('status') as AccountStatus | null) ?? undefined;
  const verification =
    (searchParams.get('verification') as AccountVerificationFilter | null) ?? undefined;
  const sort = (searchParams.get('sort') as AccountListParams['sort']) ?? 'newest';
  const page = Number(searchParams.get('page') ?? 1);
  const urlSearch = searchParams.get('search') ?? '';

  // Typing is local; the URL follows once the user pauses.
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

  const params = useMemo<AccountListParams>(
    () => ({
      page,
      limit: PAGE_SIZE,
      ...(status ? { status } : {}),
      ...(verification ? { verification } : {}),
      ...(urlSearch ? { search: urlSearch } : {}),
      sort,
    }),
    [page, status, verification, urlSearch, sort]
  );

  const list = useQuery({
    queryKey: queryKeys.accounts(params),
    queryFn: () => platformService.listAccounts(params),
    placeholderData: (previous) => previous,
  });

  const stats = useQuery({
    queryKey: queryKeys.accountStats,
    queryFn: () => platformService.accountStats(),
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

  const filtered = Boolean(urlSearch || status || verification);
  const data = list.data;
  const totalPages = data?.totalPages ?? 1;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-[var(--text)]">Accounts</h1>
        <p className="mt-0.5 text-[13px] text-[var(--text-muted)]">
          People who registered in the app, whether or not they have joined an organization.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Registered"
          value={formatNumber(stats.data?.total)}
          sub={stats.data ? `${formatNumber(stats.data.last30Days)} in the last 30 days` : undefined}
          loading={stats.isPending}
        />
        <FilterTile
          active={verification === 'unverified'}
          onClick={() =>
            setParam('verification', verification === 'unverified' ? '' : 'unverified')
          }
        >
          <StatTile
            label="Unverified"
            value={formatNumber(stats.data?.unverified)}
            sub="Email not confirmed yet"
            loading={stats.isPending}
          />
        </FilterTile>
        <FilterTile
          active={status === 'suspended'}
          onClick={() => setParam('status', status === 'suspended' ? '' : 'suspended')}
        >
          <StatTile
            label="Suspended"
            value={formatNumber(stats.data?.suspended)}
            sub="Blocked by the platform"
            loading={stats.isPending}
          />
        </FilterTile>
        <StatTile
          label="New this week"
          value={formatNumber(stats.data?.last7Days)}
          sub="Registered in the last 7 days"
          loading={stats.isPending}
        />
      </div>
      {stats.isError && (
        <p className="text-[12px] text-[var(--danger)]">
          Totals could not load: {errorMessage(stats.error)}
        </p>
      )}

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
              placeholder="Search name, email or mobile"
              className="pl-9"
              aria-label="Search accounts"
            />
          </div>

          <Select
            value={status ?? ''}
            onChange={(e) => setParam('status', e.target.value)}
            aria-label="Filter by status"
            className="w-auto"
          >
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
          </Select>

          <Select
            value={verification ?? ''}
            onChange={(e) => setParam('verification', e.target.value)}
            aria-label="Filter by email verification"
            className="w-auto"
          >
            <option value="">Any verification</option>
            <option value="verified">Verified</option>
            <option value="unverified">Unverified</option>
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
          </Select>
        </div>

        {list.isError ? (
          <ErrorState message={errorMessage(list.error)} onRetry={() => void list.refetch()} />
        ) : (
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>Person</Th>
                  <Th>Mobile</Th>
                  <Th>Email</Th>
                  <Th>Status</Th>
                  <Th>Registered</Th>
                </tr>
              </thead>

              {list.isPending ? (
                <TableSkeleton rows={8} cols={COLUMNS} />
              ) : data && data.data.length > 0 ? (
                <tbody>
                  {data.data.map((account) => (
                    <Tr key={account._id}>
                      <Td>
                        <Link to={`/accounts/${account._id}`} className="block min-w-0 hover:underline">
                          <span className="block truncate font-medium text-[var(--text)]">
                            {account.name}
                          </span>
                          <span className="block truncate text-[12px] text-[var(--text-muted)]">
                            {account.email}
                          </span>
                        </Link>
                      </Td>
                      <Td className="tabular text-[13px] text-[var(--text-muted)]">
                        {account.phone}
                      </Td>
                      <Td>
                        <VerificationChip verifiedAt={account.emailVerifiedAt} />
                      </Td>
                      <Td>
                        <AccountStatusChip status={account.status} />
                      </Td>
                      <Td
                        className="whitespace-nowrap text-[13px] text-[var(--text-muted)]"
                        title={formatDateTime(account.createdAt)}
                      >
                        {formatRelative(account.createdAt)}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              ) : (
                <tbody>
                  <tr>
                    <td colSpan={COLUMNS}>
                      <EmptyState
                        icon={<UserRound className="h-7 w-7" />}
                        title={filtered ? 'No accounts match' : 'No one has registered yet'}
                        description={
                          filtered
                            ? 'Try clearing the filters above.'
                            : 'People who create an account in the mobile app appear here.'
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
              Page {data.page} of {totalPages} · {formatNumber(data.total)} accounts
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
    </div>
  );
}

/** A stat tile that doubles as a toggle for the filter it counts. */
function FilterTile({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'rounded-xl text-left transition-shadow',
        active ? 'ring-2 ring-[var(--text)]' : 'hover:ring-1 hover:ring-[var(--border-strong)]'
      )}
    >
      {children}
    </button>
  );
}

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Ban, CheckCircle2, Eye, MailCheck, Search, Trash2, UserRound } from 'lucide-react';
import { platformService, queryKeys, type AccountListParams } from '@/services/platform.service';
import { errorMessage } from '@/services/api';
import { cn, formatDateTime, formatNumber, formatRelative } from '@/lib/utils';
import { useAuth } from '@/stores/auth.store';
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
import { RowActionsMenu, type RowAction } from '@/components/ui/RowActionsMenu';
import { AccountStatusChip, VerificationChip } from '@/components/accounts/AccountChips';
import { AccountActionDialog } from '@/components/accounts/AccountActionDialog';
import type { Account, AccountDetail, AccountStatus, AccountVerificationFilter } from '@/types';

const PAGE_SIZE = 25;
/** Person, mobile, organizations, email, status, registered, and the row menu. */
const COLUMNS = 7;

/** An action that needs confirmation before it runs. */
type PendingDialog = { kind: 'suspend' | 'verify' | 'delete'; account: Account };

/**
 * Everyone who has registered in the app or belongs to an organization.
 *
 * Filters live in the URL, like the organizations list, so a filtered view can
 * be shared with a colleague and survives a reload. Per-row actions sit behind
 * one "⋮" menu, which offers only what the signed-in admin may do and what
 * applies to that person.
 */
export function AccountsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const canManage = can('accounts.manage');
  const canDelete = can('accounts.delete');
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<PendingDialog | null>(null);

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

  // ─── Actions ────────────────────────────────────────────────────────────────

  /** A write returned fresh detail: keep the detail page warm and refresh the lists. */
  function applyChange(detail?: AccountDetail) {
    if (detail) queryClient.setQueryData(queryKeys.account(detail._id), detail);
    void queryClient.invalidateQueries({ queryKey: ['platform', 'accounts'] });
    void queryClient.invalidateQueries({ queryKey: ['platform', 'audit'] });
  }

  const setStatus = useMutation({
    mutationFn: ({ id, next, reason }: { id: string; next: AccountStatus; reason?: string }) =>
      platformService.setAccountStatus(id, next, reason),
    onSuccess: (detail) => {
      setDialog(null);
      applyChange(detail);
      toast.success(
        detail.status === 'suspended' ? `${detail.name} suspended` : `${detail.name} reactivated`
      );
    },
    onError: (error) => toast.error(errorMessage(error, 'Could not change the account status')),
  });

  const verifyEmail = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      platformService.verifyAccountEmail(id, reason),
    onSuccess: (detail) => {
      setDialog(null);
      applyChange(detail);
      toast.success(`${detail.name}’s email marked as verified`);
    },
    onError: (error) => toast.error(errorMessage(error, 'Could not verify the email')),
  });

  const deleteAccount = useMutation({
    mutationFn: ({ id, reason, confirmEmail }: { id: string; reason: string; confirmEmail: string }) =>
      platformService.deleteAccount(id, reason, confirmEmail),
    onSuccess: (_result, variables) => {
      setDialog(null);
      queryClient.removeQueries({ queryKey: queryKeys.account(variables.id) });
      applyChange();
      toast.success('Account deleted');
    },
    onError: (error) => toast.error(errorMessage(error, 'Could not delete the account')),
  });

  function actionsFor(account: Account): RowAction[] {
    const inOrganizations = (account.organizations?.count ?? 0) > 0;
    const actions: RowAction[] = [
      {
        key: 'view',
        label: 'View details',
        icon: <Eye className="h-4 w-4" />,
        onSelect: () => navigate(`/accounts/${account._id}`),
      },
    ];

    if (canManage && !account.emailVerifiedAt) {
      actions.push({
        key: 'verify',
        label: 'Mark email verified',
        icon: <MailCheck className="h-4 w-4" />,
        onSelect: () => setDialog({ kind: 'verify', account }),
      });
    }

    if (canManage) {
      actions.push(
        account.status === 'suspended'
          ? {
              key: 'reactivate',
              label: 'Reactivate',
              icon: <CheckCircle2 className="h-4 w-4" />,
              onSelect: () => setStatus.mutate({ id: account._id, next: 'active' }),
            }
          : {
              key: 'suspend',
              label: 'Suspend',
              icon: <Ban className="h-4 w-4" />,
              tone: 'danger',
              onSelect: () => setDialog({ kind: 'suspend', account }),
            }
      );
    }

    if (canDelete) {
      actions.push({
        key: 'delete',
        label: 'Delete account',
        icon: <Trash2 className="h-4 w-4" />,
        tone: 'danger',
        separated: true,
        // The API refuses too; saying so here spares typing a reason first.
        disabled: inOrganizations,
        hint: inOrganizations ? 'Remove them from their organizations first' : undefined,
        onSelect: () => setDialog({ kind: 'delete', account }),
      });
    }

    return actions;
  }

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
  const target = dialog?.account;

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
          sub={
            stats.data
              ? `${formatNumber(stats.data.inOrganizations)} in an organization · ${formatNumber(stats.data.last30Days)} in 30 days`
              : undefined
          }
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
                  <Th>Organizations</Th>
                  <Th>Email</Th>
                  <Th>Status</Th>
                  <Th>Registered</Th>
                  <Th className="w-12">
                    <span className="sr-only">Actions</span>
                  </Th>
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
                      <Td className="max-w-[220px] text-[13px]">
                        <OrganizationsCell organizations={account.organizations} />
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
                      <Td className="w-12 text-right">
                        <RowActionsMenu
                          label={`Actions for ${account.name}`}
                          actions={actionsFor(account)}
                        />
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

      {/* ─── Confirmations ─────────────────────────────────────────────────── */}
      <AccountActionDialog
        open={dialog?.kind === 'suspend'}
        tone="danger"
        title={`Suspend ${target?.name ?? 'this account'}?`}
        description="They are signed out of every organization they belong to and cannot sign in until you reactivate them. Nothing is deleted."
        confirmLabel="Suspend"
        reasonRequired
        reasonPlaceholder="Reported for misuse…"
        loading={setStatus.isPending}
        onClose={() => setDialog(null)}
        onConfirm={(reason) => {
          if (target) setStatus.mutate({ id: target._id, next: 'suspended', reason });
        }}
      />
      <AccountActionDialog
        open={dialog?.kind === 'verify'}
        tone="primary"
        title="Mark this email as verified?"
        description={`This confirms the details on the account without a code. Only do it once you have established another way that this person owns ${target?.email ?? 'this address'}.`}
        confirmLabel="Mark verified"
        reasonRequired
        reasonPlaceholder="Confirmed on a call with the customer…"
        loading={verifyEmail.isPending}
        onClose={() => setDialog(null)}
        onConfirm={(reason) => {
          if (target) verifyEmail.mutate({ id: target._id, reason });
        }}
      />
      <AccountActionDialog
        open={dialog?.kind === 'delete'}
        tone="danger"
        title="Delete this account permanently?"
        description="The account and its details are erased and cannot be recovered. The audit log keeps only the email's domain."
        confirmLabel="Delete account"
        reasonRequired
        reasonPlaceholder="Erasure requested by the account holder…"
        typeToConfirm={target?.email}
        loading={deleteAccount.isPending}
        onClose={() => setDialog(null)}
        onConfirm={(reason, confirmation) => {
          if (target) deleteAccount.mutate({ id: target._id, reason, confirmEmail: confirmation });
        }}
      />
    </div>
  );
}

/** First few organization names, and how many more there are. */
function OrganizationsCell({
  organizations,
}: {
  organizations?: { count: number; names: string[] };
}) {
  if (!organizations || organizations.count === 0) {
    return <span className="text-[var(--text-subtle)]">None yet</span>;
  }
  const hidden = organizations.count - organizations.names.length;
  const label = organizations.names.join(', ');
  return (
    <span className="block truncate text-[var(--text)]" title={label}>
      {label}
      {hidden > 0 && <span className="text-[var(--text-muted)]"> +{hidden}</span>}
    </span>
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

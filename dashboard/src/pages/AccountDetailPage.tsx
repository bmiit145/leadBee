import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ArrowLeft,
  Ban,
  Building2,
  CheckCircle2,
  History,
  MailCheck,
  Trash2,
} from 'lucide-react';
import { platformService, queryKeys } from '@/services/platform.service';
import { errorMessage } from '@/services/api';
import { formatDateTime, formatRelative, humanize } from '@/lib/utils';
import { useAuth } from '@/stores/auth.store';
import { Button } from '@/components/ui/Button';
import {
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  Skeleton,
  Table,
  TableWrap,
  Td,
  Textarea,
  Th,
  Tr,
} from '@/components/ui/primitives';
import { AccountStatusChip, VerificationChip } from '@/components/accounts/AccountChips';
import { ActiveDot, StatusChip } from '@/components/ui/StatusChip';
import { AccountActionDialog } from '@/components/accounts/AccountActionDialog';
import type { AccountDetail, AccountStatus } from '@/types';

/** Shown beside times so an operator knows which clock they are reading (DASH-14). */
const TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

type PendingAction = 'suspend' | 'verify' | 'delete';

export function AccountDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [action, setAction] = useState<PendingAction | null>(null);
  const [notes, setNotes] = useState<string | null>(null);

  const accountQuery = useQuery({
    queryKey: queryKeys.account(id),
    queryFn: () => platformService.getAccount(id),
    enabled: Boolean(id),
  });

  function refreshLists() {
    void queryClient.invalidateQueries({ queryKey: ['platform', 'accounts'] });
    void queryClient.invalidateQueries({ queryKey: ['platform', 'audit'] });
  }

  /** Every write returns the fresh detail, so the page updates without a refetch. */
  function applyDetail(detail: AccountDetail) {
    queryClient.setQueryData(queryKeys.account(id), detail);
    refreshLists();
  }

  const setStatus = useMutation({
    mutationFn: ({ status, reason }: { status: AccountStatus; reason?: string }) =>
      platformService.setAccountStatus(id, status, reason),
    onSuccess: (detail) => {
      applyDetail(detail);
      setAction(null);
      toast.success(
        detail.status === 'suspended' ? `${detail.name} suspended` : `${detail.name} reactivated`
      );
    },
    onError: (error) => toast.error(errorMessage(error, 'Could not change the account status')),
  });

  const verifyEmail = useMutation({
    mutationFn: (reason: string) => platformService.verifyAccountEmail(id, reason),
    onSuccess: (detail) => {
      applyDetail(detail);
      setAction(null);
      toast.success('Email marked as verified');
    },
    onError: (error) => toast.error(errorMessage(error, 'Could not verify the email')),
  });

  const saveNotes = useMutation({
    mutationFn: (value: string) => platformService.setAccountNotes(id, value),
    onSuccess: (detail) => {
      queryClient.setQueryData(queryKeys.account(id), detail);
      setNotes(null);
      toast.success('Notes saved');
    },
    onError: (error) => toast.error(errorMessage(error, 'Could not save notes')),
  });

  const deleteAccount = useMutation({
    mutationFn: ({ reason, confirmEmail }: { reason: string; confirmEmail: string }) =>
      platformService.deleteAccount(id, reason, confirmEmail),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: queryKeys.account(id) });
      refreshLists();
      toast.success('Account deleted');
      navigate('/accounts', { replace: true });
    },
    onError: (error) => toast.error(errorMessage(error, 'Could not delete the account')),
  });

  if (accountQuery.isError) {
    return (
      <div className="space-y-5">
        <BackLink />
        <Card>
          <ErrorState
            message={errorMessage(accountQuery.error)}
            onRetry={() => void accountQuery.refetch()}
          />
        </Card>
      </div>
    );
  }

  const account = accountQuery.data;
  const suspended = account?.status === 'suspended';
  const canManage = can('accounts.manage');
  const pending = account?.pendingVerification;

  return (
    <div className="space-y-5">
      <BackLink />

      {/* ─── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          {!account ? (
            <>
              <Skeleton className="h-7 w-56" />
              <Skeleton className="mt-2 h-4 w-40" />
            </>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="text-xl font-semibold text-[var(--text)]">{account.name}</h1>
                <AccountStatusChip status={account.status} />
                <VerificationChip verifiedAt={account.emailVerifiedAt} />
              </div>
              <p className="mt-0.5 break-all font-mono text-[13px] text-[var(--text-muted)]">
                {account.email}
              </p>
            </>
          )}
        </div>

        {account && (
          <div className="flex flex-wrap gap-2">
            {canManage && !account.emailVerifiedAt && (
              <Button variant="outline" onClick={() => setAction('verify')}>
                <MailCheck className="h-4 w-4" aria-hidden />
                Mark verified
              </Button>
            )}
            {canManage &&
              (suspended ? (
                <Button
                  onClick={() => setStatus.mutate({ status: 'active' })}
                  loading={setStatus.isPending}
                >
                  <CheckCircle2 className="h-4 w-4" aria-hidden />
                  Reactivate
                </Button>
              ) : (
                <Button variant="danger" onClick={() => setAction('suspend')}>
                  <Ban className="h-4 w-4" aria-hidden />
                  Suspend
                </Button>
              ))}
            {can('accounts.delete') && (
              <Button
                variant="ghost"
                onClick={() => setAction('delete')}
                // The API refuses too; disabling says why before anyone types a reason.
                disabled={account.memberships.length > 0}
                title={
                  account.memberships.length > 0
                    ? 'Remove this person from their organizations before deleting the account'
                    : undefined
                }
              >
                <Trash2 className="h-4 w-4" aria-hidden />
                Delete
              </Button>
            )}
          </div>
        )}
      </div>

      {suspended && account && (
        <Card className="border-[var(--danger-border)] bg-[var(--danger-surface)] px-5 py-3.5">
          <p className="text-[13px] text-[var(--text)]">
            <span className="font-semibold text-[var(--danger)]">Suspended</span>
            {account.suspendedAt && ` on ${formatDateTime(account.suspendedAt)}`}
            {account.suspendedBy && ` by ${account.suspendedBy.name}`}
            {account.suspendedReason && ` — ${account.suspendedReason}`}
          </p>
        </Card>
      )}

      {/* ─── Facts ──────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Profile" description={`Times shown in ${TIME_ZONE}`} />
          {!account ? (
            <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2">
              {Array.from({ length: 6 }).map((_, index) => (
                <Skeleton key={index} className="h-10" />
              ))}
            </div>
          ) : (
            <dl className="grid grid-cols-1 gap-x-6 gap-y-4 p-5 sm:grid-cols-2">
              <Fact label="Name">
                <span className="text-[13px] text-[var(--text)]">
                  {account.firstName} {account.lastName}
                </span>
              </Fact>

              <Fact label="Mobile">
                <span className="tabular text-[13px] text-[var(--text)]">{account.phone}</span>
              </Fact>

              <Fact label="Email">
                <span className="block break-all text-[13px] text-[var(--text)]">
                  {account.email}
                </span>
                <span className="block text-[12px] text-[var(--text-muted)]">
                  {account.emailVerifiedAt
                    ? `Verified ${formatDateTime(account.emailVerifiedAt)} · ${
                        account.emailVerifiedVia === 'platform_admin' ? 'by support' : 'by code'
                      }`
                    : 'Not verified yet'}
                </span>
              </Fact>

              <Fact label="Registered">
                <span className="text-[13px] text-[var(--text)]">
                  {formatDateTime(account.createdAt)}
                  <span className="block text-[12px] text-[var(--text-muted)]">
                    {formatRelative(account.createdAt)}
                  </span>
                </span>
              </Fact>

              <Fact label="Last sign-in">
                <span className="text-[13px] text-[var(--text)]">
                  {account.lastLoginAt ? formatDateTime(account.lastLoginAt) : 'Never'}
                  {account.lastLoginAt && (
                    <span className="block text-[12px] text-[var(--text-muted)]">
                      {formatRelative(account.lastLoginAt)}
                    </span>
                  )}
                </span>
              </Fact>

              <Fact label="Created by">
                <span className="text-[13px] text-[var(--text)]">
                  {account.source === 'registration'
                    ? 'Self-registration'
                    : account.source === 'organization'
                      ? 'An organization added them'
                      : 'Migrated from an existing member'}
                </span>
              </Fact>

              <Fact label="Terms accepted">
                <span className="text-[13px] text-[var(--text)]">
                  {formatDateTime(account.acceptedTermsAt)}
                </span>
              </Fact>

              <Fact label="Signed up from">
                <span className="block text-[13px] text-[var(--text)]">
                  {account.signupIp ?? '—'}
                </span>
                {account.signupUserAgent && (
                  <span
                    className="block truncate text-[12px] text-[var(--text-muted)]"
                    title={account.signupUserAgent}
                  >
                    {account.signupUserAgent}
                  </span>
                )}
              </Fact>

              {pending && (
                <Fact label="Verification code">
                  <span className="text-[13px] text-[var(--text)]">
                    Sent {formatRelative(pending.sentAt)} · {pending.attempts} of{' '}
                    {pending.maxAttempts} guesses used
                    <span className="block text-[12px] text-[var(--text-muted)]">
                      {pending.expired
                        ? 'Expired — the person must register again'
                        : `Expires ${formatRelative(pending.expiresAt)}`}
                    </span>
                  </span>
                </Fact>
              )}
            </dl>
          )}
        </Card>

        <Card>
          <CardHeader title="Internal notes" description="Never shown to the account holder" />
          <div className="space-y-3 p-5">
            <Textarea
              value={notes ?? account?.internalNotes ?? ''}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Context the next person looking at this account will want…"
              rows={6}
              maxLength={5000}
              disabled={!canManage || !account}
            />
            {notes !== null && notes !== (account?.internalNotes ?? '') && (
              <div className="flex gap-2">
                <Button size="sm" loading={saveNotes.isPending} onClick={() => saveNotes.mutate(notes)}>
                  Save
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setNotes(null)}>
                  Discard
                </Button>
              </div>
            )}
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Organizations"
          description="One sign-in for all of them. Role and active state are per organization."
        />
        {!account ? (
          <div className="space-y-2 p-5">
            <Skeleton className="h-4" />
            <Skeleton className="h-4" />
          </div>
        ) : account.memberships.length === 0 ? (
          <EmptyState
            icon={<Building2 className="h-7 w-7" />}
            title="Not a member of any organization"
            description="Joining an existing organization or creating one comes after registration. That step is not built yet, so this person cannot sign in to any workspace."
          />
        ) : (
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>Organization</Th>
                  <Th>Role</Th>
                  <Th>In this organization</Th>
                  <Th>Last sign-in</Th>
                  <Th>Joined</Th>
                </tr>
              </thead>
              <tbody>
                {account.memberships.map((membership) => (
                  <Tr key={membership._id}>
                    <Td>
                      {membership.organization ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <Link
                            to={`/organizations/${membership.organization._id}`}
                            className="font-medium text-[var(--text)] hover:underline"
                          >
                            {membership.organization.name}
                          </Link>
                          <StatusChip status={membership.organization.status} />
                        </div>
                      ) : (
                        <span className="text-[13px] text-[var(--text-subtle)]">
                          Organization no longer exists
                        </span>
                      )}
                    </Td>
                    <Td className="text-[13px] capitalize text-[var(--text)]">{membership.role}</Td>
                    <Td>
                      <ActiveDot active={membership.isActive} />
                    </Td>
                    <Td className="text-[13px] text-[var(--text-muted)]">
                      {formatRelative(membership.lastLoginAt)}
                    </Td>
                    <Td className="text-[13px] text-[var(--text-muted)]">
                      {formatDateTime(membership.joinedAt)}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Admin activity"
          description="Every action taken on this account from the console"
        />
        {!account ? (
          <div className="space-y-2 p-5">
            <Skeleton className="h-4" />
            <Skeleton className="h-4" />
          </div>
        ) : account.activity.length === 0 ? (
          <EmptyState
            icon={<History className="h-7 w-7" />}
            title="No admin actions yet"
            description="Suspensions, manual verifications and deletions appear here."
          />
        ) : (
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>When</Th>
                  <Th>Action</Th>
                  <Th>Admin</Th>
                  <Th>Reason</Th>
                </tr>
              </thead>
              <tbody>
                {account.activity.map((entry) => (
                  <Tr key={entry._id}>
                    <Td className="whitespace-nowrap text-[13px] text-[var(--text-muted)]">
                      {formatDateTime(entry.createdAt)}
                    </Td>
                    <Td className="text-[13px] text-[var(--text)]">{humanize(entry.action)}</Td>
                    <Td className="text-[13px] text-[var(--text-muted)]">{entry.adminEmail}</Td>
                    <Td className="max-w-xs text-[13px] text-[var(--text)]">
                      <span className="block truncate" title={entry.reason ?? undefined}>
                        {entry.reason ?? '—'}
                      </span>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        )}
      </Card>

      {account && (
        <>
          <AccountActionDialog
            open={action === 'suspend'}
            tone="danger"
            title="Suspend this account?"
            description="They are signed out of every organization they belong to and cannot sign in, and any outstanding verification code stops working. Nothing is deleted, and you can reactivate at any time."
            confirmLabel="Suspend"
            reasonRequired
            reasonPlaceholder="Registered with a disposable address…"
            loading={setStatus.isPending}
            onClose={() => setAction(null)}
            onConfirm={(reason) => setStatus.mutate({ status: 'suspended', reason })}
          />
          <AccountActionDialog
            open={action === 'verify'}
            tone="primary"
            title="Mark this email as verified?"
            description={`This confirms the details on the account without a code. Only do it once you have established another way that this person owns ${account.email}.`}
            confirmLabel="Mark verified"
            reasonRequired
            reasonPlaceholder="Confirmed on a call with the customer…"
            loading={verifyEmail.isPending}
            onClose={() => setAction(null)}
            onConfirm={(reason) => verifyEmail.mutate(reason)}
          />
          <AccountActionDialog
            open={action === 'delete'}
            tone="danger"
            title="Delete this account permanently?"
            description="The account and its details are erased and cannot be recovered. The audit log keeps only the email's domain."
            confirmLabel="Delete account"
            reasonRequired
            reasonPlaceholder="Erasure requested by the account holder…"
            typeToConfirm={account.email}
            loading={deleteAccount.isPending}
            onClose={() => setAction(null)}
            onConfirm={(reason, confirmation) =>
              deleteAccount.mutate({ reason, confirmEmail: confirmation })
            }
          />
        </>
      )}
    </div>
  );
}

function BackLink() {
  return (
    <Link
      to="/accounts"
      className="inline-flex items-center gap-1.5 text-[13px] text-[var(--text-muted)] hover:text-[var(--text)]"
    >
      <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
      Accounts
    </Link>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[12px] uppercase tracking-wider text-[var(--text-muted)]">{label}</dt>
      <dd className="mt-1">{children}</dd>
    </div>
  );
}

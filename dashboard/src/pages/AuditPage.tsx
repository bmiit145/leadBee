import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ScrollText } from 'lucide-react';
import { platformService, queryKeys } from '@/services/platform.service';
import { errorMessage } from '@/services/api';
import { formatDateTime, humanize } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import {
  Card,
  EmptyState,
  ErrorState,
  Table,
  TableSkeleton,
  TableWrap,
  Td,
  Th,
  Tr,
} from '@/components/ui/primitives';

export function AuditPage() {
  const [page, setPage] = useState(1);
  const params = { page, limit: 40 };

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: queryKeys.audit(params),
    queryFn: () => platformService.auditLog(params),
    placeholderData: (previous) => previous,
  });

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-[var(--text)]">Audit log</h1>
        <p className="mt-0.5 text-[13px] text-[var(--text-muted)]">
          Every action taken from this console, across all tenants.
        </p>
      </div>

      <Card>
        {isError ? (
          <ErrorState message={errorMessage(error)} onRetry={() => void refetch()} />
        ) : (
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>When</Th>
                  <Th>Action</Th>
                  <Th>Organization</Th>
                  <Th>Admin</Th>
                  <Th>Detail</Th>
                </tr>
              </thead>

              {isPending ? (
                <TableSkeleton rows={10} cols={5} />
              ) : data && data.data.length > 0 ? (
                <tbody>
                  {data.data.map((entry) => (
                    <Tr key={entry._id}>
                      <Td className="whitespace-nowrap text-[13px] text-[var(--text-muted)]">
                        {formatDateTime(entry.createdAt)}
                      </Td>
                      <Td>
                        <span className="font-mono text-[12px] text-[var(--text)]">
                          {entry.action}
                        </span>
                      </Td>
                      <Td>
                        {entry.organizationId ? (
                          <Link
                            to={`/organizations/${entry.organizationId}`}
                            className="text-[13px] text-[var(--text)] hover:underline"
                          >
                            {entry.organizationName ?? entry.organizationId}
                          </Link>
                        ) : (
                          <span className="text-[13px] text-[var(--text-subtle)]">—</span>
                        )}
                      </Td>
                      <Td className="text-[13px] text-[var(--text-muted)]">
                        {entry.adminEmail}
                      </Td>
                      <Td className="max-w-xs">
                        {entry.reason ? (
                          <span className="block truncate text-[13px] text-[var(--text)]">
                            {entry.reason}
                          </span>
                        ) : entry.after ? (
                          <span className="block truncate font-mono text-[12px] text-[var(--text-muted)]">
                            {Object.entries(entry.after)
                              .map(([key, value]) => `${key}: ${humanize(String(value))}`)
                              .join(', ')}
                          </span>
                        ) : (
                          <span className="text-[13px] text-[var(--text-subtle)]">—</span>
                        )}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              ) : (
                <tbody>
                  <tr>
                    <td colSpan={5}>
                      <EmptyState
                        icon={<ScrollText className="h-7 w-7" />}
                        title="Nothing recorded yet"
                        description="Provisioning, suspensions and plan changes appear here."
                      />
                    </td>
                  </tr>
                </tbody>
              )}
            </Table>
          </TableWrap>
        )}

        {data && data.totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-[var(--border)] px-4 py-3">
            <p className="text-[13px] text-[var(--text-muted)]">
              Page {data.page} of {data.totalPages}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= data.totalPages}
                onClick={() => setPage((p) => p + 1)}
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

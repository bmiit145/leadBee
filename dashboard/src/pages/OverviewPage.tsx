import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowRight } from 'lucide-react';
import { platformService, queryKeys } from '@/services/platform.service';
import { errorMessage } from '@/services/api';
import { formatCompact, formatNumber, humanize } from '@/lib/utils';
import {
  Card,
  CardHeader,
  ErrorState,
  StatTile,
  Skeleton,
} from '@/components/ui/primitives';

export function OverviewPage() {
  const {
    data: metrics,
    isPending,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: queryKeys.metrics,
    queryFn: () => platformService.metrics(),
    // These are estate-wide aggregations; a minute of staleness is invisible to
    // an operator and saves recomputing them on every navigation.
    staleTime: 60_000,
  });

  if (isError) {
    return <ErrorState message={errorMessage(error)} onRetry={() => void refetch()} />;
  }

  const statusRows = Object.entries(metrics?.byStatus ?? {}).sort(
    ([, a], [, b]) => b - a
  );
  const planRows = Object.entries(metrics?.byPlan ?? {}).sort(([, a], [, b]) => b - a);
  const maxStatus = Math.max(1, ...statusRows.map(([, count]) => count));
  const maxPlan = Math.max(1, ...planRows.map(([, count]) => count));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-[var(--text)]">Overview</h1>
        <p className="mt-0.5 text-[13px] text-[var(--text-muted)]">
          Every tenant on the platform, at a glance.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Organizations"
          value={formatNumber(metrics?.totals.organizations)}
          sub={`${formatNumber(metrics?.recentSignups)} joined in 30 days`}
          loading={isPending}
        />
        <StatTile
          label="Users"
          value={formatCompact(metrics?.totals.users)}
          sub="Across all tenants"
          loading={isPending}
        />
        <StatTile
          label="Leads"
          value={formatCompact(metrics?.totals.leads)}
          sub="Across all tenants"
          loading={isPending}
        />
        <StatTile
          label="Trials expiring"
          value={formatNumber(metrics?.expiringTrials)}
          sub="Within the next 7 days"
          loading={isPending}
        />
      </div>

      {/* A trial about to lapse is the one number here that needs someone to act,
          so it gets a call-out rather than sitting in a tile like the rest. */}
      {!isPending && (metrics?.expiringTrials ?? 0) > 0 && (
        <Card className="flex items-center gap-3 border-[var(--danger-border)] bg-[var(--danger-surface)] px-5 py-3.5">
          <AlertTriangle className="h-4 w-4 shrink-0 text-[var(--danger)]" aria-hidden />
          <p className="flex-1 text-[13px] text-[var(--text)]">
            <span className="font-semibold">{metrics?.expiringTrials}</span>{' '}
            {metrics?.expiringTrials === 1 ? 'trial expires' : 'trials expire'} within
            seven days.
          </p>
          <Link
            to="/organizations?status=trialing"
            className="flex items-center gap-1 text-[13px] font-medium text-[var(--text)] underline underline-offset-4"
          >
            Review <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="By status" description="Where tenants sit in their lifecycle" />
          <div className="space-y-3 p-5">
            {isPending
              ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-6" />)
              : statusRows.map(([status, count]) => (
                  <BarRow
                    key={status}
                    label={humanize(status)}
                    count={count}
                    max={maxStatus}
                  />
                ))}
          </div>
        </Card>

        <Card>
          <CardHeader title="By plan" description="Distribution across pricing tiers" />
          <div className="space-y-3 p-5">
            {isPending
              ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-6" />)
              : planRows.map(([plan, count]) => (
                  <BarRow key={plan} label={humanize(plan)} count={count} max={maxPlan} />
                ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

/**
 * A labelled bar.
 *
 * Bars are greyscale and distinguished by length alone — with four or five
 * categories, length is a more precise encoding than colour anyway, and it
 * keeps the page consistent with the rest of the system.
 */
function BarRow({ label, count, max }: { label: string; count: number; max: number }) {
  const pct = Math.max(2, Math.round((count / max) * 100));
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-[13px] text-[var(--text)]">{label}</span>
        <span className="tabular text-[13px] font-medium text-[var(--text)]">
          {formatNumber(count)}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--border)]">
        <div className="h-full rounded-full bg-[var(--text)]" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

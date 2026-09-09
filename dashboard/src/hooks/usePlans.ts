import { useQuery } from '@tanstack/react-query';
import { platformService, queryKeys } from '@/services/platform.service';
import type { PlanSummary } from '@/types';

/**
 * The plan catalogue, for every selector that used to hardcode four options.
 *
 * Cached for the session: the catalogue changes when an operator edits it, and
 * the mutations that do so invalidate this key. Selectors should not each hold
 * their own copy.
 */
export function usePlans() {
  const query = useQuery({
    queryKey: queryKeys.plans(),
    queryFn: () => platformService.listPlans(),
    staleTime: 5 * 60 * 1000,
  });

  return {
    plans: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
  };
}

/**
 * Plans an operator may assign right now.
 *
 * `grandfathered` and `retired` versions stay honoured for tenants already on
 * them, but must not appear in a picker — offering one would sell a plan that
 * has been withdrawn.
 */
export function useAssignablePlans() {
  const { plans, isLoading, error } = usePlans();
  return {
    plans: plans.filter((p) => p.status === 'active' || p.status === 'draft'),
    isLoading,
    error,
  };
}

/** Label for a plan key, falling back to the raw key for anything unknown. */
export function planLabel(plans: PlanSummary[], key: string): string {
  return plans.find((p) => p.key === key)?.name ?? key;
}

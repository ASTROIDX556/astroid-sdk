import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { queryKeys, useAstroidClient } from '../hooks.js';
import type { BudgetAlert, ListBudgetAlertsParams, Paginated } from '@astroid/types';

/** Centralized query key factory for budget alerts. */
export const budgetAlertKeys = {
  all: (budgetId: string) => ['astroid', 'budgets', budgetId, 'alerts'] as const,
  list: (budgetId: string, params?: ListBudgetAlertsParams) =>
    queryKeys.budgets.alerts(budgetId, params),
} as const;

/** Options for the {@link useBudgetAlerts} hook. */
export interface UseBudgetAlertsOptions {
  /**
   * Polling interval in milliseconds. Set to `false` (the default) or `0` to
   * disable polling. When specified, polling automatically pauses when the window/tab
   * loses focus.
   */
  refetchInterval?: number | false;
  /**
   * Alias for `refetchInterval` for consistency with other polling hooks.
   */
  interval?: number;
  /**
   * Whether the query should run. Defaults to `true`. When `false` or when `budgetId`
   * is falsy/empty, the query is disabled.
   */
  enabled?: boolean;
  /**
   * How long fetched data remains fresh in milliseconds before background refetching.
   */
  staleTime?: number;
}

/**
 * Fetch budget threshold alert subscriptions for a given budget.
 *
 * Backed by `astroid.budgets.listAlerts(budgetId, params)` and TanStack Query.
 *
 * @param budgetId The budget ID to fetch alerts for.
 * @param params Optional list filters (e.g. channel, active state, pagination).
 * @param options Optional query options (polling interval, enabled flag, stale time).
 * @returns A TanStack Query result containing a {@link Paginated} list of {@link BudgetAlert}.
 *
 * @example
 * ```tsx
 * const { data, isLoading, isError } = useBudgetAlerts('bud_123', { limit: 10 }, {
 *   refetchInterval: 5000,
 * });
 * ```
 */
export function useBudgetAlerts(
  budgetId: string | undefined,
  params?: ListBudgetAlertsParams,
  options: UseBudgetAlertsOptions = {},
): UseQueryResult<Paginated<BudgetAlert>, Error> {
  const astroid = useAstroidClient();
  const { enabled = true, refetchInterval, interval, staleTime } = options;

  const effectiveInterval = refetchInterval ?? interval ?? false;
  const isQueryEnabled = Boolean(budgetId) && enabled;

  return useQuery({
    queryKey: budgetAlertKeys.list(budgetId ?? '', params),
    queryFn: () => astroid.budgets.listAlerts(budgetId as string, params),
    enabled: isQueryEnabled,
    refetchInterval: effectiveInterval,
    staleTime,
  });
}

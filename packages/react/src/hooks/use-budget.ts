import {
  useQuery,
  type UseQueryResult,
} from '@tanstack/react-query';
import { queryKeys, useAstroidClient } from '../hooks.js';
import type { Budget, BudgetUtilization } from '@astroid/types';

/**
 * Options for the {@link useBudget} and {@link useBudgetUtilization} hooks.
 *
 * A forward-compatible subset of TanStack Query's `UseQueryOptions` covering
 * the knobs dashboards actually tune: gating, polling and cache freshness.
 */
export interface UseBudgetQueryOptions {
  /**
   * Whether the query should run. When `false` the hook returns an idle
   * query result and performs no fetches. Defaults to `true`; an empty
   * `id` always disables the query regardless of this flag.
   */
  enabled?: boolean;
  /**
   * Polling interval in milliseconds. Set to `false` (the default) to
   * disable polling entirely.
   */
  refetchInterval?: number | false;
  /**
   * How long fetched data stays fresh (ms) before a background refetch on
   * mount/focus. Defaults to the query client's `staleTime` (usually `0`).
   */
  staleTime?: number;
}

/** Resolve the effective `enabled` flag for a budget query by id. */
function isEnabled(id: string | undefined, enabled: boolean | undefined): boolean {
  return Boolean(id) && enabled !== false;
}

/**
 * Fetch a single budget by id.
 *
 * Cached under the shared `queryKeys.budgets.detail` key, so
 * `queryClient.invalidateQueries({ queryKey: queryKeys.budgets.all })` and the
 * `useUpdateBudget` mutation refresh it automatically.
 *
 * @param id      The budget id to fetch, or `undefined` to disable the query.
 * @param options Optional query configuration (`enabled`, `refetchInterval`,
 *                `staleTime`).
 * @returns A TanStack Query result with `data` (a {@link Budget}), `isLoading`,
 *   `isError`, `error`, `refetch`, etc.
 *
 * @example
 * ```tsx
 * const { data, isLoading, error } = useBudget('bud_abc123');
 * if (isLoading) return <p>Loading…</p>;
 * if (error) return <p>{error.message}</p>;
 * return <p>{data?.name} — {data?.remaining} remaining</p>;
 * ```
 */
export function useBudget(
  id: string | undefined,
  options: UseBudgetQueryOptions = {},
): UseQueryResult<Budget, Error> {
  const astroid = useAstroidClient();
  const { enabled = true, refetchInterval, staleTime } = options;

  return useQuery<Budget, Error>({
    queryKey: queryKeys.budgets.detail(id ?? ''),
    queryFn: () => astroid.budgets.get(id as string),
    enabled: isEnabled(id, enabled),
    refetchInterval: refetchInterval ?? false,
    staleTime,
  });
}

/**
 * Fetch the current utilization snapshot for a budget.
 *
 * Cached under the budget's utilization key, which {@link useUpdateBudget}
 * (and any budget-domain invalidation) refreshes. Poll via `refetchInterval`
 * to keep live spend/percent readouts current.
 *
 * @param id      The budget whose utilization to fetch, or `undefined` to
 *                disable the query.
 * @param options Optional query configuration (`enabled`, `refetchInterval`,
 *                `staleTime`).
 * @returns A TanStack Query result with `data` (a {@link BudgetUtilization}
 *   carrying `limit`, `spent`, `remaining`, `percent` and `state`),
 *   `isLoading`, `isError`, `error`, `refetch`, etc.
 *
 * @example
 * ```tsx
 * const { data } = useBudgetUtilization('bud_abc123', {
 *   refetchInterval: 10_000,
 *   staleTime: 5_000,
 * });
 * return <progress value={data?.percent ?? 0} max={100} />;
 * ```
 */
export function useBudgetUtilization(
  id: string | undefined,
  options: UseBudgetQueryOptions = {},
): UseQueryResult<BudgetUtilization, Error> {
  const astroid = useAstroidClient();
  const { enabled = true, refetchInterval, staleTime } = options;

  return useQuery<BudgetUtilization, Error>({
    queryKey: queryKeys.budgets.utilization(id ?? ''),
    queryFn: () => astroid.budgets.utilization(id as string),
    enabled: isEnabled(id, enabled),
    refetchInterval: refetchInterval ?? false,
    staleTime,
  });
}

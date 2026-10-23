import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { queryKeys, useAstroidClient } from '../hooks.js';
import type { Budget, BudgetUtilization } from '@astroid/types';

/**
 * Aggregate health bucket reported by {@link useBudgetThreshold}.
 *
 * - `'unknown'` — no utilization data yet (loading, error, or disabled query).
 * - `'healthy'` — below the near-limit threshold.
 * - `'near-limit'` — at or above `nearLimitPercent` but below `exceededPercent`.
 * - `'exceeded'` — at or above `exceededPercent`.
 */
export type BudgetThresholdStatus = 'unknown' | 'healthy' | 'near-limit' | 'exceeded';

/** Options for the {@link useBudgetThreshold} hook. */
export interface UseBudgetThresholdOptions extends UseBudgetQueryOptions {
  /**
   * Percent of the limit at which {@link BudgetThresholdResult.isNearLimit}
   * becomes `true`. Defaults to `80`. Must be a finite number greater than 0.
   */
  nearLimitPercent?: number;
  /**
   * Percent of the limit at which {@link BudgetThresholdResult.isExceeded}
   * becomes `true`. Defaults to `100`. Must be a finite number greater than 0.
   */
  exceededPercent?: number;
}

/** Everything {@link useBudgetThreshold} exposes to the component. */
export interface BudgetThresholdResult {
  /** The latest utilization snapshot, `undefined` while loading or on error. */
  data: BudgetUtilization | undefined;
  /** `true` until the first utilization fetch resolves. */
  isLoading: boolean;
  /** `true` when the utilization fetch failed. */
  isError: boolean;
  /** The fetch error, when {@link BudgetThresholdResult.isError} is `true`. */
  error: Error | null;
  /** Manually refetch the utilization snapshot. */
  refetch: UseQueryResult<BudgetUtilization, Error>['refetch'];
  /**
   * Percent of the limit consumed, `0`–`100+` (values above 100 are possible
   * when spend overshoots the limit). `0` while no data is available.
   */
  utilizationPercent: number;
  /**
   * `true` once utilization reaches `nearLimitPercent` (default `80`).
   * Remains `true` when the limit is exceeded, so a single flag drives
   * "at or beyond the warning zone" UI.
   */
  isNearLimit: boolean;
  /** `true` once utilization reaches `exceededPercent` (default `100`). */
  isExceeded: boolean;
  /** Aggregate bucket derived from {@link BudgetThresholdResult.utilizationPercent}. */
  status: BudgetThresholdStatus;
  /** The effective near-limit threshold in percent. */
  nearLimitPercent: number;
  /** The effective exceeded threshold in percent. */
  exceededPercent: number;
}

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

/** Validate a developer-supplied threshold: finite and greater than 0. */
function assertThreshold(name: 'nearLimitPercent' | 'exceededPercent', value: number): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`useBudgetThreshold: "${name}" must be a finite number greater than 0.`);
  }
}

/**
 * Percent consumed (0–100+) derived from a utilization snapshot.
 *
 * Prefers the server-computed `percent`; falls back to the 0..1 `utilization`
 * fraction and finally to `spent / limit` from the decimal strings, so the
 * flags stay correct even when the API omits one of the derived fields.
 */
function computeUtilizationPercent(snapshot: BudgetUtilization | undefined): number {
  if (!snapshot) return 0;
  if (typeof snapshot.percent === 'number' && Number.isFinite(snapshot.percent)) {
    return Math.max(0, snapshot.percent);
  }
  if (typeof snapshot.utilization === 'number' && Number.isFinite(snapshot.utilization)) {
    return Math.max(0, snapshot.utilization * 100);
  }
  const limit = Number(snapshot.limit);
  const spent = Number(snapshot.spent);
  if (Number.isFinite(limit) && Number.isFinite(spent) && limit > 0) {
    return Math.max(0, (spent / limit) * 100);
  }
  return 0;
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

/**
 * Monitor a budget against configurable warning thresholds (issue: budget
 * utilization warning hooks).
 *
 * Wraps {@link useBudgetUtilization} (TanStack Query — cached under the same
 * utilization key and refreshed by budget mutations) and derives reactive
 * warning flags from the fetched snapshot: pass `nearLimitPercent` (default
 * `80`) and/or `exceededPercent` (default `100`) and drive UI alerts from
 * `isNearLimit` / `isExceeded`. The query accepts the standard
 * {@link UseBudgetQueryOptions} knobs — `refetchInterval` keeps a live
 * dashboard current; `enabled: false` pauses monitoring.
 *
 * @param id      The budget id to monitor, or `undefined` to disable the query.
 * @param options Thresholds (`nearLimitPercent`, `exceededPercent`) plus the
 *                standard query options (`enabled`, `refetchInterval`, `staleTime`).
 * @returns A {@link BudgetThresholdResult} with the utilization snapshot,
 *   loading/error state, the computed `utilizationPercent` and the reactive
 *   `isNearLimit` / `isExceeded` / `status` flags.
 * @throws Error synchronously when a threshold is not a finite number > 0.
 *
 * @example
 * ```tsx
 * const { isNearLimit, isExceeded, utilizationPercent, isLoading } =
 *   useBudgetThreshold('bud_abc123', { refetchInterval: 10_000 });
 *
 * if (isLoading) return <Spinner />;
 * if (isExceeded) return <Alert severity="critical">Budget exhausted!</Alert>;
 * if (isNearLimit) return <Alert severity="warning">{utilizationPercent}% used</Alert>;
 * return <p>{utilizationPercent}% of budget used</p>;
 * ```
 */
export function useBudgetThreshold(
  id: string | undefined,
  options: UseBudgetThresholdOptions = {},
): BudgetThresholdResult {
  const { nearLimitPercent = 80, exceededPercent = 100, ...queryOptions } = options;

  assertThreshold('nearLimitPercent', nearLimitPercent);
  assertThreshold('exceededPercent', exceededPercent);

  const query = useBudgetUtilization(id, queryOptions);

  const utilizationPercent = computeUtilizationPercent(query.data);
  const isExceeded = utilizationPercent >= exceededPercent;
  const isNearLimit = isExceeded || utilizationPercent >= nearLimitPercent;
  const status: BudgetThresholdStatus = query.data
    ? isExceeded
      ? 'exceeded'
      : isNearLimit
        ? 'near-limit'
        : 'healthy'
    : 'unknown';

  return {
    data: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
    utilizationPercent,
    isNearLimit,
    isExceeded,
    status,
    nearLimitPercent,
    exceededPercent,
  };
}

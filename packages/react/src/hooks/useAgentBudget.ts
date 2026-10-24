import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useAstroidClient } from '../hooks.js';
import type { Budget, Paginated } from '@astroid/types';

/**
 * Query key factory for an agent's budget allocations.
 *
 * Keys are namespaced under `agents` (rather than `budgets`) so the hook cache
 * is scoped like the other agent monitors (`agentStatusKeys`,
 * `agentWalletBalanceKeys`) and can be invalidated independently of the shared
 * budget list cache. Use `agentBudgetKeys.all(agentId)` to invalidate or
 * refresh an agent's allocation snapshot manually.
 */
export const agentBudgetKeys = {
  /** Exact key for all budgets allocated to an agent. */
  all: (agentId: string) => ['astroid', 'agents', 'budget', agentId] as const,
} as const;

/**
 * Options for the {@link useAgentBudget} hook.
 *
 * A forward-compatible subset of TanStack Query's `UseQueryOptions` covering
 * the knobs dashboards actually tune: gating, polling and cache freshness.
 */
export interface UseAgentBudgetOptions {
  /**
   * Whether the query should run. When `false` the hook returns an idle
   * query result and performs no fetches. Defaults to `true`; an empty
   * `agentId` always disables the query regardless of this flag.
   */
  enabled?: boolean;
  /**
   * Polling interval in milliseconds. Set to `false` (the default) to disable
   * polling entirely.
   */
  refetchInterval?: number | false;
  /**
   * How long fetched allocations stay fresh (ms) before a background refetch
   * on mount/focus. Defaults to the query client's `staleTime` (usually `0`).
   */
  staleTime?: number;
}

/**
 * Fetch the budgets allocated to a single agent.
 *
 * Backed by `budgets.list({ agentId })` through the configured `@astroid/client`
 * instance from {@link useAstroidClient} (see `<AstroidProvider>`), so the hook
 * is always safe to call inside an agent dashboard tree. The result is cached
 * with TanStack Query under {@link agentBudgetKeys.all}; pass `refetchInterval`
 * to re-validate allocations periodically — the query is disabled until a
 * non-empty `agentId` is provided, so data can reactively drive UI.
 *
 * @param agentId The agent whose budget allocations to fetch, or `undefined`
 *   to disable the query.
 * @param options Optional query configuration (`enabled`, `refetchInterval`,
 *   `staleTime`).
 * @returns A TanStack Query result with `data` (a {@link Paginated} of
 *   {@link Budget}), `isLoading`, `isError`, `error`, `refetch`, etc.
 *
 * @example
 * ```tsx
 * const { data, isLoading, isError, error } = useAgentBudget('agent_abc123', {
 *   refetchInterval: 10_000,
 *   staleTime: 5_000,
 * });
 *
 * if (isLoading) return <p>Loading budget…</p>;
 * if (isError) return <p>{error?.message}</p>;
 *
 * return (
 *   <table>
 *     <tbody>
 *       {data?.data.map((b) => (
 *         <tr key={b.id}>
 *           <td>{b.name}</td>
 *           <td>{b.spent} / {b.limitAmount}</td>
 *         </tr>
 *       ))}
 *     </tbody>
 *   </table>
 * );
 * ```
 */
export function useAgentBudget(
  agentId: string | undefined,
  options: UseAgentBudgetOptions = {},
): UseQueryResult<Paginated<Budget>, Error> {
  const astroid = useAstroidClient();
  const { enabled = true, refetchInterval, staleTime } = options;

  return useQuery<Paginated<Budget>, Error>({
    queryKey: agentBudgetKeys.all(agentId ?? ''),
    queryFn: () => astroid.budgets.list({ agentId: agentId as string }),
    enabled: Boolean(agentId) && enabled,
    refetchInterval: refetchInterval ?? false,
    staleTime,
  });
}

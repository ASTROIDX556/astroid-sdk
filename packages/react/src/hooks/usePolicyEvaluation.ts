import { useQuery, type Query, type UseQueryResult } from '@tanstack/react-query';
import { useAstroidClient } from '../hooks.js';
import type { Policy, PolicySimulationEvaluation, PolicySimulationInput } from '@astroid/types';

/**
 * Query key factory for policy evaluation queries.
 *
 * Keys live under the `['astroid', 'policies', 'evaluation']` namespace, so
 * `queryClient.invalidateQueries({ queryKey: queryKeys.policies.all })` or
 * `queryClient.invalidateQueries({ queryKey: policyEvaluationKeys.all })`
 * invalidates every policy evaluation query in the app.
 */
export const policyEvaluationKeys = {
  /** Root key for all policy evaluation queries. */
  all: ['astroid', 'policies', 'evaluation'] as const,
  /**
   * Detail key for a specific policy evaluation, uniquely keyed by policy ID and input parameters.
   */
  detail: (policyId: string, input?: PolicySimulationInput) =>
    ['astroid', 'policies', 'evaluation', policyId, input ?? {}] as const,
} as const;

/** Options for the {@link usePolicyEvaluation} hook. */
export interface UsePolicyEvaluationOptions {
  /**
   * Optional transaction payload to evaluate against the policy.
   * When provided, `astroid.policies.simulatePolicy(policyId, input)` is called.
   * When omitted, `astroid.policies.get(policyId)` is called to retrieve policy details and status.
   */
  input?: PolicySimulationInput;
  /**
   * Whether the query should execute. Defaults to `true`.
   * An empty or `undefined` `policyId` always disables the query regardless of this flag.
   */
  enabled?: boolean;
  /**
   * Polling interval in milliseconds, or `false` to disable polling.
   * Controls how frequently TanStack Query automatically refetches evaluation status.
   */
  refetchInterval?:
    | number
    | false
    | ((query: Query<PolicySimulationEvaluation | Policy, Error>) => number | false | undefined);
  /**
   * Polling interval in milliseconds (shorthand alias for `refetchInterval` consistent with SDK options).
   */
  interval?: number;
  /**
   * How long (in ms) fetched policy evaluation data stays fresh before a background refetch is triggered.
   */
  staleTime?: number;
  /**
   * Retry behavior for failed evaluation requests passed to TanStack Query.
   */
  retry?: boolean | number | ((failureCount: number, error: Error) => boolean);
  /**
   * Extra query options forwarded directly to TanStack Query's `useQuery`.
   */
  queryOptions?: Record<string, unknown>;
}

/**
 * Observe a policy's evaluation status reactively with TanStack Query.
 *
 * Supports periodic polling, caching, stale-time management, and optional dry-run
 * transaction simulation against a policy.
 *
 * @param policyId  The ID of the policy to observe or evaluate. If `undefined` or empty, the query is disabled.
 * @param options   Configuration options including transaction `input`, polling intervals, `staleTime`, and `enabled`.
 * @returns         A TanStack Query result containing `data`, `isLoading`, `isFetching`, `isError`, `error`, `refetch`, etc.
 *
 * @example
 * ```tsx
 * // Observe policy status with polling every 5 seconds:
 * const { data, isLoading } = usePolicyEvaluation('pol_abc123', {
 *   refetchInterval: 5000,
 * });
 *
 * // Dry-run evaluate a proposed transaction against a policy:
 * const { data: evaluation } = usePolicyEvaluation('pol_abc123', {
 *   input: { asset: 'USDC', amount: '250.00', recipientAddress: 'GABC...' },
 * });
 * if (evaluation && 'allowed' in evaluation && !evaluation.allowed) {
 *   console.warn('Policy violated:', evaluation.violatedRules);
 * }
 * ```
 */
export function usePolicyEvaluation(
  policyId: string | undefined,
  options: UsePolicyEvaluationOptions & { input: PolicySimulationInput },
): UseQueryResult<PolicySimulationEvaluation, Error>;
export function usePolicyEvaluation(
  policyId: string | undefined,
  options?: UsePolicyEvaluationOptions,
): UseQueryResult<PolicySimulationEvaluation | Policy, Error>;
export function usePolicyEvaluation(
  policyId: string | undefined,
  options: UsePolicyEvaluationOptions = {},
): UseQueryResult<PolicySimulationEvaluation | Policy, Error> {
  const astroid = useAstroidClient();
  const {
    input,
    enabled = true,
    refetchInterval,
    interval,
    staleTime,
    retry,
    queryOptions,
  } = options;

  const effectivePolicyId = policyId ?? '';
  const isQueryEnabled = Boolean(effectivePolicyId) && enabled !== false;
  const effectiveRefetchInterval = refetchInterval ?? (interval !== undefined ? interval : false);

  return useQuery({
    queryKey: policyEvaluationKeys.detail(effectivePolicyId, input),
    queryFn: async () => {
      if (!effectivePolicyId) {
        throw new Error('policyId is required for policy evaluation.');
      }
      if (input) {
        return astroid.policies.simulatePolicy(effectivePolicyId, input);
      }
      return astroid.policies.get(effectivePolicyId);
    },
    enabled: isQueryEnabled,
    refetchInterval: isQueryEnabled ? effectiveRefetchInterval : false,
    ...(staleTime !== undefined ? { staleTime } : {}),
    ...(retry !== undefined ? { retry } : {}),
    ...queryOptions,
  });
}

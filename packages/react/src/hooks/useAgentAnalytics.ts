import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useAstroidClient } from '../hooks.js';
import type { AgentAnalytics, AnalyticsQueryParams } from '@astroid/types';

/** Backwards-compatible name for the analytics payload returned by the hook. */
export type AgentAnalyticsData = AgentAnalytics;

/**
 * Query key factory for agent analytics.
 */
export const agentAnalyticsKeys = {
  root: ['astroid', 'agents', 'analytics'] as const,
  all: (agentId: string) => ['astroid', 'agents', agentId, 'analytics'] as const,
  detail: (agentId: string, params?: AnalyticsQueryParams) =>
    ['astroid', 'agents', agentId, 'analytics', params ?? {}] as const,
} as const;

/** Options for the {@link useAgentAnalytics} hook. */
export interface UseAgentAnalyticsOptions {
  /** Whether the query is enabled. Defaults to `true`. */
  enabled?: boolean;
  /** Analytics query parameters like timeframe, asset, or granularity. */
  params?: AnalyticsQueryParams;
  /** Stale time in milliseconds. */
  staleTime?: number;
  /** Polling interval in milliseconds. */
  refetchInterval?: number | false;
}

/**
 * Fetch analytics and performance metrics for an autonomous agent.
 *
 * @param agentId The ID of the agent whose analytics to fetch.
 * @param options Optional query parameters and options.
 * @returns A TanStack Query result with `data` (an {@link AgentAnalytics} object), `isLoading`, `isError`, `error`, etc.
 *
 * @example
 * ```tsx
 * const { data, isLoading, error } = useAgentAnalytics('agent_123', {
 *   params: { timeframe: '7d' },
 * });
 *
 * if (isLoading) return <p>Loading analytics...</p>;
 * if (error) return <p>Error: {error.message}</p>;
 *
 * return <div>Total Volume: {data?.transactionVolume}</div>;
 * ```
 */
export function useAgentAnalytics(
  agentId: string | undefined,
  options: UseAgentAnalyticsOptions = {},
): UseQueryResult<AgentAnalytics, Error> {
  const astroid = useAstroidClient();
  const { enabled = true, params, staleTime, refetchInterval } = options;

  return useQuery({
    queryKey: agentAnalyticsKeys.detail(agentId ?? '', params),
    queryFn: () => astroid.analytics.agents({ ...(params ?? {}), agentId: agentId as string }),
    enabled: Boolean(agentId) && enabled,
    staleTime,
    refetchInterval: refetchInterval ?? false,
  });
}

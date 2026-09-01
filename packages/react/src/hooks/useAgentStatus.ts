import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useAstroidClient } from '../hooks.js';
import type { AgentStatusMetrics } from '@astroid/types';

/** Query key factory for agent status metrics. */
export const agentStatusKeys = {
  all: (agentId: string) => ['astroid', 'agents', agentId, 'status'] as const,
} as const;

/** Options for the `useAgentStatus` hook. */
export interface UseAgentStatusOptions {
  /** Polling interval in milliseconds. Defaults to 5000 (5 seconds). */
  interval?: number;
  /** Whether the query is enabled. Set to `false` to pause polling. Defaults to `true`. */
  enabled?: boolean;
  /** Extra TanStack Query options forwarded to `useQuery`. */
  queryOptions?: Record<string, unknown>;
}

/**
 * Fetch real-time operational status metrics for an agent with configurable
 * polling.
 *
 * The status endpoint returns metrics such as current activity, spend,
 * budget remaining, error counts, and uptime. Polling automatically pauses
 * when the browser tab loses focus and resumes on refocus. Polling stops
 * entirely when `enabled` is set to `false`.
 *
 * @param agentId  The ID of the agent whose status to fetch.
 * @param options  Optional polling interval, enabled flag, and extra query options.
 * @returns        A TanStack Query result with `data` (an
 *                 {@link AgentStatusMetrics}), `isLoading`, `isFetching`,
 *                 `error`, etc.
 *
 * @example
 * ```tsx
 * const { data, isFetching } = useAgentStatus('agent_abc123', {
 *   interval: 2000,
 * });
 *
 * if (isFetching && !data) return <p>Loading status…</p>;
 *
 * return (
 *   <div>
 *     <p>Status: {data?.status}</p>
 *     <p>Active: {data?.isActive ? 'Yes' : 'No'}</p>
 *     <p>Tasks: {data?.tasksCompleted} completed, {data?.tasksInProgress} in progress</p>
 *     <p>Spend: ${data?.currentSpend}</p>
 *   </div>
 * );
 * ```
 */
export function useAgentStatus(
  agentId: string,
  options: UseAgentStatusOptions = {},
): UseQueryResult<AgentStatusMetrics, Error> {
  const astroid = useAstroidClient();
  const { interval = 5000, enabled = true, queryOptions } = options;

  return useQuery({
    queryKey: agentStatusKeys.all(agentId),
    queryFn: () => astroid.agents.status(agentId),
    enabled,
    refetchInterval: enabled ? interval : false,
    refetchOnWindowFocus: enabled,
    staleTime: interval,
    ...queryOptions,
  });
}

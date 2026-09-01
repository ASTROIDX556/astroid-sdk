import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useAstroidClient } from '../hooks.js';
import type { AgentLog, Paginated, PaginationParams } from '@astroid/types';

/** Query key factory for agent logs. */
export const agentLogKeys = {
  all: (agentId: string) => ['astroid', 'agents', agentId, 'logs'] as const,
  list: (agentId: string, params?: PaginationParams) =>
    ['astroid', 'agents', agentId, 'logs', params ?? {}] as const,
} as const;

/** Options for the `useAgentLogs` hook. */
export interface UseAgentLogsOptions {
  /** Polling interval in milliseconds. Defaults to 5000 (5 seconds). */
  interval?: number;
  /** Whether the query is enabled. Set to `false` to pause polling. Defaults to `true`. */
  enabled?: boolean;
  /** Extra TanStack Query options forwarded to `useQuery`. */
  queryOptions?: Record<string, unknown>;
}

/**
 * Fetch paginated execution logs for an agent with configurable polling.
 *
 * Polling automatically pauses when the browser tab loses focus (via TanStack
 * Query's `refetchOnWindowFocus: false` when polling is active, and standard
 * focus detection). Polling stops entirely when `enabled` is set to `false`.
 *
 * @param agentId  The ID of the agent whose logs to fetch.
 * @param options  Optional polling interval, enabled flag, and extra query options.
 * @returns        A TanStack Query result with `data` (a {@link Paginated} of
 *                 {@link AgentLog}), `isLoading`, `isFetching`, `error`, etc.
 *
 * @example
 * ```tsx
 * const { data, isFetching } = useAgentLogs('agent_abc123', {
 *   interval: 3000,
 * });
 *
 * if (isFetching && !data) return <p>Loading logs…</p>;
 *
 * return (
 *   <ul>
 *     {data?.data.map((log) => (
 *       <li key={log.id}>
 *         [{log.level}] {log.message}
 *       </li>
 *     ))}
 *   </ul>
 * );
 * ```
 */
export function useAgentLogs(
  agentId: string,
  options: UseAgentLogsOptions = {},
): UseQueryResult<Paginated<AgentLog>, Error> {
  const astroid = useAstroidClient();
  const { interval = 5000, enabled = true, queryOptions } = options;

  return useQuery({
    queryKey: agentLogKeys.list(agentId, queryOptions as PaginationParams | undefined),
    queryFn: () => astroid.agents.logs(agentId),
    enabled,
    refetchInterval: enabled ? interval : false,
    refetchOnWindowFocus: enabled,
    staleTime: interval,
    ...queryOptions,
  });
}

/**
 * Shared optimistic-update plumbing for agent mutation hooks.
 *
 * Every agent mutation hook in `@astroid/react` follows the same lifecycle
 * contract (issue #231):
 *
 * - `onMutate` — `await queryClient.cancelQueries(...)` (so an in-flight
 *   refetch cannot clobber the optimistic write), snapshot the previous cache
 *   into the mutation context, then apply the optimistic value.
 * - `onError` — restore every snapshotted entry exactly as it was.
 * - `onSettled` — invalidate the specific agent's detail key plus the
 *   list/aggregate keys so the cache reconciles with server truth.
 *
 * Cache writes and the rollback context are strictly typed against
 * `@astroid/types` (`Agent`, `Paginated<Agent>`, `AgentStatus`,
 * `AgentMetadata`) — no `any` anywhere.
 *
 * @module
 */

import type { QueryClient } from '@tanstack/react-query';
import type { Agent, Paginated, UpdateAgentParams } from '@astroid/types';
import { queryKeys } from '../hooks.js';

/* -------------------------------------------------------------------------- */
/* Cache-entry types                                                           */
/* -------------------------------------------------------------------------- */

/** A single snapshotted cache entry captured in `onMutate` for rollback. */
export interface OptimisticCacheEntry {
  /** The full, structurally-stable query key of the snapshotted entry. */
  key: readonly unknown[];
  /** The previous cache value, or `undefined` when the entry did not exist. */
  data: Agent | Paginated<Agent> | undefined;
}

/** The mutation context produced by `onMutate` and consumed by `onError`. */
export interface OptimisticAgentContext {
  /** Pre-mutation snapshots of every cache entry the hook touched. */
  snapshot: OptimisticCacheEntry[];
}

/* -------------------------------------------------------------------------- */
/* Snapshot helpers                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Cancel in-flight agent queries and snapshot the affected cache entries.
 *
 * Cancellation is **awaited** so a completing refetch cannot land after the
 * snapshot and overwrite the optimistic value — the race issue #231 calls out.
 *
 * When `agentId` is given, the agent's detail entry is snapshotted as well
 * (with `undefined` when it does not exist) so an error rollback restores an
 * exact pre-mutation cache, including re-removing a detail entry that the
 * mutation may have created optimistically.
 *
 * @returns The rollback snapshot to store in the mutation context.
 */
export async function snapshotAgentCache(
  queryClient: QueryClient,
  agentId?: string,
): Promise<OptimisticAgentContext> {
  // Stop any running refetches for the whole agents domain before reading the
  // cache, otherwise a response arriving between snapshot and optimistic write
  // would overwrite the optimistic state.
  await queryClient.cancelQueries({ queryKey: queryKeys.agents.all });

  // IMPORTANT: match list keys explicitly. `getQueriesData` performs prefix
  // matching, so filtering on `queryKeys.agents.all` would also capture
  // `['astroid', 'agents', 'detail', id]` entries, whose data is not
  // `Paginated<Agent>` — merging those in the list-update loop would corrupt
  // the detail cache.
  const snapshot: OptimisticCacheEntry[] = queryClient
    .getQueriesData<Paginated<Agent>>({ queryKey: queryKeys.agents.list() })
    .map(([key, data]) => ({ key, data }));

  if (agentId !== undefined) {
    const detailKey = queryKeys.agents.detail(agentId);
    snapshot.push({ key: detailKey, data: queryClient.getQueryData<Agent>(detailKey) });
  }

  return { snapshot };
}

/**
 * Restore every snapshotted entry to its pre-mutation value. Entries that were
 * absent before the mutation are removed again.
 *
 * @returns A promise resolving once all rollback writes are applied.
 */
export async function rollbackAgentCache(
  queryClient: QueryClient,
  context: OptimisticAgentContext | undefined,
): Promise<void> {
  if (!context) return;
  for (const { key, data } of context.snapshot) {
    queryClient.setQueryData(key, data);
  }
  await Promise.resolve();
}

/* -------------------------------------------------------------------------- */
/* List / detail update helpers                                                */
/* -------------------------------------------------------------------------- */

/**
 * Apply `updater` to the matching agent in every cached list and, when
 * `updater` returns `undefined`, remove the agent from the lists (delete).
 */
export function patchAgentInLists(
  queryClient: QueryClient,
  id: string,
  updater: (agent: Agent) => Agent | undefined,
): void {
  const lists = queryClient.getQueriesData<Paginated<Agent>>({
    queryKey: queryKeys.agents.list(),
  });
  for (const [key, oldData] of lists) {
    if (!oldData) continue;
    queryClient.setQueryData<Paginated<Agent>>(key, {
      ...oldData,
      data: oldData.data
        .map((agent) => (agent.id === id ? updater(agent) : agent))
        .filter((agent): agent is Agent => agent !== undefined),
    });
  }
}

/**
 * Merge `params` into the cached detail entity, if one exists. The optimistic
 * value is a spread of the previous entity with the update payload — exactly
 * the shape the server will return for the same patch — so no `any` or loose
 * partial writes ever enter the cache.
 */
export function patchAgentDetail(
  queryClient: QueryClient,
  id: string,
  params: UpdateAgentParams,
): void {
  const key = queryKeys.agents.detail(id);
  const previous = queryClient.getQueryData<Agent>(key);
  if (!previous) return;
  const optimistic: Agent = {
    ...previous,
    ...params,
    updatedAt: new Date().toISOString(),
  };
  queryClient.setQueryData<Agent>(key, optimistic);
}

/* -------------------------------------------------------------------------- */
/* Invalidation helpers                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Invalidate everything a settled agent mutation may have changed.
 *
 * The specific agent's detail key and every agent list are invalidated with
 * their default refetch behaviour so active observers refetch immediately.
 * The whole agents domain is additionally swept with `refetchType: 'none'` —
 * prefix matching means it also covers derived/aggregate keys (e.g. status
 * metrics), which are marked stale for their next fetch without triggering a
 * duplicate refetch of the detail/list observers already refetching above.
 */
export async function invalidateAgentQueries(queryClient: QueryClient, id: string): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.agents.detail(id) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.agents.list() }),
    queryClient.invalidateQueries({ queryKey: queryKeys.agents.all, refetchType: 'none' }),
  ]);
}

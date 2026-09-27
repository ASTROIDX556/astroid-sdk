import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useAstroidClient } from '../hooks.js';
import type {
  Agent,
  AgentMetadata,
  AgentStatus,
  CreateAgentParams,
  Paginated,
  UpdateAgentParams,
} from '@astroid/types';
import { queryKeys } from '../hooks.js';
import {
  invalidateAgentQueries,
  patchAgentDetail,
  patchAgentInLists,
  rollbackAgentCache,
  snapshotAgentCache,
} from './optimistic-agent.js';

/* -------------------------------------------------------------------------- */
/* useCreateAgent — optimistic: prepend to list cache                          */
/* -------------------------------------------------------------------------- */

/**
 * Mutation hook to create a new autonomous agent.
 *
 * **Optimistic update**: the new agent is immediately prepended to every cached
 * agent list so the UI reflects the change before the server responds. In-flight
 * agent refetches are cancelled first so a stale response cannot clobber the
 * optimistic entry; if the mutation fails the lists are rolled back to their
 * pre-mutation snapshot.
 *
 * On settle (success _or_ error) the agents domain is invalidated so the cache
 * converges to the authoritative server state.
 */
export function useCreateAgent(): UseMutationResult<Agent, Error, CreateAgentParams> {
  const astroid = useAstroidClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: CreateAgentParams) => astroid.agents.create(params),
    onMutate: async (newParams) => {
      // Cancel in-flight refetches, then snapshot the previous list cache.
      const context = await snapshotAgentCache(queryClient);

      // Build a temporary optimistic agent from the create params. The id and
      // timestamps are synthetic — they'll be replaced by the real entity on
      // settle when the cache is invalidated and refetched.
      const now = new Date().toISOString();
      const optimisticAgent: Agent = {
        id: `optimistic_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        organizationId: '',
        name: newParams.name,
        description: newParams.description ?? null,
        role: newParams.role ?? ('CUSTOM' as Agent['role']),
        status: 'ACTIVE' as Agent['status'],
        capabilities: newParams.capabilities,
        provider: newParams.provider ?? null,
        model: newParams.model ?? null,
        primaryWalletId: newParams.primaryWalletId ?? null,
        metadata: newParams.metadata ?? {},
        createdAt: now,
        updatedAt: now,
      };

      // Optimistically prepend the temporary agent to every cached list.
      const lists = queryClient.getQueriesData<Paginated<Agent>>({
        queryKey: queryKeys.agents.list(),
      });
      for (const [key, oldData] of lists) {
        if (!oldData) continue;
        queryClient.setQueryData<Paginated<Agent>>(key, {
          ...oldData,
          data: [optimisticAgent, ...oldData.data],
        });
      }

      return context;
    },
    onError: (_err, _vars, context) => {
      rollbackAgentCache(queryClient, context);
    },
    onSettled: () => {
      // Invalidate so TanStack Query re-fetches the authoritative state.
      void queryClient.invalidateQueries({ queryKey: queryKeys.agents.all });
    },
  });
}

/* -------------------------------------------------------------------------- */
/* useUpdateAgent — optimistic: merge into detail + list caches                */
/* -------------------------------------------------------------------------- */

/** Variables for {@link useUpdateAgent}. */
export interface UpdateAgentVariables {
  /** The agent to update. */
  id: string;
  /** The fields to patch (status, metadata, name, capabilities, …). */
  params: UpdateAgentParams;
}

/**
 * Mutation hook to update an existing autonomous agent.
 *
 * **Optimistic update**: the agent's cached detail and its entry in every list
 * are immediately patched with the update payload so the UI reflects the change
 * before the server responds. In-flight refetches are cancelled first; if the
 * mutation fails both caches are restored to their pre-mutation snapshots.
 *
 * On settle the specific agent's detail key and the list/aggregate keys are
 * invalidated so the cache reconciles with server truth.
 */
export function useUpdateAgent(): UseMutationResult<Agent, Error, UpdateAgentVariables> {
  const astroid = useAstroidClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, params }: UpdateAgentVariables) => astroid.agents.update(id, params),
    onMutate: async ({ id, params }) => {
      // Cancel in-flight refetches, then snapshot detail + lists for rollback.
      const context = await snapshotAgentCache(queryClient, id);

      // Optimistically patch the detail cache (if present) and the matching
      // agent inside every cached list.
      patchAgentDetail(queryClient, id, params);
      patchAgentInLists(queryClient, id, (agent) => ({
        ...agent,
        ...params,
        updatedAt: new Date().toISOString(),
      }));

      return context;
    },
    onError: (_err, _vars, context) => {
      rollbackAgentCache(queryClient, context);
    },
    onSettled: (_data, _error, { id }) => {
      void invalidateAgentQueries(queryClient, id);
    },
  });
}

/* -------------------------------------------------------------------------- */
/* useUpdateAgentStatus — optimistic lifecycle transition                      */
/* -------------------------------------------------------------------------- */

/** Variables for {@link useUpdateAgentStatus}. */
export interface UpdateAgentStatusVariables {
  /** The agent whose lifecycle status changes. */
  id: string;
  /** The new {@link AgentStatus} (e.g. `PAUSED` to pause the agent). */
  status: AgentStatus;
}

/**
 * Mutation hook to update an agent's lifecycle status (pause, resume, archive).
 *
 * Thin, focused wrapper over the update endpoint that follows the same
 * optimistic pattern as {@link useUpdateAgent}: the cached detail and list
 * entries flip to the new status instantly, in-flight refetches are cancelled,
 * failures roll back to the pre-mutation snapshot, and the affected keys are
 * invalidated on settle.
 */
export function useUpdateAgentStatus(): UseMutationResult<Agent, Error, UpdateAgentStatusVariables> {
  const astroid = useAstroidClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, status }: UpdateAgentStatusVariables) => astroid.agents.update(id, { status }),
    onMutate: async ({ id, status }) => {
      const context = await snapshotAgentCache(queryClient, id);

      patchAgentDetail(queryClient, id, { status });
      patchAgentInLists(queryClient, id, (agent) => ({
        ...agent,
        status,
        updatedAt: new Date().toISOString(),
      }));

      return context;
    },
    onError: (_err, _vars, context) => {
      rollbackAgentCache(queryClient, context);
    },
    onSettled: (_data, _error, { id }) => {
      void invalidateAgentQueries(queryClient, id);
    },
  });
}

/* -------------------------------------------------------------------------- */
/* useUpdateAgentMetadata — optimistic metadata merge                          */
/* -------------------------------------------------------------------------- */

/** Variables for {@link useUpdateAgentMetadata}. */
export interface UpdateAgentMetadataVariables {
  /** The agent whose metadata changes. */
  id: string;
  /** Metadata to merge into the stored metadata object. */
  metadata: AgentMetadata;
}

/**
 * Mutation hook to update an agent's metadata.
 *
 * Follows the shared optimistic pattern with one nuance: the optimistic value
 * **merges** the payload into the existing metadata (shallow) — mirroring the
 * API's merge semantics — instead of replacing it, so keys the UI did not send
 * keep their cached values until the server responds.
 */
export function useUpdateAgentMetadata(): UseMutationResult<Agent, Error, UpdateAgentMetadataVariables> {
  const astroid = useAstroidClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, metadata }: UpdateAgentMetadataVariables) =>
      astroid.agents.update(id, { metadata }),
    onMutate: async ({ id, metadata }) => {
      const context = await snapshotAgentCache(queryClient, id);

      // Merge into the cached detail, mirroring the API's merge semantics.
      const detailKey = queryKeys.agents.detail(id);
      const previousDetail = queryClient.getQueryData<Agent>(detailKey);
      if (previousDetail) {
        const merged: Record<string, unknown> = { ...previousDetail.metadata, ...metadata };
        queryClient.setQueryData<Agent>(detailKey, {
          ...previousDetail,
          metadata: merged,
          updatedAt: new Date().toISOString(),
        });
      }

      // Merge into the matching entry in every cached list.
      patchAgentInLists(queryClient, id, (agent) => {
        const merged: Record<string, unknown> = { ...agent.metadata, ...metadata };
        return { ...agent, metadata: merged, updatedAt: new Date().toISOString() };
      });

      return context;
    },
    onError: (_err, _vars, context) => {
      rollbackAgentCache(queryClient, context);
    },
    onSettled: (_data, _error, { id }) => {
      void invalidateAgentQueries(queryClient, id);
    },
  });
}

/* -------------------------------------------------------------------------- */
/* useDeleteAgent — optimistic: remove from list cache                         */
/* -------------------------------------------------------------------------- */

/**
 * Mutation hook to delete an autonomous agent.
 *
 * **Optimistic update**: the agent is immediately removed from every cached
 * agent list so the UI reflects the deletion before the server responds. If the
 * mutation fails the previous list caches (and detail, if snapshotted) are
 * restored. On settle the detail and list queries are invalidated.
 */
export function useDeleteAgent(): UseMutationResult<void, Error, string> {
  const astroid = useAstroidClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => astroid.agents.delete(id),
    onMutate: async (id) => {
      const context = await snapshotAgentCache(queryClient, id);

      // Optimistically remove the agent from every cached list.
      patchAgentInLists(queryClient, id, () => undefined);

      return context;
    },
    onError: (_err, _id, context) => {
      rollbackAgentCache(queryClient, context);
    },
    onSettled: (_data, _error, id) => {
      void invalidateAgentQueries(queryClient, id);
    },
  });
}

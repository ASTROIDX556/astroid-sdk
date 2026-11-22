import type { UseMutationResult } from '@tanstack/react-query';
import type { Agent, CreateAgentParams } from '@astroid/types';
import { useCreateAgent, useUpdateAgent, useDeleteAgent, type UpdateAgentVariables } from './useAgents.js';

/** The mutations {@link useAgentMutations} returns, one per supported operation. */
export interface UseAgentMutationsResult {
  /** Create a new agent — optimistic list prepend + rollback on failure. */
  create: UseMutationResult<Agent, Error, CreateAgentParams>;
  /** Update an existing agent — optimistic detail + list patch + rollback. */
  update: UseMutationResult<Agent, Error, UpdateAgentVariables>;
  /** Delete an agent — optimistic list removal + rollback. */
  delete: UseMutationResult<void, Error, string>;
}

/**
 * Combined agent-mutation hook (create / update / delete).
 *
 * Returns the three agent mutation hooks from {@link useAgents} (each built on
 * TanStack Query) as one object so components that touch every agent mutation
 * type have a single hook to import and render. Each member behaves exactly as
 * its granular counterpart: optimistic updates against the `@astroid/react`
 * agent query cache, rollback after failures, and cache invalidation after
 * settle.
 *
 * @example
 * ```tsx
 * const { create, update, delete: remove } = useAgentMutations();
 *
 * create.mutate({ name: 'New Agent', capabilities: ['trade'], initialBudget: { currency: 'USD', amount: '100' } });
 * update.mutate({ id: 'agent_001', params: { name: 'Renamed' } });
 * remove.mutate('agent_002');
 * ```
 */
export function useAgentMutations(): UseAgentMutationsResult {
  return {
    create: useCreateAgent(),
    update: useUpdateAgent(),
    delete: useDeleteAgent(),
  };
}

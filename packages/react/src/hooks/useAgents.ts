import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useAstroidClient } from '../hooks.js';
import type { Agent, CreateAgentParams, UpdateAgentParams } from '@astroid/types';
import { queryKeys } from '../hooks.js';

/**
 * Mutation hook to create a new autonomous agent.
 * Invalidates agent list queries upon successful creation.
 */
export function useCreateAgent(): UseMutationResult<Agent, Error, CreateAgentParams> {
  const astroid = useAstroidClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: CreateAgentParams) => astroid.agents.create(params),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.agents.list() });
    },
  });
}

/**
 * Mutation hook to update an existing autonomous agent.
 * Invalidates the agent detail query and list queries upon successful update.
 */
export function useUpdateAgent(): UseMutationResult<Agent, Error, { id: string; params: UpdateAgentParams }> {
  const astroid = useAstroidClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, params }: { id: string; params: UpdateAgentParams }) =>
      astroid.agents.update(id, params),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.agents.detail(variables.id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.agents.list() });
    },
  });
}

/**
 * Mutation hook to delete an autonomous agent.
 * Invalidates the agent detail query and list queries upon successful deletion.
 */
export function useDeleteAgent(): UseMutationResult<void, Error, string> {
  const astroid = useAstroidClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => astroid.agents.delete(id),
    onSuccess: (_data, id) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.agents.detail(id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.agents.list() });
    },
  });
}

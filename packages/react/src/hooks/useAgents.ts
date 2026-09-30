import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query';
import { useAstroidClient } from '../hooks.js';
import type {
  Agent,
  CreateAgentParams,
  UpdateAgentParams,
  Paginated,
  PaginationParams,
  AgentStatus,
  AgentMetadata
} from '@astroid/types';
import { queryKeys } from '../hooks.js';

export interface UpdateAgentVariables {
  id: string;
  params: UpdateAgentParams;
}

export interface UpdateAgentStatusVariables {
  id: string;
  status: AgentStatus;
}

export interface UpdateAgentMetadataVariables {
  id: string;
  metadata: AgentMetadata;
}

export function useAgents(params?: PaginationParams): UseQueryResult<Paginated<Agent>, Error> {
  const astroid = useAstroidClient();
  return useQuery({
    queryKey: queryKeys.agents.list(params),
    queryFn: () => astroid.agents.list(params),
  });
}

export function useAgent(id: string | undefined): UseQueryResult<Agent, Error> {
  const astroid = useAstroidClient();
  return useQuery({
    queryKey: queryKeys.agents.detail(id ?? ''),
    queryFn: () => astroid.agents.get(id as string),
    enabled: Boolean(id),
  });
}

export function useCreateAgent(): UseMutationResult<Agent, Error, CreateAgentParams> {
  const astroid = useAstroidClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: CreateAgentParams) => astroid.agents.create(params),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.agents.all });
    },
  });
}

export function useUpdateAgent(): UseMutationResult<Agent, Error, UpdateAgentVariables> {
  const astroid = useAstroidClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, params }: UpdateAgentVariables) => astroid.agents.update(id, params),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.agents.all });
    },
  });
}

export function useUpdateAgentStatus(): UseMutationResult<Agent, Error, UpdateAgentStatusVariables> {
  const astroid = useAstroidClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, status }: UpdateAgentStatusVariables) => astroid.agents.update(id, { status }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.agents.all });
    },
  });
}

export function useUpdateAgentMetadata(): UseMutationResult<Agent, Error, UpdateAgentMetadataVariables> {
  const astroid = useAstroidClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, metadata }: UpdateAgentMetadataVariables) => astroid.agents.update(id, { metadata }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.agents.all });
    },
  });
}

export function useDeleteAgent(): UseMutationResult<void, Error, string> {
  const astroid = useAstroidClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => astroid.agents.delete(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.agents.all });
    },
  });
}

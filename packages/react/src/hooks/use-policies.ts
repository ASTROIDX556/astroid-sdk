import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { queryKeys, useAstroidClient } from '../hooks.js';
import type { Astroid, PolicyListParams } from '@astroid/client';
import type { Paginated, Policy } from '@astroid/types';

type CreatePolicyInput = Parameters<Astroid['policies']['create']>[0];
type UpdatePolicyInput = Parameters<Astroid['policies']['update']>[1];

/**
 * Fetch a paginated list of policies.
 *
 * @param params Optional enabled/type/agent/wallet filters.
 */
export function usePolicies(params?: PolicyListParams): UseQueryResult<Paginated<Policy>, Error> {
  const astroid = useAstroidClient();
  return useQuery({
    queryKey: queryKeys.policies.list(params),
    queryFn: () => astroid.policies.list(params),
  });
}

/**
 * Fetch a single policy by id. Disabled until a non-empty id is provided.
 */
export function usePolicy(id: string | undefined): UseQueryResult<Policy, Error> {
  const astroid = useAstroidClient();
  return useQuery({
    queryKey: queryKeys.policies.detail(id ?? ''),
    queryFn: () => astroid.policies.get(id as string),
    enabled: Boolean(id),
  });
}

/** Variables for {@link useUpdatePolicy}. */
export interface UpdatePolicyVariables {
  id: string;
  params: UpdatePolicyInput;
}

/**
 * Create a policy. Invalidates the policy domain on success.
 */
export function useCreatePolicy(): UseMutationResult<Policy, Error, CreatePolicyInput> {
  const astroid = useAstroidClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreatePolicyInput) => astroid.policies.create(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.policies.all });
    },
  });
}

/**
 * Update a policy. Invalidates its detail query and the policy domain.
 */
export function useUpdatePolicy(): UseMutationResult<Policy, Error, UpdatePolicyVariables> {
  const astroid = useAstroidClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, params }: UpdatePolicyVariables) => astroid.policies.update(id, params),
    onSuccess: (_data, { id }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.policies.detail(id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.policies.all });
    },
  });
}

/**
 * Delete a policy. Invalidates its detail query and the policy domain.
 */
export function useDeletePolicy(): UseMutationResult<void, Error, string> {
  const astroid = useAstroidClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => astroid.policies.delete(id),
    onSuccess: (_data, id) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.policies.detail(id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.policies.all });
    },
  });
}

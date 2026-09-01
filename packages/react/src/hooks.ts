import { useContext } from 'react';
import { useMutation, useQuery, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query';
import { AstroidClientContext } from './provider.js';
import type { Astroid } from '@astroid/client';
import type {
  Agent,
  Paginated,
  PaginationParams,
  PolicySimulationRequest,
  PolicySimulationResult,
} from '@astroid/types';

export { useCreateAgent, useUpdateAgent, useDeleteAgent } from './hooks/useAgents.js';
export {
  useWallet,
  useWallets,
  useWalletBalance,
  useTransfer,
  useWalletMutation,
  type WalletMutationVariables,
  type WalletMutationResult,
  type TransferVariables,
  type UseWalletBalanceOptions,
} from './hooks/useWallets.js';

/**
 * Retrieve the active {@link Astroid} client instance from the React context.
 *
 * @throws Error if called outside an {@link AstroidProvider}.
 */
export function useAstroid(): Astroid {
  const client = useContext(AstroidClientContext);
  if (!client) {
    throw new Error(
      'useAstroid must be used within an <AstroidProvider>. Wrap your component tree with <AstroidProvider client={client}>.',
    );
  }
  return client;
}

/**
 * Alias for {@link useAstroid} to match naming conventions.
 */
export function useAstroidClient(): Astroid {
  return useAstroid();
}

/**
 * Query key factory for TanStack Query caching and invalidation.
 */
export const queryKeys = {
  wallets: {
    all: ['astroid', 'wallets'] as const,
    list: (params?: PaginationParams) => ['astroid', 'wallets', 'list', params ?? {}] as const,
    detail: (id: string) => ['astroid', 'wallets', 'detail', id] as const,
    balance: (id: string) => ['astroid', 'wallets', 'detail', id, 'balance'] as const,
  },
  agents: {
    all: ['astroid', 'agents'] as const,
    list: (params?: PaginationParams) => ['astroid', 'agents', 'list', params ?? {}] as const,
    detail: (id: string) => ['astroid', 'agents', 'detail', id] as const,
  },
  policies: {
    all: ['astroid', 'policies'] as const,
  },
} as const;

/**
 * Fetch a paginated list of agents.
 */
export function useAgents(params?: PaginationParams): UseQueryResult<Paginated<Agent>, Error> {
  const astroid = useAstroidClient();
  return useQuery({
    queryKey: queryKeys.agents.list(params),
    queryFn: () => astroid.agents.list(params),
  });
}

/**
 * Fetch a single agent by ID.
 */
export function useAgent(id: string | undefined): UseQueryResult<Agent, Error> {
  const astroid = useAstroidClient();
  return useQuery({
    queryKey: queryKeys.agents.detail(id ?? ''),
    queryFn: () => astroid.agents.get(id as string),
    enabled: Boolean(id),
  });
}

/**
 * Mutation hook to simulate a policy against a proposed transaction.
 */
export function useSimulatePolicy(): UseMutationResult<
  PolicySimulationResult,
  Error,
  PolicySimulationRequest
> {
  const astroid = useAstroidClient();
  return useMutation({
    mutationFn: (params: PolicySimulationRequest) => astroid.policies.simulate(params),
  });
}

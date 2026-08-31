import { useContext } from 'react';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { AstroidContext } from './provider.js';
import type { Astroid } from '@astroid/client';
import type { Agent, Paginated, PaginationParams, PolicySimulationRequest, PolicySimulationResult, Wallet } from '@astroid/types';

export { useCreateAgent, useUpdateAgent, useDeleteAgent } from './hooks/useAgents.js';

/**
 * Retrieve the active {@link Astroid} client instance from the React context.
 *
 * @throws Error if called outside an {@link AstroidProvider}.
 */
export function useAstroid(): Astroid {
  const client = useContext(AstroidContext);
  if (!client) {
    throw new Error('useAstroid must be used within an AstroidProvider.');
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
 * Fetch a paginated list of wallets.
 */
export function useWallets(params?: PaginationParams): UseQueryResult<Paginated<Wallet>, Error> {
  const astroid = useAstroidClient();
  return useQuery({
    queryKey: queryKeys.wallets.list(params),
    queryFn: () => astroid.wallets.list(params),
  });
}

/**
 * Fetch a single wallet by ID.
 */
export function useWallet(id: string | undefined): UseQueryResult<Wallet, Error> {
  const astroid = useAstroidClient();
  return useQuery({
    queryKey: queryKeys.wallets.detail(id ?? ''),
    queryFn: () => astroid.wallets.get(id!),
    enabled: Boolean(id),
  });
}

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
    queryFn: () => astroid.agents.get(id!),
    enabled: Boolean(id),
  });
}

/**
 * Mutation hook to simulate a policy against a proposed transaction.
 */
export function useSimulatePolicy() {
  const astroid = useAstroidClient();
  return useQuery({ queryKey: ['astroid', 'policies', 'simulate'] } as any) && {
    mutate: async (params: PolicySimulationRequest): Promise<PolicySimulationResult> => {
      return astroid.policies.simulate(params);
    },
  };
}

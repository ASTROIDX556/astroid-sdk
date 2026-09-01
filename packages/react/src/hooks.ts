import { useContext } from 'react';
import { useMutation, useQuery, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query';
import { AstroidClientContext } from './provider.js';
import type { Astroid } from '@astroid/client';
import type { Agent, Paginated, PaginationParams, PolicySimulationRequest, PolicySimulationResult, Wallet, WalletBalance } from '@astroid/types';

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
    balance: (id: string) => ['astroid', 'wallets', 'balance', id] as const,
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

/** Options for {@link useWalletBalance}. */
export interface UseWalletBalanceOptions {
  /** Poll interval in ms. Defaults to `false` (no polling). */
  pollingInterval?: number;
  /** Stale-time in ms. Defaults to 30_000. */
  staleTime?: number;
  /** Whether the query should run at all. Defaults to `true`. */
  enabled?: boolean;
}

/**
 * Fetch the live on-chain balance of a wallet via TanStack Query.
 *
 * The query is cached under `['astroid', 'wallets', 'balance', id]`, keeps the
 * balance fresh for 30s by default, and supports polling for near real-time
 * subscriptions.
 */
export function useWalletBalance(
  walletId: string | undefined,
  options: UseWalletBalanceOptions = {},
): UseQueryResult<WalletBalance, Error> {
  const astroid = useAstroidClient();
  const { pollingInterval, staleTime = 30_000, enabled = true } = options;
  return useQuery({
    queryKey: queryKeys.wallets.balance(walletId ?? ''),
    queryFn: () => astroid.wallets.balance(walletId!),
    enabled: Boolean(walletId) && enabled,
    staleTime,
    refetchInterval: pollingInterval && pollingInterval > 0 ? pollingInterval : false,
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

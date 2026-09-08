import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { queryKeys, useAstroidClient } from '../hooks.js';
import type {
  CreateWalletInput,
  ImportWalletInput,
  Paginated,
  PaginationParams,
  Transaction,
  TransferInput,
  UpdateWalletInput,
  Wallet,
  WalletBalance,
} from '@astroid/types';

/**
 * Fetch a single wallet by ID.
 *
 * The query is disabled until a non-empty `id` is provided.
 *
 * @param id The wallet ID to fetch, or `undefined` to disable the query.
 * @returns A TanStack Query result with `data` (a {@link Wallet}), `isLoading`,
 *   `error`, etc.
 *
 * @example
 * ```tsx
 * const { data, isLoading } = useWallet('wal_abc123');
 * if (isLoading) return <p>Loading…</p>;
 * return <p>Address: {data?.stellarAddress}</p>;
 * ```
 */
export function useWallet(id: string | undefined): UseQueryResult<Wallet, Error> {
  const astroid = useAstroidClient();
  return useQuery({
    queryKey: queryKeys.wallets.detail(id ?? ''),
    queryFn: () => astroid.wallets.get(id as string),
    enabled: Boolean(id),
  });
}

/**
 * Fetch a paginated list of wallets.
 *
 * @param params Optional pagination and filter parameters.
 * @returns A TanStack Query result with `data` (a {@link Paginated} of
 *   {@link Wallet}), `isLoading`, `error`, etc.
 *
 * @example
 * ```tsx
 * const { data, isLoading } = useWallets({ limit: 25 });
 * if (isLoading) return <p>Loading…</p>;
 * return <ul>{data?.data.map((w) => <li key={w.id}>{w.label}</li>)}</ul>;
 * ```
 */
export function useWallets(params?: PaginationParams): UseQueryResult<Paginated<Wallet>, Error> {
  const astroid = useAstroidClient();
  return useQuery({
    queryKey: queryKeys.wallets.list(params),
    queryFn: () => astroid.wallets.list(params),
  });
}

/** Options for the `useWalletBalance` hook. */
export interface UseWalletBalanceOptions {
  /** Whether the query is enabled. Set to `false` to pause. Defaults to `true`. */
  enabled?: boolean;
  /** Polling interval in milliseconds. Set to `0` or omit to disable polling. */
  refetchInterval?: number;
}

/**
 * Fetch live on-chain balances for a wallet.
 *
 * The query is disabled until a non-empty `walletId` is provided, so the hook
 * is safe to call with an `undefined` id (e.g. while an agent is still being
 * loaded).
 *
 * @param walletId The wallet whose balances to fetch.
 * @param options  Optional enabled flag and polling interval.
 * @returns        A TanStack Query result with `data` (a {@link WalletBalance}),
 *   `isLoading`, `error`, etc.
 *
 * @example
 * ```tsx
 * const { data } = useWalletBalance('wal_abc123', { refetchInterval: 10_000 });
 * return <ul>{data?.balances.map((b) => <li key={b.asset}>{b.asset}: {b.balance}</li>)}</ul>;
 * ```
 */
export function useWalletBalance(
  walletId: string | undefined,
  options: UseWalletBalanceOptions = {},
): UseQueryResult<WalletBalance, Error> {
  const astroid = useAstroidClient();
  const { enabled = true, refetchInterval } = options;

  return useQuery({
    queryKey: queryKeys.wallets.balance(walletId ?? ''),
    queryFn: () => astroid.wallets.balance(walletId as string),
    enabled: Boolean(walletId) && enabled,
    refetchInterval,
  });
}

/** Variables for the `transfer` wallet mutation. */
export interface TransferVariables {
  /** The wallet to transfer from. */
  walletId: string;
  /** The transfer payload (recipient, asset, amount, …). */
  input: TransferInput;
}

/**
 * Mutation hook to initiate a transfer from a wallet.
 *
 * Invalidates the wallet's balance and detail queries on success so balances
 * stay fresh after the transfer lands.
 *
 * @returns A TanStack Query mutation with `mutate({ walletId, input })`,
 *   `isPending`, `error`, etc.
 *
 * @example
 * ```tsx
 * const transfer = useTransfer();
 * transfer.mutate({
 *   walletId: 'wal_abc123',
 *   input: { recipientAddress: 'G…', asset: 'USDC', amount: '10' },
 * });
 * ```
 */
export function useTransfer(): UseMutationResult<Transaction, Error, TransferVariables> {
  const astroid = useAstroidClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ walletId, input }: TransferVariables) => astroid.wallets.transfer(walletId, input),
    onSuccess: (_data, { walletId }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.wallets.balance(walletId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.wallets.detail(walletId) });
    },
  });
}

/**
 * Discriminated union of every wallet mutation the SDK supports. Each member
 * carries exactly the payload its operation needs, so `useWalletMutation` is
 * exhaustively typed per action.
 */
export type WalletMutationVariables =
  | { action: 'create'; input: CreateWalletInput }
  | { action: 'import'; input: ImportWalletInput }
  | { action: 'update'; walletId: string; input: UpdateWalletInput }
  | { action: 'freeze'; walletId: string }
  | { action: 'unfreeze'; walletId: string }
  | { action: 'archive'; walletId: string }
  | { action: 'transfer'; walletId: string; input: TransferInput };

/** The result of a wallet mutation: a {@link Wallet} or a {@link Transaction}. */
export type WalletMutationResult = Wallet | Transaction;

/**
 * Mutation hook covering every wallet operation (create, import, update,
 * freeze, unfreeze, archive, transfer) through a single typed API.
 *
 * On success the wallet list, detail, and balance queries are invalidated so
 * cached data reflects the mutation immediately.
 *
 * @returns A TanStack Query mutation with `mutate(variables)`, `isPending`,
 *   `error`, etc. `variables.action` narrows the payload type.
 *
 * @example
 * ```tsx
 * const walletMutation = useWalletMutation();
 *
 * // Create:
 * walletMutation.mutate({ action: 'create', input: { label: 'Ops' } });
 *
 * // Transfer:
 * walletMutation.mutate({
 *   action: 'transfer',
 *   walletId: 'wal_abc123',
 *   input: { recipientAddress: 'G…', asset: 'USDC', amount: '10' },
 * });
 * ```
 */
export function useWalletMutation(): UseMutationResult<
  WalletMutationResult,
  Error,
  WalletMutationVariables
> {
  const astroid = useAstroidClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (variables: WalletMutationVariables): Promise<WalletMutationResult> => {
      switch (variables.action) {
        case 'create':
          return astroid.wallets.create(variables.input);
        case 'import':
          return astroid.wallets.import(variables.input);
        case 'update':
          return astroid.wallets.update(variables.walletId, variables.input);
        case 'freeze':
          return astroid.wallets.freeze(variables.walletId);
        case 'unfreeze':
          return astroid.wallets.unfreeze(variables.walletId);
        case 'archive':
          return astroid.wallets.archive(variables.walletId);
        case 'transfer':
          return astroid.wallets.transfer(variables.walletId, variables.input);
      }
    },
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.wallets.list() });
      if ('walletId' in variables) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.wallets.detail(variables.walletId),
        });
        void queryClient.invalidateQueries({
          queryKey: queryKeys.wallets.balance(variables.walletId),
        });
      }
    },
  });
}

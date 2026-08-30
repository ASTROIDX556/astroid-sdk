/**
 * `@astroid/react` — React bindings for the Astroid SDK.
 *
 * Wrap your tree in {@link AstroidProvider}, then reach the client from any
 * component with {@link useAstroid}. The read hooks are thin, correctly-keyed
 * wrappers over TanStack Query v5; the mutation hooks invalidate the relevant
 * queries on success so lists stay fresh without manual bookkeeping.
 *
 * ```tsx
 * import { AstroidProvider, useWallets } from '@astroid/react';
 *
 * function App() {
 *   return (
 *     <AstroidProvider config={{ apiKey: process.env.NEXT_PUBLIC_ASTROID_KEY! }}>
 *       <Wallets />
 *     </AstroidProvider>
 *   );
 * }
 *
 * function Wallets() {
 *   const { data, isLoading } = useWallets();
 *   if (isLoading) return <p>Loading…</p>;
 *   return <ul>{data?.data.map((w) => <li key={w.id}>{w.name}</li>)}</ul>;
 * }
 * ```
 *
 * The `"use client"` directive is prepended to the built output by tsup, so this
 * module is safe to import from a React Server Components tree.
 *
 * @packageDocumentation
 */

import { useEffect, useRef } from 'react';
import { useAstroid } from './hooks.js';
export { AstroidProvider, type AstroidProviderProps } from './provider.js';
export { useAstroidClient } from './hooks.js';
export { useAstroid } from './hooks.js';
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationOptions,
  type UseMutationResult,
  type UseQueryOptions,
  type UseQueryResult,
} from '@tanstack/react-query';
import {
  type AgentListParams,
  type BudgetListParams,
  type PolicyListParams,
  type WalletListParams,
} from '@astroid/client';
import type {
  Agent,
  AnalyticsOverview,
  AnalyticsQuery,
  Budget,
  CreateAgentInput,
  CreateWalletInput,
  Notification,
  NotificationListParams,
  Paginated,
  PaymentIntent,
  PaymentIntentResult,
  Policy,
  Transaction,
  TransactionListParams,
  TransferInput,
  Wallet,
  WebhookEventEnvelope,
  WebhookEventName,
} from '@astroid/types';

/* -------------------------------------------------------------------------- */
/*                                  provider                                  */
/* -------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- */
/*                               query key factory                            */
/* -------------------------------------------------------------------------- */

/**
 * Canonical, stable query keys. Every read hook derives its key from here so
 * mutations can invalidate precisely (e.g. `queryKeys.wallets.all`).
 */
export const queryKeys = {
  wallets: {
    all: ['astroid', 'wallets'] as const,
    list: (params?: WalletListParams) => ['astroid', 'wallets', 'list', params ?? {}] as const,
    detail: (id: string) => ['astroid', 'wallets', 'detail', id] as const,
    balance: (id: string) => ['astroid', 'wallets', 'balance', id] as const,
  },
  agents: {
    all: ['astroid', 'agents'] as const,
    list: (params?: AgentListParams) => ['astroid', 'agents', 'list', params ?? {}] as const,
    detail: (id: string) => ['astroid', 'agents', 'detail', id] as const,
  },
  policies: {
    all: ['astroid', 'policies'] as const,
    list: (params?: PolicyListParams) => ['astroid', 'policies', 'list', params ?? {}] as const,
    detail: (id: string) => ['astroid', 'policies', 'detail', id] as const,
  },
  budgets: {
    all: ['astroid', 'budgets'] as const,
    list: (params?: BudgetListParams) => ['astroid', 'budgets', 'list', params ?? {}] as const,
    detail: (id: string) => ['astroid', 'budgets', 'detail', id] as const,
  },
  transactions: {
    all: ['astroid', 'transactions'] as const,
    list: (params?: TransactionListParams) =>
      ['astroid', 'transactions', 'list', params ?? {}] as const,
    detail: (id: string) => ['astroid', 'transactions', 'detail', id] as const,
  },
  notifications: {
    all: ['astroid', 'notifications'] as const,
    list: (params?: NotificationListParams) =>
      ['astroid', 'notifications', 'list', params ?? {}] as const,
    unreadCount: ['astroid', 'notifications', 'unread-count'] as const,
  },
  analytics: {
    overview: (query?: AnalyticsQuery) =>
      ['astroid', 'analytics', 'overview', query ?? {}] as const,
  },
} as const;

/**
 * Extra options forwarded to TanStack Query's `useQuery` for read hooks.
 * Includes `enabled`, `refetchInterval`, `staleTime`, `gcTime`, etc.
 * The `queryKey` and `queryFn` are set internally and cannot be overridden.
 */
type ReadOptions<TData> = Omit<UseQueryOptions<TData, Error, TData>, 'queryKey' | 'queryFn'>;

/* -------------------------------------------------------------------------- */
/*                                 read hooks                                 */
/* -------------------------------------------------------------------------- */

/**
 * Fetch a paginated list of wallets belonging to the current organization.
 *
 * @param params  Optional filters: `page`, `pageSize`, `walletType`, etc.
 * @param options Extra TanStack Query options (`enabled`, `staleTime`, etc.).
 * @returns       A TanStack Query result with `data` (a {@link Paginated} of
 *                {@link Wallet}), `isLoading`, `isError`, `error`, etc.
 *
 * @example
 * ```tsx
 * const { data, isLoading } = useWallets({ page: 1, pageSize: 10 });
 * ```
 */
export function useWallets(
  params?: WalletListParams,
  options?: ReadOptions<Paginated<Wallet>>,
): UseQueryResult<Paginated<Wallet>, Error> {
  const astroid = useAstroid();
  return useQuery({
    queryKey: queryKeys.wallets.list(params),
    queryFn: () => astroid.wallets.list(params),
    ...options,
  });
}

/**
 * Fetch a single wallet by its ID.
 *
 * The query is automatically **disabled** when `id` is `undefined` or empty,
 * so it is safe to pass a conditional value without guarding the render.
 *
 * @param id      The wallet ID to fetch. Pass `undefined` to skip the request.
 * @param options Extra TanStack Query options.
 * @returns       A TanStack Query result with `data` (a {@link Wallet}),
 *                `isLoading`, `isError`, `error`, etc.
 *
 * @example
 * ```tsx
 * const { data: wallet } = useWallet(selectedWalletId);
 * if (wallet) console.log(wallet.name);
 * ```
 */
export function useWallet(
  id: string | undefined,
  options?: ReadOptions<Wallet>,
): UseQueryResult<Wallet, Error> {
  const astroid = useAstroid();
  return useQuery({
    queryKey: queryKeys.wallets.detail(id ?? ''),
    queryFn: () => astroid.wallets.get(id as string),
    enabled: Boolean(id) && options?.enabled !== false,
    ...options,
  });
}

/**
 * Fetch a paginated list of AI agents.
 *
 * @param params  Optional filters: `page`, `pageSize`, `walletId`, etc.
 * @param options Extra TanStack Query options.
 * @returns       A TanStack Query result with `data` (a {@link Paginated} of
 *                {@link Agent}), `isLoading`, `isError`, `error`, etc.
 *
 * @example
 * ```tsx
 * const { data } = useAgents({ walletId: 'wal_123' });
 * ```
 */
export function useAgents(
  params?: AgentListParams,
  options?: ReadOptions<Paginated<Agent>>,
): UseQueryResult<Paginated<Agent>, Error> {
  const astroid = useAstroid();
  return useQuery({
    queryKey: queryKeys.agents.list(params),
    queryFn: () => astroid.agents.list(params),
    ...options,
  });
}

/**
 * Fetch a single AI agent by its ID.
 *
 * The query is automatically **disabled** when `id` is `undefined` or empty.
 *
 * @param id      The agent ID to fetch. Pass `undefined` to skip the request.
 * @param options Extra TanStack Query options.
 * @returns       A TanStack Query result with `data` (an {@link Agent}),
 *                `isLoading`, `isError`, `error`, etc.
 *
 * @example
 * ```tsx
 * const { data: agent } = useAgent(agentId);
 * ```
 */
export function useAgent(
  id: string | undefined,
  options?: ReadOptions<Agent>,
): UseQueryResult<Agent, Error> {
  const astroid = useAstroid();
  return useQuery({
    queryKey: queryKeys.agents.detail(id ?? ''),
    queryFn: () => astroid.agents.get(id as string),
    enabled: Boolean(id) && options?.enabled !== false,
    ...options,
  });
}

/**
 * Fetch a paginated list of spending policies.
 *
 * @param params  Optional filters: `page`, `pageSize`, `type`, `enabled`,
 *                `agentId`, `walletId`, etc.
 * @param options Extra TanStack Query options.
 * @returns       A TanStack Query result with `data` (a {@link Paginated} of
 *                {@link Policy}), `isLoading`, `isError`, `error`, etc.
 *
 * @example
 * ```tsx
 * const { data } = usePolicies({ type: 'MAX_AMOUNT', enabled: true });
 * ```
 */
export function usePolicies(
  params?: PolicyListParams,
  options?: ReadOptions<Paginated<Policy>>,
): UseQueryResult<Paginated<Policy>, Error> {
  const astroid = useAstroid();
  return useQuery({
    queryKey: queryKeys.policies.list(params),
    queryFn: () => astroid.policies.list(params),
    ...options,
  });
}

/**
 * Fetch a paginated list of budgets.
 *
 * @param params  Optional filters: `page`, `pageSize`, `walletId`, etc.
 * @param options Extra TanStack Query options.
 * @returns       A TanStack Query result with `data` (a {@link Paginated} of
 *                {@link Budget}), `isLoading`, `isError`, `error`, etc.
 *
 * @example
 * ```tsx
 * const { data } = useBudgets({ walletId: 'wal_123' });
 * ```
 */
export function useBudgets(
  params?: BudgetListParams,
  options?: ReadOptions<Paginated<Budget>>,
): UseQueryResult<Paginated<Budget>, Error> {
  const astroid = useAstroid();
  return useQuery({
    queryKey: queryKeys.budgets.list(params),
    queryFn: () => astroid.budgets.list(params),
    ...options,
  });
}

/**
 * Fetch a paginated list of transactions.
 *
 * @param params  Optional filters: `page`, `pageSize`, `walletId`,
 *                `status`, etc.
 * @param options Extra TanStack Query options.
 * @returns       A TanStack Query result with `data` (a {@link Paginated} of
 *                {@link Transaction}), `isLoading`, `isError`, `error`, etc.
 *
 * @example
 * ```tsx
 * const { data } = useTransactions({ walletId: 'wal_123', pageSize: 20 });
 * ```
 */
export function useTransactions(
  params?: TransactionListParams,
  options?: ReadOptions<Paginated<Transaction>>,
): UseQueryResult<Paginated<Transaction>, Error> {
  const astroid = useAstroid();
  return useQuery({
    queryKey: queryKeys.transactions.list(params),
    queryFn: () => astroid.transactions.list(params),
    ...options,
  });
}

/**
 * Fetch a paginated list of notifications.
 *
 * @param params  Optional filters: `page`, `pageSize`, `read`, etc.
 * @param options Extra TanStack Query options.
 * @returns       A TanStack Query result with `data` (a {@link Paginated} of
 *                {@link Notification}), `isLoading`, `isError`, `error`, etc.
 *
 * @example
 * ```tsx
 * const { data } = useNotifications({ read: false });
 * ```
 */
export function useNotifications(
  params?: NotificationListParams,
  options?: ReadOptions<Paginated<Notification>>,
): UseQueryResult<Paginated<Notification>, Error> {
  const astroid = useAstroid();
  return useQuery({
    queryKey: queryKeys.notifications.list(params),
    queryFn: () => astroid.notifications.list(params),
    ...options,
  });
}

/**
 * Fetch the count of unread notifications for the current user.
 *
 * Useful for rendering badge indicators (e.g. notification bell count).
 *
 * @param options Extra TanStack Query options.
 * @returns       A TanStack Query result with `data` (a `number`),
 *                `isLoading`, `isError`, `error`, etc.
 *
 * @example
 * ```tsx
 * const { data: count } = useUnreadCount();
 * return <Badge>{count ?? 0}</Badge>;
 * ```
 */
export function useUnreadCount(options?: ReadOptions<number>): UseQueryResult<number, Error> {
  const astroid = useAstroid();
  return useQuery({
    queryKey: queryKeys.notifications.unreadCount,
    queryFn: () => astroid.notifications.unreadCount(),
    ...options,
  });
}

/**
 * Fetch headline analytics (total volume, transaction count, etc.) for a
 * dashboard or reporting view.
 *
 * @param query   Optional filters: date range, wallet ID, agent ID, etc.
 *                See {@link AnalyticsQuery} for the full shape.
 * @param options Extra TanStack Query options.
 * @returns       A TanStack Query result with `data` (an
 *                {@link AnalyticsOverview}), `isLoading`, `isError`, `error`,
 *                etc.
 *
 * @example
 * ```tsx
 * const { data } = useAnalyticsOverview({
 *   startDate: '2026-01-01',
 *   endDate: '2026-01-31',
 * });
 * ```
 */
export function useAnalyticsOverview(
  query?: AnalyticsQuery,
  options?: ReadOptions<AnalyticsOverview>,
): UseQueryResult<AnalyticsOverview, Error> {
  const astroid = useAstroid();
  return useQuery({
    queryKey: queryKeys.analytics.overview(query),
    queryFn: () => astroid.analytics.overview(query),
    ...options,
  });
}

/* -------------------------------------------------------------------------- */
/*                               mutation hooks                               */
/* -------------------------------------------------------------------------- */

/**
 * Extra options forwarded to TanStack Query's `useMutation` for write hooks.
 * Includes `onSuccess`, `onError`, `onSettled`, `retry`, etc. The
 * `mutationFn` is set internally and cannot be overridden.
 */
type WriteOptions<TData, TVars> = Omit<UseMutationOptions<TData, Error, TVars>, 'mutationFn'>;

/**
 * Create a new wallet.
 *
 * Automatically **invalidates all wallet queries** on success so lists and
 * detail views refresh without manual bookkeeping.
 *
 * @param options Extra TanStack Query mutation options (`onSuccess`,
 *                `onError`, `retry`, etc.).
 * @returns       A TanStack Query mutation result with `mutate`,
 *                `mutateAsync`, `isPending`, `isSuccess`, `error`, etc.
 *
 * @example
 * ```tsx
 * const { mutate, isPending } = useCreateWallet();
 *
 * function handleCreate() {
 *   mutate({ name: 'Ops Wallet', walletType: 'CUSTODIAL' });
 * }
 * ```
 */
export function useCreateWallet(
  options?: WriteOptions<Wallet, CreateWalletInput>,
): UseMutationResult<Wallet, Error, CreateWalletInput> {
  const astroid = useAstroid();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateWalletInput) => astroid.wallets.create(input),
    ...options,
    onSuccess: (data, vars, ctx) => {
      void qc.invalidateQueries({ queryKey: queryKeys.wallets.all });
      options?.onSuccess?.(data, vars, ctx);
    },
  });
}

/**
 * Execute a transfer from a specific wallet.
 *
 * Automatically **invalidates all wallet and transaction queries** on success
 * so balances and transaction lists refresh immediately.
 *
 * @param walletId The ID of the wallet to transfer from.
 * @param options  Extra TanStack Query mutation options.
 * @returns        A TanStack Query mutation result with `mutate`,
 *                 `mutateAsync`, `isPending`, `isSuccess`, `error`, etc.
 *
 * @example
 * ```tsx
 * const { mutate } = useTransfer('wal_abc123');
 *
 * function handleSend() {
 *   mutate({
 *     destinationAddress: 'GABC...XYZ',
 *     asset: 'USDC',
 *     amount: '25.00',
 *   });
 * }
 * ```
 */
export function useTransfer(
  walletId: string,
  options?: WriteOptions<Transaction, TransferInput>,
): UseMutationResult<Transaction, Error, TransferInput> {
  const astroid = useAstroid();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: TransferInput) => astroid.wallets.transfer(walletId, input),
    ...options,
    onSuccess: (data, vars, ctx) => {
      void qc.invalidateQueries({ queryKey: queryKeys.wallets.all });
      void qc.invalidateQueries({ queryKey: queryKeys.transactions.all });
      options?.onSuccess?.(data, vars, ctx);
    },
  });
}

/**
 * Create a new AI agent.
 *
 * Automatically **invalidates all agent queries** on success so lists and
 * detail views refresh.
 *
 * @param options Extra TanStack Query mutation options.
 * @returns       A TanStack Query mutation result with `mutate`,
 *                `mutateAsync`, `isPending`, `isSuccess`, `error`, etc.
 *
 * @example
 * ```tsx
 * const { mutate } = useCreateAgent();
 *
 * function handleCreate() {
 *   mutate({ name: 'Payment Bot', walletId: 'wal_abc123' });
 * }
 * ```
 */
export function useCreateAgent(
  options?: WriteOptions<Agent, CreateAgentInput>,
): UseMutationResult<Agent, Error, CreateAgentInput> {
  const astroid = useAstroid();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateAgentInput) => astroid.agents.create(input),
    ...options,
    onSuccess: (data, vars, ctx) => {
      void qc.invalidateQueries({ queryKey: queryKeys.agents.all });
      options?.onSuccess?.(data, vars, ctx);
    },
  });
}

/**
 * The AI-native mutation: submit a high-level financial intent (e.g.
 * "Pay 150 USDC for OpenAI credits"). The backend orchestrates the full
 * workflow — proposal, policy evaluation, risk scoring, transaction — and
 * returns a {@link PaymentIntentResult} whose `outcome` says what happened
 * (`executed`, `pending_approval`, `simulated`, or `rejected`).
 *
 * On an `executed` or `pending_approval` outcome, **transaction and wallet
 * queries are automatically invalidated** so balances reflect the draw.
 *
 * @param options Extra TanStack Query mutation options.
 * @returns       A TanStack Query mutation result with `mutate`,
 *                `mutateAsync`, `isPending`, `isSuccess`, `error`, etc.
 *
 * @example
 * ```tsx
 * const { mutate, data } = useRequestPayment();
 *
 * function handlePay() {
 *   mutate({
 *     intent: 'Purchase OpenAI credits',
 *     amount: 150,
 *     asset: 'USDC',
 *   });
 * }
 *
 * // After mutation completes:
 * if (data?.outcome === 'executed') {
 *   toast.success(data.explanation);
 * }
 * ```
 */
export function useRequestPayment(
  options?: WriteOptions<PaymentIntentResult, PaymentIntent>,
): UseMutationResult<PaymentIntentResult, Error, PaymentIntent> {
  const astroid = useAstroid();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (intent: PaymentIntent) => astroid.ai.requestPayment(intent),
    ...options,
    onSuccess: (data, vars, ctx) => {
      if (data.outcome === 'executed' || data.outcome === 'pending_approval') {
        void qc.invalidateQueries({ queryKey: queryKeys.transactions.all });
        void qc.invalidateQueries({ queryKey: queryKeys.wallets.all });
      }
      options?.onSuccess?.(data, vars, ctx);
    },
  });
}

/* -------------------------------------------------------------------------- */
/*                                event bridge                                */
/* -------------------------------------------------------------------------- */

/**
 * Subscribe a component to an Astroid SDK event for its lifetime. The
 * subscription is automatically cleaned up when the component unmounts.
 *
 * The handler is stored in a ref, so passing a fresh closure each render does
 * **not** cause a re-subscription — the latest handler is always called.
 *
 * @param event   The webhook event name to listen for (e.g.
 *                `'transaction.completed'`, `'wallet.frozen'`).
 * @param handler Called with the typed event data and the full event envelope
 *                every time the event fires.
 *
 * @example
 * ```tsx
 * function TxNotifier() {
 *   useAstroidEvent('transaction.completed', (tx) => {
 *     toast.success(`Transaction ${tx.id} confirmed!`);
 *   });
 *   return null;
 * }
 * ```
 */
export function useAstroidEvent<K extends WebhookEventName>(
  event: K,
  handler: (data: WebhookEventEnvelope<K>['data'], envelope: WebhookEventEnvelope<K>) => void,
): void {
  const astroid = useAstroid();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const off = astroid.on(event, ((data: unknown, envelope: unknown) => {
      (handlerRef.current as (d: unknown, e: unknown) => void)(data, envelope);
    }) as never);
    return off;
  }, [astroid, event]);
}

export { Astroid } from '@astroid/client';

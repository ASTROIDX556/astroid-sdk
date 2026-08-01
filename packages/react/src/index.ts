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

import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';
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
  Astroid,
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

const AstroidContext = createContext<Astroid | null>(null);

/** Props for {@link AstroidProvider}: supply a ready client or a config to build one. */
export type AstroidProviderProps = {
  children: ReactNode;
} & (
  | { client: Astroid; config?: never }
  | { config: ConstructorParameters<typeof Astroid>[0]; client?: never }
);

/**
 * Provides an {@link Astroid} client to the tree. Pass either an existing
 * `client` (recommended if you construct it elsewhere) or a `config` object
 * from which one is memoized. Assumes a TanStack Query `QueryClientProvider`
 * is present higher in the tree.
 */
export function AstroidProvider(props: AstroidProviderProps): ReactNode {
  const { children } = props;
  const client = useMemo(
    () => ('client' in props && props.client ? props.client : new Astroid(props.config)),
    // Rebuild only when the identity of the passed client/config changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    ['client' in props ? props.client : props.config],
  );
  return createElement(AstroidContext.Provider, { value: client }, children);
}

/** Access the {@link Astroid} client from context. Throws if no provider is present. */
export function useAstroid(): Astroid {
  const client = useContext(AstroidContext);
  if (!client) {
    throw new Error('useAstroid must be used within an <AstroidProvider>.');
  }
  return client;
}

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
    overview: (query?: AnalyticsQuery) => ['astroid', 'analytics', 'overview', query ?? {}] as const,
  },
} as const;

/** Extra query options a caller may pass through (everything but key/fn). */
type ReadOptions<TData> = Omit<
  UseQueryOptions<TData, Error, TData>,
  'queryKey' | 'queryFn'
>;

/* -------------------------------------------------------------------------- */
/*                                 read hooks                                 */
/* -------------------------------------------------------------------------- */

/** List wallets. */
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

/** Fetch a single wallet. Disabled until `id` is truthy. */
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

/** List agents. */
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

/** Fetch a single agent. Disabled until `id` is truthy. */
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

/** List policies. */
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

/** List budgets. */
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

/** List transactions. */
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

/** List notifications. */
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

/** The count of unread notifications. */
export function useUnreadCount(
  options?: ReadOptions<number>,
): UseQueryResult<number, Error> {
  const astroid = useAstroid();
  return useQuery({
    queryKey: queryKeys.notifications.unreadCount,
    queryFn: () => astroid.notifications.unreadCount(),
    ...options,
  });
}

/** Headline analytics for the dashboard. */
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

/** Options a caller may pass to a mutation hook (everything but `mutationFn`). */
type WriteOptions<TData, TVars> = Omit<
  UseMutationOptions<TData, Error, TVars>,
  'mutationFn'
>;

/** Create a wallet; invalidates the wallet lists on success. */
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

/** Transfer from a wallet; invalidates wallets and transactions on success. */
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

/** Create an agent; invalidates the agent lists on success. */
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
 * The AI-native mutation: submit a financial intent. On an executed or pending
 * outcome it invalidates transactions and wallets so balances reflect the draw.
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
 * Subscribe a component to a client event for its lifetime. The handler is kept
 * in a ref, so passing a fresh closure each render does not re-subscribe.
 *
 * ```tsx
 * useAstroidEvent('transaction.completed', (tx) => toast(`Sent ${tx.id}`));
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

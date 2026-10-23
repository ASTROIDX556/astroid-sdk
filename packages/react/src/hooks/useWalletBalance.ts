/**
 * `useWalletBalance` — a reactive, cached view of a wallet's on-chain balances.
 *
 * Dashboards and agent UIs need the balance of a wallet to stay current while
 * the user watches it. This hook wraps the `@astroid/wallet` balance resource
 * in a TanStack Query v5 `useQuery`, so the snapshot is fetched once, cached
 * under a key tied to the wallet, and re-fetched on the interval the caller
 * asks for.
 *
 * The wallet may be referenced either by its Astroid id (`wal_…`) **or** by
 * its Stellar public key (`G…`). An address is resolved through
 * `wallets.getByAddress` and the balances are then read for the resolved
 * wallet, so a UI that only holds an on-chain address can still render a
 * balance panel.
 *
 * @module
 */

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { WalletBalance } from '@astroid/wallet';

import { useAstroidClient } from '../hooks.js';

/**
 * Query key factory for the wallet-balance stream.
 *
 * Keys live under the `['astroid', 'wallets', 'balance']` namespace, so
 * `queryClient.invalidateQueries({ queryKey: queryKeys.wallets.all })`
 * invalidates every balance query in the app. An id reference and an address
 * reference deliberately use **different** keys: they are different cache
 * entries, and invalidating one must not evict the other.
 */
export const walletBalanceKeys = {
  /** All wallet-balance queries — invalidate everything from here. */
  all: ['astroid', 'wallets', 'balance'] as const,
  /** The balance stream of one wallet, keyed by its Astroid wallet id. */
  byId: (walletId: string) => ['astroid', 'wallets', 'balance', 'id', walletId] as const,
  /** The balance stream of one wallet, keyed by its Stellar public key. */
  byAddress: (address: string) =>
    ['astroid', 'wallets', 'balance', 'address', address] as const,
} as const;

/** Options for the {@link useWalletBalance} hook. */
export interface UseWalletBalanceOptions {
  /** Whether the query is enabled. Set to `false` to pause. Defaults to `true`. */
  enabled?: boolean;
  /**
   * Polling interval in milliseconds. Omit (or pass `0`) to fetch once and
   * rely on cache invalidation instead.
   */
  refetchInterval?: number;
  /**
   * How long (ms) a fetched balance stays fresh before it is refetched in the
   * background. Defaults to the TanStack Query default.
   */
  staleTime?: number;
  /**
   * Restrict the snapshot to a single asset code (e.g. `'USDC'`).
   *
   * When set — with or without {@link UseWalletBalanceOptions.issuer} — the
   * hook reads through `wallets.getWalletBalances`, the `@astroid/wallet`
   * method that supports asset filtering, instead of the unfiltered
   * `wallets.balance` snapshot.
   */
  assetCode?: string;
  /**
   * Restrict the snapshot to a single asset issuer. Only meaningful together
   * with {@link UseWalletBalanceOptions.assetCode}.
   */
  issuer?: string;
}

/**
 * The result of the {@link useWalletBalance} hook — a narrowed query view.
 *
 * Only the fields a balance panel needs are surfaced, so the hook's contract
 * stays stable even if TanStack Query grows new result properties.
 */
export interface UseWalletBalanceResult {
  /** The latest balance snapshot, or `undefined` while loading. */
  data: WalletBalance | undefined;
  /** `true` while the first fetch is in flight. */
  isLoading: boolean;
  /**
   * `true` while any fetch is in flight — including the background refetches
   * a polling interval triggers. Use it to show a subtle "syncing" hint
   * without hiding the data that is already cached.
   */
  isFetching: boolean;
  /** `true` when the last fetch failed. */
  isError: boolean;
  /** The fetch error, when {@link UseWalletBalanceResult.isError} is `true`. */
  error: Error | null;
  /** Manually trigger a refetch of the balance snapshot. */
  refetch: UseQueryResult<WalletBalance, Error>['refetch'];
}

/**
 * A Stellar public key: a leading `G` followed by 55 base32 characters.
 *
 * Used to tell an address reference apart from an Astroid wallet id, so the
 * hook can resolve it to the wallet it belongs to.
 */
const STELLAR_PUBLIC_KEY_PATTERN = /^G[A-Z2-7]{55}$/;

/**
 * Whether `value` is a Stellar public key (`G…`).
 *
 * @param value The reference to inspect.
 * @returns     `true` when the reference is a Stellar address.
 *
 * @example
 * ```ts
 * isStellarPublicKey('GA7QYNF7SOWQ3GLR2ZGMGIWQFDYQ4RJXGFJQCXVYJ2LGK7IGMSNMIBOA'); // true
 * isStellarPublicKey('wal_abc123'); // false
 * ```
 */
export function isStellarPublicKey(value: string): boolean {
  return STELLAR_PUBLIC_KEY_PATTERN.test(value);
}

/**
 * Fetch live on-chain balances for a wallet.
 *
 * The query is disabled until a non-empty reference is provided, so the hook
 * is safe to call with `undefined` (e.g. while the wallet is still loading).
 * The returned result carries the typed snapshot plus explicit loading and
 * error states, and re-fetches on {@link UseWalletBalanceOptions.refetchInterval}
 * so a live balance panel keeps itself current.
 *
 * @param walletRef The wallet to read — an Astroid wallet id (`wal_…`) or a
 *                  Stellar public key (`G…`). `undefined`/empty disables the query.
 * @param options   Optional polling interval, enabled flag, stale time and
 *                  asset filters.
 * @returns         The balance snapshot, the loading/error states and a
 *                  `refetch` function.
 * @throws          Rejects with an `Error` when the wallet cannot be resolved
 *                  or the balance request fails.
 *
 * @example
 * ```tsx
 * function BalancePanel() {
 *   const { data, isLoading, isError, error, refetch } = useWalletBalance('wal_abc123', {
 *     refetchInterval: 10_000,
 *   });
 *
 *   if (isLoading) return <p>Loading balances…</p>;
 *   if (isError) return <button onClick={() => refetch()}>Retry: {error?.message}</button>;
 *
 *   return (
 *     <ul>
 *       {data?.balances.map((balance) => (
 *         <li key={balance.asset}>{balance.asset}: {balance.balance}</li>
 *       ))}
 *     </ul>
 *   );
 * }
 * ```
 */
export function useWalletBalance(
  walletRef: string | undefined,
  options: UseWalletBalanceOptions = {},
): UseWalletBalanceResult {
  const astroid = useAstroidClient();
  const { enabled = true, refetchInterval, staleTime, assetCode, issuer } = options;

  const reference = walletRef ?? '';
  const isAddress = reference !== '' && isStellarPublicKey(reference);
  const hasAssetFilter = assetCode !== undefined || issuer !== undefined;

  const query = useQuery<WalletBalance, Error>({
    queryKey: isAddress
      ? walletBalanceKeys.byAddress(reference)
      : walletBalanceKeys.byId(reference),
    queryFn: async () => {
      // An address is resolved to its wallet first; an id is used directly.
      const walletId = isAddress
        ? await resolveWalletIdByAddress(astroid, reference)
        : reference;

      if (hasAssetFilter) {
        // The `@astroid/wallet` balance reader that supports asset filters.
        return astroid.wallets.getWalletBalances(walletId, {
          ...(assetCode !== undefined ? { assetCode } : {}),
          ...(issuer !== undefined ? { issuer } : {}),
        });
      }

      return astroid.wallets.balance(walletId);
    },
    enabled: reference !== '' && enabled,
    refetchInterval,
    staleTime,
  });

  return {
    data: query.data,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}

/**
 * Resolve a Stellar public key to the Astroid wallet that owns it.
 *
 * @throws {Error} When no wallet is bound to the address.
 */
async function resolveWalletIdByAddress(
  astroid: ReturnType<typeof useAstroidClient>,
  address: string,
): Promise<string> {
  const wallet = await astroid.wallets.getByAddress(address);
  if (!wallet) {
    throw new Error(`Wallet not found for address: ${address}`);
  }
  return wallet.id;
}

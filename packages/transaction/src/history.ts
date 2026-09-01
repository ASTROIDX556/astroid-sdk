/**
 * Transaction history listing helpers.
 *
 * Cursor-based (keyset) pagination helpers for querying transaction records
 * without loading everything into memory: page through a history with
 * `limit` / `cursor` / `order`, and filter by status or asset. Successive
 * pages are fetched by passing the returned `nextCursor` back in.
 *
 * @module
 */

import type {
  CursorPaginationParams,
  CursorPaginated,
  Transaction,
  TransactionStatus,
} from '@astroid/types';

/* -------------------------------------------------------------------------- */
/* Public types                                                                */
/* -------------------------------------------------------------------------- */

/** Maximum page size enforced by the helper. */
export const HISTORY_MAX_LIMIT = 100;

/** Default page size when none is supplied. */
export const HISTORY_DEFAULT_LIMIT = 20;

/** Status aliases accepted in queries, mapped to `TransactionStatus` values. */
const STATUS_ALIASES: Record<string, TransactionStatus> = {
  pending: 'PENDING',
  successful: 'COMPLETED',
  failed: 'FAILED',
};

/** Accepted status filter: enum values or the `pending`/`successful`/`failed` aliases. */
export type TransactionHistoryStatusFilter =
  | TransactionStatus
  | 'pending'
  | 'successful'
  | 'failed';

/** Query parameters for the transaction history listing. */
export interface TransactionHistoryParams extends CursorPaginationParams {
  /** One or more transaction statuses to include. */
  status?: TransactionHistoryStatusFilter | TransactionHistoryStatusFilter[];
  /** Filter to a specific asset symbol (e.g. `USDC` or `USDC:G...Issuer`). */
  asset?: string;
  /** Filter to transactions sent to this recipient address. */
  recipientAddress?: string;
  /** Filter to transactions sent from this sender address. */
  senderAddress?: string;
  /** Filter to transactions belonging to this wallet. */
  walletId?: string;
}

/** A normalized, validated history query ready to be sent to the API. */
export interface TransactionHistoryQuery {
  limit: number;
  cursor?: string;
  order: 'asc' | 'desc';
  status: TransactionStatus[];
  asset?: string;
  recipientAddress?: string;
  senderAddress?: string;
  walletId?: string;
}

/** A raw page returned by the underlying fetch mechanism. */
export interface TransactionHistoryPage {
  data: Transaction[];
  /** Opaque cursor for the next page, or `null`/omitted when there are none. */
  nextCursor?: string | null;
  /** Whether more pages follow this one. Inferred from `nextCursor` when omitted. */
  hasMore?: boolean;
}

/** A normalized page of transaction history. */
export type TransactionHistoryResult = CursorPaginated<Transaction>;

/** Signature of the underlying page-fetching mechanism. */
export type TransactionHistoryFetcher = (
  query: TransactionHistoryQuery,
) => Promise<TransactionHistoryPage>;

/* -------------------------------------------------------------------------- */
/* Query building                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Validate and normalize raw history parameters into a `TransactionHistoryQuery`.
 *
 * - `limit` is clamped to the `[1, HISTORY_MAX_LIMIT]` range (default 20).
 * - `order` defaults to `'desc'` (newest first).
 * - `status` aliases (`pending` / `successful` / `failed`) are mapped to their
 *   `TransactionStatus` enum values; unknown values are dropped.
 *
 * @param params Raw history parameters from the caller.
 * @returns       A normalized, API-ready query.
 */
export function buildTransactionHistoryQuery(
  params: TransactionHistoryParams = {},
): TransactionHistoryQuery {
  const rawLimit = params.limit ?? HISTORY_DEFAULT_LIMIT;
  const limit = Math.min(Math.max(1, Math.floor(rawLimit)), HISTORY_MAX_LIMIT);

  const order = params.order === 'asc' ? 'asc' : 'desc';

  const rawStatuses =
    params.status === undefined
      ? []
      : Array.isArray(params.status)
        ? params.status
        : [params.status];
  const status = rawStatuses
    .map((value) => STATUS_ALIASES[value] ?? (value as TransactionStatus))
    .filter((value, index, all) => all.indexOf(value) === index); // dedupe, keep order

  return {
    limit,
    ...(params.cursor !== undefined ? { cursor: params.cursor } : {}),
    order,
    status,
    ...(params.asset !== undefined ? { asset: params.asset } : {}),
    ...(params.recipientAddress !== undefined ? { recipientAddress: params.recipientAddress } : {}),
    ...(params.senderAddress !== undefined ? { senderAddress: params.senderAddress } : {}),
    ...(params.walletId !== undefined ? { walletId: params.walletId } : {}),
  };
}

/* -------------------------------------------------------------------------- */
/* Fetching                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Fetch a page of transaction history through the provided fetch mechanism.
 *
 * The raw page's `hasMore` is inferred from `nextCursor` when not supplied, so
 * callers can return just `{ data, nextCursor }` and still get correct paging.
 *
 * @param fetch  The underlying page-fetching mechanism (client call).
 * @param params History query parameters.
 * @returns      A normalized page with items, `nextCursor`, and `hasMore`.
 *
 * @example
 * ```ts
 * const page = await fetchTransactionHistory(
 *   (query) => client.get('/transactions/history', { query }),
 *   { limit: 50, status: 'pending', asset: 'USDC' },
 * );
 * const next = await fetchTransactionHistory(fetch, { cursor: page.nextCursor });
 * ```
 */
export async function fetchTransactionHistory(
  fetch: TransactionHistoryFetcher,
  params: TransactionHistoryParams = {},
): Promise<TransactionHistoryResult> {
  const query = buildTransactionHistoryQuery(params);
  const page = await fetch(query);

  const nextCursor = page.nextCursor ?? null;
  const hasMore = page.hasMore ?? nextCursor !== null;

  return {
    items: page.data,
    nextCursor,
    hasMore,
  };
}

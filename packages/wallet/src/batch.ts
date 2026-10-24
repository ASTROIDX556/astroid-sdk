/**
 * Batch wallet balance query helper (issue #461).
 *
 * Allows agent runtimes to retrieve live Stellar asset balances across multiple
 * managed agent wallets in a single optimized backend call, reducing round-trip
 * latency and Horizon rate-limit pressure.
 *
 * @module
 */

import type { HttpClient, QueryValue, RequestOptionsExtras } from '@astroid/core';
import { ValidationError } from '@astroid/errors';
import type {
  AssetBalance,
  BatchWalletBalancesResult,
  WalletBalanceBatchFilter,
} from '@astroid/types';

/**
 * Structural duck-typing contract for any Astroid SDK client, resource or transport
 * capable of executing HTTP requests.
 */
export type BatchClientLike =
  | HttpClient
  | { readonly http: HttpClient }
  | { readonly client: HttpClient }
  | { readonly wallets: { readonly client: HttpClient } | unknown }
  | {
      post<T>(path: string, body?: unknown, options?: RequestOptionsExtras): Promise<{ data: T }>;
      get<T>(path: string, options?: RequestOptionsExtras): Promise<{ data: T }>;
    };

/**
 * Options accepted by {@link fetchWalletBalancesBatch}.
 */
export interface BatchWalletBalancesOptions extends RequestOptionsExtras {
  /**
   * Optional client instance to execute the request against when calling
   * {@link fetchWalletBalancesBatch} without providing a client as the first argument.
   */
  client?: BatchClientLike;
  /**
   * API endpoint route prefix or path override (default: `'/wallets/balances/batch'`).
   */
  path?: string;
  /**
   * HTTP method to use for the batch query (default: `'POST'`).
   */
  method?: 'POST' | 'GET';
  /**
   * Optional custom URL query parameters.
   */
  query?: Record<string, QueryValue>;
}

/**
 * Extract an active {@link HttpClient} from a variety of client-like objects.
 *
 * Supports raw `HttpClient` instances, top-level `Astroid` instances (`astroid.http`),
 * resource instances (`wallets.client`), and client containers (`astroid.wallets`).
 *
 * @param input The candidate client object.
 * @returns The resolved {@link HttpClient}.
 * @throws {ValidationError} When the input is not a recognized client structure.
 */
export function resolveHttpClient(input: unknown): HttpClient {
  if (!input || typeof input !== 'object') {
    throw new ValidationError(
      'A valid Astroid client, HttpClient, or WalletResource is required to execute batch wallet queries.',
      { code: 'CLIENT_REQUIRED' },
    );
  }

  // 1. Direct HttpClient (has post, get, and request methods)
  if (
    'post' in input &&
    typeof (input as { post: unknown }).post === 'function' &&
    'get' in input &&
    typeof (input as { get: unknown }).get === 'function' &&
    'request' in input &&
    typeof (input as { request: unknown }).request === 'function'
  ) {
    return input as HttpClient;
  }

  // 2. Top-level Astroid client with `.http` property
  if ('http' in input && input.http && typeof input.http === 'object') {
    return resolveHttpClient(input.http);
  }

  // 3. Resource instance with protected/public `.client` property
  if ('client' in input && input.client && typeof input.client === 'object') {
    return resolveHttpClient(input.client);
  }

  // 4. Client container with `.wallets` namespace
  if ('wallets' in input && input.wallets && typeof input.wallets === 'object') {
    return resolveHttpClient(input.wallets);
  }

  // 5. Generic duck-typed transport with post and get methods
  if (
    'post' in input &&
    typeof (input as { post: unknown }).post === 'function' &&
    'get' in input &&
    typeof (input as { get: unknown }).get === 'function'
  ) {
    return input as HttpClient;
  }

  throw new ValidationError('Unable to extract HttpClient from provided client object.', {
    code: 'INVALID_CLIENT',
  });
}

/**
 * Parse and normalize arbitrary batch balance API responses into a strongly typed
 * mapping of Stellar wallet addresses to {@link AssetBalance} arrays.
 *
 * Handles both direct dictionary responses (`{ [address: string]: AssetBalance[] }`)
 * and collection responses (`WalletBalance[]` / `{ balances: ... }`), as well
 * as enveloped responses (`{ data: ... }`).
 *
 * @param data Raw response payload from the API.
 * @returns Strongly typed mapping of wallet addresses to asset balance arrays.
 */
export function parseBatchBalancesResponse(data: unknown): BatchWalletBalancesResult {
  const result: BatchWalletBalancesResult = {};
  if (!data || typeof data !== 'object') {
    return result;
  }

  // Case 1: Array response (e.g. array of WalletBalance objects)
  const listCandidate = Array.isArray(data)
    ? data
    : Array.isArray((data as Record<string, unknown>).wallets)
      ? ((data as Record<string, unknown>).wallets as unknown[])
      : Array.isArray((data as Record<string, unknown>).items)
        ? ((data as Record<string, unknown>).items as unknown[])
        : Array.isArray((data as Record<string, unknown>).balances)
          ? ((data as Record<string, unknown>).balances as unknown[])
          : Array.isArray((data as Record<string, unknown>).data)
            ? ((data as Record<string, unknown>).data as unknown[])
            : null;

  if (listCandidate !== null) {
    for (const item of listCandidate) {
      if (item && typeof item === 'object') {
        const candidate = item as {
          stellarAddress?: unknown;
          address?: unknown;
          walletId?: unknown;
          balances?: unknown;
        };

        const address =
          typeof candidate.stellarAddress === 'string' && candidate.stellarAddress.trim() !== ''
            ? candidate.stellarAddress
            : typeof candidate.address === 'string' && candidate.address.trim() !== ''
              ? candidate.address
              : typeof candidate.walletId === 'string' && candidate.walletId.trim() !== ''
                ? candidate.walletId
                : undefined;

        if (address && Array.isArray(candidate.balances)) {
          result[address] = candidate.balances as AssetBalance[];
        }
      }
    }
    return result;
  }

  // Case 2: Object dictionary mapping
  const container = data as Record<string, unknown>;
  const nested =
    container.balances &&
    typeof container.balances === 'object' &&
    !Array.isArray(container.balances)
      ? (container.balances as Record<string, unknown>)
      : container.data && typeof container.data === 'object' && !Array.isArray(container.data)
        ? (container.data as Record<string, unknown>)
        : container;

  for (const [key, value] of Object.entries(nested)) {
    if (Array.isArray(value)) {
      result[key] = value as AssetBalance[];
    } else if (
      value &&
      typeof value === 'object' &&
      'balances' in value &&
      Array.isArray((value as { balances: unknown }).balances)
    ) {
      result[key] = (value as { balances: AssetBalance[] }).balances;
    }
  }

  return result;
}

/**
 * Fetch live Stellar asset balances across multiple managed wallets in a single
 * optimized batch request.
 *
 * @param client    The Astroid client, HttpClient, or WalletResource instance.
 * @param walletIds Array of wallet identifiers (Astroid wallet IDs or Stellar addresses).
 * @param filters   Optional asset filters (assetCode, issuer, assets list).
 * @param options   Optional request options (path, method, headers, timeout).
 * @returns         A strongly typed mapping of wallet addresses to asset balance arrays.
 *
 * @example
 * ```ts
 * import { fetchWalletBalancesBatch } from '@astroid/wallet';
 *
 * const balances = await fetchWalletBalancesBatch(
 *   astroid,
 *   ['wlt_1', 'wlt_2'],
 *   { assetCode: 'USDC' },
 * );
 * console.log(balances['GA7QYNF7SOWQ3GLR2ZGMGIWQFDYQ4RJXGFJQCXVYJ2LGK7IGMSNMIBOA']);
 * ```
 */
export async function fetchWalletBalancesBatch(
  client: BatchClientLike,
  walletIds: readonly string[],
  filters?: WalletBalanceBatchFilter,
  options?: BatchWalletBalancesOptions,
): Promise<BatchWalletBalancesResult>;

/**
 * Fetch live Stellar asset balances across multiple managed wallets in a single
 * optimized batch request (standalone overload with client in options).
 *
 * @param walletIds Array of wallet identifiers (Astroid wallet IDs or Stellar addresses).
 * @param filters   Optional asset filters (assetCode, issuer, assets list).
 * @param options   Optional request options (must include `client`).
 * @returns         A strongly typed mapping of wallet addresses to asset balance arrays.
 *
 * @example
 * ```ts
 * import { fetchWalletBalancesBatch } from '@astroid/wallet';
 *
 * const balances = await fetchWalletBalancesBatch(
 *   ['wlt_1', 'wlt_2'],
 *   { assetCode: 'USDC' },
 *   { client: astroid },
 * );
 * ```
 */
export async function fetchWalletBalancesBatch(
  walletIds: readonly string[],
  filters?: WalletBalanceBatchFilter,
  options?: BatchWalletBalancesOptions,
): Promise<BatchWalletBalancesResult>;

export async function fetchWalletBalancesBatch(
  first: BatchClientLike | readonly string[],
  second?: readonly string[] | WalletBalanceBatchFilter,
  third?: WalletBalanceBatchFilter | BatchWalletBalancesOptions,
  fourth?: BatchWalletBalancesOptions,
): Promise<BatchWalletBalancesResult> {
  let clientArg: BatchClientLike | undefined;
  let rawWalletIds: readonly string[];
  let filters: WalletBalanceBatchFilter | undefined;
  let options: BatchWalletBalancesOptions | undefined;

  if (Array.isArray(first)) {
    // Signature: (walletIds, filters?, options?)
    rawWalletIds = first;
    filters = second as WalletBalanceBatchFilter | undefined;
    options = third as BatchWalletBalancesOptions | undefined;
    clientArg = options?.client;
  } else {
    // Signature: (client, walletIds, filters?, options?)
    clientArg = first as BatchClientLike;
    rawWalletIds = (second as readonly string[]) ?? [];
    filters = third as WalletBalanceBatchFilter | undefined;
    options = fourth;
  }

  if (!Array.isArray(rawWalletIds)) {
    throw new ValidationError('walletIds must be an array of wallet identifiers.', {
      code: 'INVALID_WALLET_BATCH',
    });
  }

  // An empty batch requires no remote network calls and returns an empty mapping.
  if (rawWalletIds.length === 0) {
    return {};
  }

  // Validate that every wallet identifier is a non-empty string.
  for (const id of rawWalletIds) {
    if (typeof id !== 'string' || id.trim() === '') {
      throw new ValidationError('Each wallet identifier must be a non-empty string.', {
        code: 'INVALID_WALLET_BATCH',
      });
    }
  }

  const httpClient = resolveHttpClient(clientArg);
  const path = options?.path ?? '/wallets/balances/batch';
  const method = options?.method ?? 'POST';
  const uniqueWalletIds = Array.from(new Set(rawWalletIds));

  if (method === 'GET') {
    const query: Record<string, QueryValue> = {
      walletIds: uniqueWalletIds.join(','),
      ...(filters?.assetCode !== undefined ? { assetCode: filters.assetCode } : {}),
      ...(filters?.issuer !== undefined ? { issuer: filters.issuer } : {}),
      ...(filters?.assets !== undefined ? { assets: filters.assets.join(',') } : {}),
      ...(options?.query ?? {}),
    };

    const res = await httpClient.get<unknown>(path, {
      ...options,
      query,
    });
    return parseBatchBalancesResponse(res.data);
  }

  const body: Record<string, unknown> = {
    walletIds: uniqueWalletIds,
    ...(filters?.assetCode !== undefined ? { assetCode: filters.assetCode } : {}),
    ...(filters?.issuer !== undefined ? { issuer: filters.issuer } : {}),
    ...(filters?.assets !== undefined ? { assets: filters.assets } : {}),
  };

  const res = await httpClient.post<unknown>(path, body, options);
  return parseBatchBalancesResponse(res.data);
}

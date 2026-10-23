/**
 * Pagination serialization and helper utilities for @astroid/client.
 *
 * Standardizes cursor/offset pagination across every Astroid list endpoint
 * (transactions, agents, audit logs, …):
 *
 * - {@link PaginationParams} / {@link PaginatedResponse} are re-exported here
 *   so consumers only need `@astroid/client`.
 * - Request builders ({@link serializePaginationParams},
 *   {@link buildPaginationQuery}, {@link buildPaginationQueryString},
 *   {@link resolvePaginationParams}) clamp `limit` into `[1, 200]` and drop
 *   empty/invalid values so query strings never contain `""` or dangling
 *   `&` / `?` segments.
 * - Response helpers ({@link extractPaginationCursors},
 *   {@link extractNextCursor}, {@link extractPrevCursor},
 *   {@link normalizePaginatedResponse}) read `next_cursor` / `prev_cursor`
 *   response headers (and body `meta`) gracefully — missing or malformed
 *   headers yield `null` instead of throwing.
 */

import type { PaginatedResponse, PaginationParams, ResponseMeta } from '@astroid/types';
import type { QueryValue } from '@astroid/core';

export type { PaginatedResponse, PaginationParams };
export type { ResponseMeta };

/** Minimum page size accepted by the Astroid API. */
export const MIN_PAGE_LIMIT = 1;

/** Maximum page size accepted by the Astroid API. */
export const MAX_PAGE_LIMIT = 200;

/** Default page size used when no explicit `limit` is supplied. */
export const DEFAULT_PAGE_LIMIT = 20;

/** Default sort direction for paginated list endpoints. */
export const DEFAULT_PAGE_ORDER: PaginationParams['order'] = 'desc';

/** Default pagination options applied by {@link resolvePaginationParams}. */
export const DEFAULT_PAGINATION_PARAMS: Readonly<
  Required<Pick<PaginationParams, 'limit' | 'order'>>
> = {
  limit: DEFAULT_PAGE_LIMIT,
  order: DEFAULT_PAGE_ORDER,
} as const;

/**
 * Clamp a raw `limit` value into the API-supported range `[1, 200]`.
 *
 * - `undefined` / `null` stay `undefined` (caller decides whether to apply a
 *   default via {@link resolvePaginationParams}).
 * - Non-numeric, non-finite (`NaN`, `Infinity`), or non-positive values are
 *   clamped to the nearest bound instead of throwing.
 * - Fractional values are floored to an integer before clamping.
 *
 * @param limit Raw limit supplied by the caller.
 * @returns The clamped limit, or `undefined` when no limit was supplied.
 */
export function clampPaginationLimit(limit: unknown): number | undefined {
  if (limit === undefined || limit === null) return undefined;
  const numeric = typeof limit === 'string' && limit.trim() !== '' ? Number(limit) : limit;
  if (typeof numeric !== 'number' || !Number.isFinite(numeric)) return undefined;
  const floored = Math.floor(numeric);
  if (!Number.isFinite(floored)) return undefined;
  if (floored < MIN_PAGE_LIMIT) return MIN_PAGE_LIMIT;
  if (floored > MAX_PAGE_LIMIT) return MAX_PAGE_LIMIT;
  return floored;
}

/**
 * Validate a raw `order` value, returning only `'asc'` / `'desc'`.
 *
 * Any other value (including wrong case, empty strings, non-strings) yields
 * `undefined` so serializers omit it instead of sending an invalid query.
 */
export function normalizePaginationOrder(order: unknown): PaginationParams['order'] | undefined {
  if (order === 'asc' || order === 'desc') return order;
  return undefined;
}

/**
 * Normalize a raw cursor value: trims whitespace and drops empty values.
 *
 * @returns The trimmed cursor, or `undefined` when empty/missing/invalid.
 */
export function normalizePaginationCursor(cursor: unknown): string | undefined {
  if (typeof cursor !== 'string') return undefined;
  const trimmed = cursor.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Merge caller-supplied pagination params with SDK defaults.
 *
 * - `limit` is clamped into `[1, 200]`; when omitted and `applyDefaults` is
 *   true (default), {@link DEFAULT_PAGE_LIMIT} is used.
 * - `order` falls back to {@link DEFAULT_PAGE_ORDER} when omitted/invalid and
 *   `applyDefaults` is true; otherwise invalid values are dropped.
 * - Empty cursors are dropped; `page` values below 1 are clamped to 1 and
 *   fractional pages are floored.
 *
 * Never throws — malformed inputs are omitted or clamped.
 */
export function resolvePaginationParams(
  params?: PaginationParams | null,
  options?: { applyDefaults?: boolean },
): PaginationParams {
  const applyDefaults = options?.applyDefaults ?? true;
  if (!params) {
    return applyDefaults ? { ...DEFAULT_PAGINATION_PARAMS } : {};
  }
  const out: PaginationParams = {};

  const cursor = normalizePaginationCursor(params.cursor);
  if (cursor !== undefined) out.cursor = cursor;

  const clamped = clampPaginationLimit(params.limit);
  if (clamped !== undefined) {
    out.limit = clamped;
  } else if (applyDefaults) {
    out.limit = DEFAULT_PAGE_LIMIT;
  }

  const order = normalizePaginationOrder(params.order);
  if (order !== undefined) {
    out.order = order;
  } else if (applyDefaults && params.order === undefined) {
    out.order = DEFAULT_PAGE_ORDER;
  }

  if (params.page !== undefined && params.page !== null) {
    const numeric = typeof params.page === 'number' ? params.page : Number(params.page);
    if (Number.isFinite(numeric)) {
      const floored = Math.floor(numeric);
      if (floored >= 1) out.page = floored;
      else if (floored < 1 && Number.isFinite(floored)) out.page = 1;
    }
  }

  return out;
}

/**
 * Serializes standard pagination parameters into a query parameter record.
 *
 * `limit` is clamped into `[1, 200]`; empty cursors and invalid `order`
 * values are omitted. Never throws on malformed input.
 */
export function serializePaginationParams(
  params?: PaginationParams | null,
): Record<string, QueryValue> {
  if (!params) {
    return {};
  }
  const query: Record<string, QueryValue> = {};
  const cursor = normalizePaginationCursor(params.cursor);
  if (cursor !== undefined) {
    query['cursor'] = cursor;
  }
  const limit = clampPaginationLimit(params.limit);
  if (limit !== undefined) {
    query['limit'] = limit;
  }
  const order = normalizePaginationOrder(params.order);
  if (order !== undefined) {
    query['order'] = order;
  }
  if (params.page !== undefined && params.page !== null) {
    const numeric = typeof params.page === 'number' ? params.page : Number(params.page);
    if (Number.isFinite(numeric)) {
      const floored = Math.floor(numeric);
      query['page'] = floored >= 1 ? floored : 1;
    }
  }
  return query;
}

/**
 * Build a {@link URLSearchParams} instance from standard pagination
 * parameters.
 *
 * Values that are `undefined`, `null`, or an empty string are omitted entirely,
 * so the resulting query never contains literal `""` or dangling `&` / `?`
 * segments. Numeric values are serialised as strings, and `order` is encoded as
 * `asc` / `desc`.
 *
 * @param params Pagination parameters (`cursor`, `limit`, `order`, `page`).
 * @returns A populated `URLSearchParams` (empty when nothing is set).
 *
 * @example
 * ```ts
 * import { buildPaginationQuery } from '@astroid/client';
 *
 * buildPaginationQuery({ cursor: 'cur_1', limit: 50, order: 'desc' }).toString();
 * // => 'cursor=cur_1&limit=50&order=desc'
 *
 * buildPaginationQuery({ cursor: undefined, limit: undefined }).toString();
 * // => ''
 * ```
 */
export function buildPaginationQuery(params?: PaginationParams | null): URLSearchParams {
  const search = new URLSearchParams();
  if (!params) {
    return search;
  }
  const cursor = normalizePaginationCursor(params.cursor);
  if (cursor !== undefined) {
    search.set('cursor', cursor);
  }
  const limit = clampPaginationLimit(params.limit);
  if (limit !== undefined) {
    search.set('limit', String(limit));
  }
  const order = normalizePaginationOrder(params.order);
  if (order !== undefined) {
    search.set('order', order);
  }
  if (params.page !== undefined && params.page !== null) {
    const numeric = typeof params.page === 'number' ? params.page : Number(params.page);
    if (Number.isFinite(numeric)) {
      const floored = Math.floor(numeric);
      search.set('page', String(floored >= 1 ? floored : 1));
    }
  }
  return search;
}

/**
 * Build a URL-encoded pagination query string, including the leading `?`.
 *
 * Returns an empty string when no pagination parameters are set, so it can be
 * concatenated onto a path unconditionally.
 *
 * @param params Pagination parameters (`cursor`, `limit`, `order`, `page`).
 * @returns A query string such as `?cursor=cur_1&limit=50`, or `''`.
 *
 * @example
 * ```ts
 * buildPaginationQueryString({ limit: 25 }); // => '?limit=25'
 * buildPaginationQueryString(); // => ''
 * ```
 */
export function buildPaginationQueryString(params?: PaginationParams | null): string {
  const serialized = buildPaginationQuery(params).toString();
  return serialized ? `?${serialized}` : '';
}

/**
 * Unwraps a paginated response envelope into its item array.
 *
 * Never throws: a missing/null envelope or a non-array `data` yields `[]`
 * (covers empty response lists gracefully).
 */
export function unwrapPaginatedResponse<T>(response: PaginatedResponse<T> | null | undefined): T[] {
  if (!response) return [];
  const data = (response as Partial<PaginatedResponse<T>>).data;
  return Array.isArray(data) ? data : [];
}

/* -------------------------------------------------------------------------- */
/* Pagination response-header extractors                                       */
/* -------------------------------------------------------------------------- */

/** Header shapes accepted by the pagination header extractors. */
export type PaginationHeadersInput =
  | Headers
  | Record<string, string | string[] | number | null | undefined>
  | null
  | undefined;

/** Cursors extracted from `next_cursor` / `prev_cursor` response headers. */
export interface PaginationCursors {
  /** Value of the `next_cursor` header, or `null` when absent/empty/malformed. */
  nextCursor: string | null;
  /** Value of the `prev_cursor` header, or `null` when absent/empty/malformed. */
  prevCursor: string | null;
}

/** Header names probed (in order) for the "next" cursor. */
const NEXT_CURSOR_HEADER_NAMES = [
  'next_cursor',
  'x-next-cursor',
  'next-cursor',
  'x-next_cursor',
  'nextcursor',
] as const;

/** Header names probed (in order) for the "previous" cursor. */
const PREV_CURSOR_HEADER_NAMES = [
  'prev_cursor',
  'x-prev-cursor',
  'prev-cursor',
  'x-prev_cursor',
  'prevcursor',
] as const;

function normalizeHeaderValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    for (const entry of value) {
      const normalized = normalizeHeaderValue(entry);
      if (normalized !== null) return normalized;
    }
    return null;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : null;
  }
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readHeader(headers: PaginationHeadersInput, names: readonly string[]): string | null {
  if (!headers) return null;
  try {
    if (typeof Headers !== 'undefined' && headers instanceof Headers) {
      for (const name of names) {
        const raw = headers.get(name);
        const normalized = normalizeHeaderValue(raw);
        if (normalized !== null) return normalized;
      }
      return null;
    }
    if (typeof headers === 'object') {
      const lowered: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(headers)) {
        lowered[key.toLowerCase()] = value;
      }
      for (const name of names) {
        if (name.toLowerCase() in lowered) {
          const normalized = normalizeHeaderValue(lowered[name.toLowerCase()]);
          if (normalized !== null) return normalized;
        }
      }
      return null;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Extract `next_cursor` / `prev_cursor` pagination cursors from response headers.
 *
 * Header lookup is case-insensitive and tolerates `Headers` instances as well
 * as plain records (including array values, which use the first non-empty
 * entry). Missing, empty, or malformed headers yield `null` — never throws.
 */
export function extractPaginationCursors(headers: PaginationHeadersInput): PaginationCursors {
  return {
    nextCursor: readHeader(headers, NEXT_CURSOR_HEADER_NAMES),
    prevCursor: readHeader(headers, PREV_CURSOR_HEADER_NAMES),
  };
}

/**
 * Extract the `next_cursor` response header.
 *
 * @returns The cursor, or `null` when the header is missing/empty/malformed.
 */
export function extractNextCursor(headers: PaginationHeadersInput): string | null {
  return readHeader(headers, NEXT_CURSOR_HEADER_NAMES);
}

/**
 * Extract the `prev_cursor` response header.
 *
 * @returns The cursor, or `null` when the header is missing/empty/malformed.
 */
export function extractPrevCursor(headers: PaginationHeadersInput): string | null {
  return readHeader(headers, PREV_CURSOR_HEADER_NAMES);
}

/** Whether a `next_cursor` header is present (i.e. another page may follow). */
export function hasNextPage(headers: PaginationHeadersInput): boolean {
  return extractNextCursor(headers) !== null;
}

/** Whether a `prev_cursor` header is present (i.e. a prior page exists). */
export function hasPrevPage(headers: PaginationHeadersInput): boolean {
  return extractPrevCursor(headers) !== null;
}

/**
 * Merge pagination signals from response headers and a body `meta` object.
 *
 * Header cursors win over `meta.nextCursor` / `meta.prevCursor` / `meta.cursor`
 * when both are present; a missing/empty result normalizes to `null`.
 * `items` is always an array (non-array `data` becomes `[]`), so empty
 * response lists never throw.
 */
export function normalizePaginatedResponse<T>(
  data: unknown,
  meta?: ResponseMeta | null,
  headers?: PaginationHeadersInput,
): PaginatedResponse<T> {
  const items: T[] = Array.isArray(data) ? (data as T[]) : [];
  const cursors = extractPaginationCursors(headers);
  const metaNext =
    typeof meta?.nextCursor === 'string' && meta.nextCursor.trim().length > 0
      ? meta.nextCursor.trim()
      : null;
  const metaPrev =
    typeof meta?.prevCursor === 'string' && meta.prevCursor.trim().length > 0
      ? meta.prevCursor.trim()
      : null;
  const metaEcho =
    typeof meta?.cursor === 'string' && meta.cursor.trim().length > 0 ? meta.cursor.trim() : null;
  const nextCursor = cursors.nextCursor ?? metaNext ?? metaEcho;
  const prevCursor = cursors.prevCursor ?? metaPrev;
  if (!meta && nextCursor === null && prevCursor === null) {
    return { data: items };
  }
  return {
    data: items,
    meta: {
      ...(meta ?? {}),
      ...(nextCursor !== null ? { nextCursor } : {}),
      ...(prevCursor !== null ? { prevCursor } : {}),
    },
  };
}

/**
 * Cursor (keyset) pagination utilities.
 *
 * Re-exported from `@astroid/core` so the client package and every resource
 * package share a single auto-pagination implementation.
 *
 * ```ts
 * import { paginateCursor } from '@astroid/client';
 *
 * for await (const wallet of paginateCursor((cursor) =>
 *   astroid.http.get('/wallets', { query: { limit: 100, ...(cursor ? { cursor } : {}) } }),
 * )) {
 *   console.log(wallet.id);
 * }
 * ```
 */
export {
  paginateCursor,
  normalizeCursorPage,
  MAX_CURSOR_PAGES,
  type CursorPage,
  type CursorPageFetcher,
  type PaginateCursorOptions,
} from '@astroid/core';

/**
 * Typed list-filter builders and cursor-iteration helpers for `@astroid/client`.
 *
 * Many Astroid REST API list endpoints accept the same family of query
 * parameters: cursor pagination (`limit`, `cursor`, `order`/`direction`) plus
 * common filters (`search`, `status`, `asset`, `walletId`, `agentId`, date
 * ranges, `sort`). Without shared helpers every consumer hand-rolls query
 * assembly and pagination loops.
 *
 * This module provides:
 *
 * - Strictly-typed filter shapes grounded in {@link PaginationParams} from
 *   `@astroid/types` ({@link CommonListFilters}, {@link ListQueryParams}).
 * - Pure query builders ({@link buildFilterQuery}, {@link buildListQuery},
 *   {@link buildListQueryString}) that never mutate their inputs and reuse the
 *   pagination normalizers (`limit` clamped to `[1, 200]`, empty values
 *   dropped, `Date`s serialized to ISO-8601).
 * - Response parsing ({@link parsePaginatedResponse}) and cursor iteration
 *   ({@link iterateCursorPages}, {@link collectCursorPages}) that forward
 *   filters on every page and stop gracefully on empty lists, missing cursors,
 *   or non-advancing cursors — never throwing on malformed payloads.
 *
 * ```ts
 * import { Astroid, buildListQuery, collectCursorPages } from '@astroid/client';
 *
 * const astroid = new Astroid({ apiKey: process.env.ASTROID_API_KEY! });
 *
 * const wallets = await collectCursorPages(
 *   (query) => astroid.http.get('/wallets', { query }).then((res) => res.data),
 *   { limit: 100, status: 'ACTIVE', search: 'ops' },
 * );
 * ```
 *
 * @module
 */

import type { PaginatedResponse, PaginationParams, ResponseMeta } from '@astroid/types';
import type { QueryValue } from '@astroid/core';
import {
  clampPaginationLimit,
  extractPaginationCursors,
  normalizePaginationCursor,
  type PaginationHeadersInput,
} from './pagination.js';

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

/** Sort direction accepted by every Astroid list endpoint. */
export type SortDirection = 'asc' | 'desc';

/** Cursor-pagination inputs: `limit` / `cursor` / `order`, with `direction` as an alias for `order`. */
export interface CursorPaginationInput {
  /** Maximum number of items per page (clamped to `[1, 200]`). */
  limit?: number;
  /** Opaque cursor for keyset pagination. */
  cursor?: string;
  /** Sort direction. */
  order?: SortDirection;
  /**
   * Alias for {@link CursorPaginationInput.order}.
   *
   * Accepted so callers using the `direction` vocabulary from cursor-based
   * APIs don't need to rename fields; an explicit `order` always wins.
   */
  direction?: SortDirection;
}

/** Free-text search filter (substring match, resource-dependent). */
export interface SearchFilter {
  /** Case-insensitive substring match (e.g. agent name). */
  search?: string;
}

/** Single-field sort selector paired with a direction. */
export interface SortingFilter {
  /** Field to sort the rows by. */
  sort?: string;
  /** Sort direction. */
  order?: SortDirection;
  /** Alias for `order` (explicit `order` wins). */
  direction?: SortDirection;
}

/** Inclusive/exclusive reporting or creation window. */
export interface DateRangeFilter {
  /** Inclusive start of the window (ISO-8601 string or `Date`). */
  startDate?: string | Date;
  /** Exclusive end of the window (ISO-8601 string or `Date`). */
  endDate?: string | Date;
  /** Shorthand alias for `startDate`. */
  from?: string | Date;
  /** Shorthand alias for `endDate`. */
  to?: string | Date;
}

/** Status filter accepting a single value or a list of values. */
export interface StatusFilter<TStatus extends string = string> {
  /** One status — or several — to include in the result set. */
  status?: TStatus | readonly TStatus[];
}

/** Entity-scoping filters shared by most list endpoints. */
export interface EntityScopeFilter {
  /** Filter results to a single asset code (e.g. `USDC`, `XLM`). */
  asset?: string;
  /** Filter results to a single wallet. */
  walletId?: string;
  /** Filter results to a single agent. */
  agentId?: string;
}

/**
 * Common list filters: standard pagination plus the shared filter family.
 *
 * Grounded in {@link PaginationParams} so every resource `*ListParams` type
 * (agents, wallets, transactions, …) is assignable where its fields overlap.
 */
export interface CommonListFilters extends PaginationParams {
  /** Alias for `order` (explicit `order` wins). */
  direction?: SortDirection;
  /** Field to sort the rows by. */
  sort?: string;
  /** Case-insensitive substring match (e.g. agent name). */
  search?: string;
  /** One status — or several — to include. */
  status?: string | readonly string[];
  /** Filter results to a single asset code. */
  asset?: string;
  /** Filter results to a single wallet. */
  walletId?: string;
  /** Filter results to a single agent. */
  agentId?: string;
  /** Inclusive start of the window (ISO-8601 string or `Date`). */
  startDate?: string | Date;
  /** Exclusive end of the window (ISO-8601 string or `Date`). */
  endDate?: string | Date;
  /** Shorthand alias for `startDate`. */
  from?: string | Date;
  /** Shorthand alias for `endDate`. */
  to?: string | Date;
}

/**
 * List query parameters: the common filters plus any extra endpoint-specific
 * keys. Builders accept this shape and pass unknown keys through untouched
 * (trimmed strings, ISO dates, `null`/`undefined`/`''` dropped).
 */
export type ListQueryParams = CommonListFilters & Record<string, unknown>;

/* -------------------------------------------------------------------------- */
/* Normalizers (never throw)                                                   */
/* -------------------------------------------------------------------------- */

/** Validate a raw direction/order value, returning only `'asc'` / `'desc'`. */
export function normalizeSortDirection(value: unknown): SortDirection | undefined {
  return value === 'asc' || value === 'desc' ? value : undefined;
}

/** Trim a free-form string filter; empty/missing/non-string values are dropped. */
export function normalizeFilterString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Normalize a date filter to an ISO-8601 string.
 *
 * `Date` instances serialize via `toISOString()`; strings pass through when
 * they are non-empty and parseable. Invalid dates yield `undefined` so the key
 * is omitted instead of sending a value the API would reject.
 */
export function normalizeFilterDate(value: string | Date | null | undefined): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isNaN(time) ? undefined : value.toISOString();
  }
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  return Number.isNaN(Date.parse(trimmed)) ? undefined : trimmed;
}

/**
 * Normalize a status filter to a deduped list of non-empty values.
 *
 * Accepts a single status or a (readonly) array; trims entries, drops empties,
 * and removes duplicates while preserving order. Returns `undefined` when
 * nothing usable remains.
 */
export function normalizeStatusFilter(
  status: string | readonly string[] | null | undefined,
): string[] | undefined {
  if (status === null || status === undefined) return undefined;
  const raw: readonly unknown[] = Array.isArray(status) ? status : [status];
  const out: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'string') continue;
    const trimmed = entry.trim();
    if (trimmed.length === 0 || out.includes(trimmed)) continue;
    out.push(trimmed);
  }
  return out.length > 0 ? out : undefined;
}

/* -------------------------------------------------------------------------- */
/* Query builders (pure — never mutate inputs)                                 */
/* -------------------------------------------------------------------------- */

const KNOWN_FILTER_KEYS = new Set([
  'page',
  'cursor',
  'limit',
  'order',
  'direction',
  'sort',
  'search',
  'status',
  'asset',
  'walletId',
  'agentId',
  'startDate',
  'endDate',
  'from',
  'to',
]);

function appendExtraFilters(
  query: Record<string, QueryValue>,
  filters: Record<string, unknown>,
): void {
  for (const [key, value] of Object.entries(filters)) {
    if (KNOWN_FILTER_KEYS.has(key)) continue;
    if (value === null || value === undefined) continue;
    if (value instanceof Date) {
      const normalized = normalizeFilterDate(value);
      if (normalized !== undefined) query[key] = normalized;
      continue;
    }
    if (typeof value === 'string') {
      const normalized = normalizeFilterString(value);
      if (normalized !== undefined) query[key] = normalized;
      continue;
    }
    if (typeof value === 'number') {
      if (Number.isFinite(value)) query[key] = value;
      continue;
    }
    if (typeof value === 'boolean') {
      query[key] = value;
      continue;
    }
    if (typeof value === 'bigint') {
      query[key] = String(value);
      continue;
    }
    if (Array.isArray(value)) {
      const items: Array<string | number> = [];
      for (const entry of value) {
        if (typeof entry === 'string') {
          const trimmed = entry.trim();
          if (trimmed.length > 0) items.push(trimmed);
        } else if (typeof entry === 'number' && Number.isFinite(entry)) {
          items.push(entry);
        }
      }
      if (items.length > 0) query[key] = items;
    }
  }
}

/**
 * Serialize common list filters into a query-parameter record.
 *
 * Pure function: the input is only read, never mutated. Pagination fields are
 * normalized with the shared pagination helpers (`limit` clamped to
 * `[1, 200]`); `direction` acts as an alias for `order` (explicit `order`
 * wins); date filters accept `Date` or ISO strings; status lists stay as
 * arrays (the transport repeats the key, matching `@astroid/core`).
 *
 * @param filters Filter and pagination parameters (or `null`/`undefined`).
 * @returns A fresh record ready for the `query` option of any request.
 */
export function buildFilterQuery(filters?: CommonListFilters | null): Record<string, QueryValue> {
  const query: Record<string, QueryValue> = {};
  if (!filters) return query;

  const cursor = normalizePaginationCursor(filters.cursor);
  if (cursor !== undefined) query['cursor'] = cursor;

  const limit = clampPaginationLimit(filters.limit);
  if (limit !== undefined) query['limit'] = limit;

  const order = normalizeSortDirection(filters.order) ?? normalizeSortDirection(filters.direction);
  if (order !== undefined) query['order'] = order;

  if (filters.page !== undefined && filters.page !== null) {
    const numeric = typeof filters.page === 'number' ? filters.page : Number(filters.page);
    if (Number.isFinite(numeric)) {
      const floored = Math.floor(numeric);
      query['page'] = floored >= 1 ? floored : 1;
    }
  }

  const sort = normalizeFilterString(filters.sort);
  if (sort !== undefined) query['sort'] = sort;

  const search = normalizeFilterString(filters.search);
  if (search !== undefined) query['search'] = search;

  const status = normalizeStatusFilter(
    filters.status as string | readonly string[] | null | undefined,
  );
  if (status !== undefined) query['status'] = status.length === 1 ? (status[0] as string) : status;

  const asset = normalizeFilterString(filters.asset);
  if (asset !== undefined) query['asset'] = asset;

  const walletId = normalizeFilterString(filters.walletId);
  if (walletId !== undefined) query['walletId'] = walletId;

  const agentId = normalizeFilterString(filters.agentId);
  if (agentId !== undefined) query['agentId'] = agentId;

  const startDate = normalizeFilterDate(filters.startDate ?? filters.from ?? undefined);
  if (startDate !== undefined) query['startDate'] = startDate;

  const endDate = normalizeFilterDate(filters.endDate ?? filters.to ?? undefined);
  if (endDate !== undefined) query['endDate'] = endDate;

  appendExtraFilters(query, filters as Record<string, unknown>);

  return query;
}

/**
 * Merge list filters onto a base query without mutating either input.
 *
 * Both arguments are only read; a fresh record is returned where normalized
 * filter values win over colliding base keys. Pass `baseQuery` for endpoint
 * defaults (e.g. a fixed `limit`) that callers may override via `filters`.
 *
 * @param filters   Caller-supplied filters/pagination (or `null`/`undefined`).
 * @param baseQuery Base/default query parameters (or `null`/`undefined`).
 * @returns A new merged record; inputs are left untouched.
 */
export function buildListQuery(
  filters?: CommonListFilters | null,
  baseQuery?: Record<string, QueryValue> | null,
): Record<string, QueryValue> {
  const base: Record<string, QueryValue> = baseQuery ? { ...baseQuery } : {};
  const built = buildFilterQuery(filters);
  return { ...base, ...built };
}

/**
 * Build a URL-encoded list query string (leading `?`, or `''` when empty).
 *
 * Array values repeat the key (`?status=A&status=B`), matching the encoding
 * `@astroid/core` applies on the wire, so what you see is what is sent.
 * Pure function — inputs are never mutated.
 */
export function buildListQueryString(
  filters?: CommonListFilters | null,
  baseQuery?: Record<string, QueryValue> | null,
): string {
  const merged = buildListQuery(filters, baseQuery);
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(merged)) {
    if (value === null || value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) search.append(key, String(item));
    } else {
      search.append(key, String(value));
    }
  }
  const serialized = search.toString();
  return serialized ? `?${serialized}` : '';
}

/* -------------------------------------------------------------------------- */
/* Response parsing + cursor iteration                                         */
/* -------------------------------------------------------------------------- */

/** A function that fetches one list page for a fully-built query record. */
export type ListPageFetcher<TItem> = (
  query: Record<string, QueryValue>,
) => Promise<PaginatedResponse<TItem>>;

/** Options for {@link iterateCursorPages} / {@link collectCursorPages}. */
export interface IterateCursorPagesOptions {
  /**
   * Hard ceiling on the number of pages fetched. Guards against an API that
   * never stops handing out cursors.
   *
   * @default 10_000
   */
  maxPages?: number;
}

/** Default ceiling on pages fetched by {@link iterateCursorPages}. */
export const MAX_LIST_PAGES = 10_000;

/**
 * Parse a raw list-response body (plus optional response headers) into a
 * normalized {@link PaginatedResponse}.
 *
 * Accepts the enveloped shape (`{ data, meta }`), a bare array, or anything
 * malformed (which yields `{ data: [] }`). Header cursors (`next_cursor` /
 * `prev_cursor`) win over body `meta` when both are present. Never throws.
 *
 * @param body    Raw response body (envelope, array, or malformed payload).
 * @param headers Optional response headers carrying pagination cursors.
 */
export function parsePaginatedResponse<T>(
  body: unknown,
  headers?: PaginationHeadersInput,
): PaginatedResponse<T> {
  const cursors = extractPaginationCursors(headers);
  if (Array.isArray(body)) {
    const items = body as T[];
    if (cursors.nextCursor === null && cursors.prevCursor === null) return { data: items };
    return {
      data: items,
      meta: {
        ...(cursors.nextCursor !== null ? { nextCursor: cursors.nextCursor } : {}),
        ...(cursors.prevCursor !== null ? { prevCursor: cursors.prevCursor } : {}),
      },
    };
  }
  if (typeof body === 'object' && body !== null && 'data' in body) {
    const envelope = body as { data?: unknown; meta?: ResponseMeta | null };
    const data = Array.isArray(envelope.data) ? (envelope.data as T[]) : [];
    const meta = (envelope.meta ?? undefined) as ResponseMeta | undefined;
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
    if (meta === undefined && nextCursor === null && prevCursor === null) {
      return { data };
    }
    return {
      data,
      meta: {
        ...(meta ?? {}),
        ...(nextCursor !== null ? { nextCursor } : {}),
        ...(prevCursor !== null ? { prevCursor } : {}),
      },
    };
  }
  return { data: [] };
}

function readPageCursor(response: PaginatedResponse<unknown>): {
  nextCursor: string | null;
  hasMore: boolean;
} {
  const meta = response.meta as Partial<ResponseMeta> | undefined;
  const rawNext = meta?.nextCursor ?? meta?.cursor;
  const nextCursor =
    typeof rawNext === 'string' && rawNext.trim().length > 0 ? rawNext.trim() : null;
  const hasMore = meta?.hasMore ?? nextCursor !== null;
  return { nextCursor, hasMore };
}

/**
 * Lazily iterate every item across all cursor-paginated pages of a list endpoint.
 *
 * Unlike the cursor-only fetcher shape, `fetchPage` receives the fully-built
 * query record on each call, so filters (`status`, `search`, date ranges, …)
 * are forwarded automatically on every page — callers never manage cursors by
 * hand. The caller's `filters` object is shallow-copied once up front and
 * never mutated.
 *
 * Iteration stops when the API reports `hasMore: false`, returns no usable
 * `nextCursor`, repeats the cursor it was given (non-advancing), or
 * `maxPages` is reached. Empty pages with a fresh cursor continue.
 *
 * @param fetchPage Fetcher invoked once per page with the built query record.
 * @param filters   Filters forwarded on every page (never mutated).
 * @param options   Optional iteration limits.
 */
export async function* iterateCursorPages<TItem>(
  fetchPage: ListPageFetcher<TItem>,
  filters?: CommonListFilters | null,
  options?: IterateCursorPagesOptions,
): AsyncGenerator<TItem, void, void> {
  const maxPages = options?.maxPages ?? MAX_LIST_PAGES;
  const base: CommonListFilters = filters ? { ...filters } : {};
  let cursor = normalizePaginationCursor(base.cursor);

  for (let fetched = 0; fetched < maxPages; fetched += 1) {
    const query = buildListQuery(
      cursor === undefined ? { ...base, cursor: undefined } : { ...base, cursor },
    );
    if (cursor === undefined) delete query['cursor'];

    const response = await fetchPage(query);
    const items = Array.isArray(response?.data) ? response.data : [];
    for (const item of items) yield item;

    const { nextCursor, hasMore } = readPageCursor(response);
    if (!hasMore || nextCursor === null || nextCursor === cursor) return;
    cursor = nextCursor;
  }
}

/**
 * Collect every item across all cursor-paginated pages into an array.
 *
 * Convenience wrapper over {@link iterateCursorPages} for callers that prefer
 * a single array over streaming. Filters are forwarded on every page and the
 * input `filters` object is never mutated.
 */
export async function collectCursorPages<TItem>(
  fetchPage: ListPageFetcher<TItem>,
  filters?: CommonListFilters | null,
  options?: IterateCursorPagesOptions,
): Promise<TItem[]> {
  const out: TItem[] = [];
  for await (const item of iterateCursorPages(fetchPage, filters, options)) out.push(item);
  return out;
}

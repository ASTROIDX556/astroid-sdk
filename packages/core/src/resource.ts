/**
 * Base class shared by every SDK resource namespace (`wallets`, `agents`, …).
 *
 * It holds the `HttpClient` and offers small helpers so resource methods stay
 * declarative: unwrap `data`, build a paginated list, and expose auto-iterators
 * for both page-number and cursor (keyset) pagination. Resources never touch
 * fetch/headers/retries directly.
 */

import type { CursorPaginated, Paginated, PaginationMeta } from '@astroid/types';

import type { HttpClient } from './http-client.js';
import type { AstroidResponse, QueryValue, RequestOptions } from './http-types.js';
import { paginate, paginateCursor, normalizeCursorPage } from './pagination.js';

/** Options a list method accepts beyond its typed filters. */
export type ListRequestOptions = Omit<RequestOptions, 'method' | 'path' | 'body'>;

/** Extra request options that can be forwarded to the HTTP client. */
export type RequestOptionsExtras = Omit<RequestOptions, 'method' | 'path' | 'body' | 'query'>;

export abstract class Resource {
  protected readonly client: HttpClient;

  constructor(client: HttpClient) {
    this.client = client;
  }

  /** Unwrap just the `data` from a GET. */
  protected async getData<TData>(
    path: string,
    query?: Record<string, QueryValue>,
    extras?: RequestOptionsExtras,
  ): Promise<TData> {
    const res = await this.client.get<TData>(path, {
      ...(extras ?? {}),
      ...(query ? { query } : {}),
    });
    return res.data;
  }

  /** Fetch a list endpoint, returning both items and pagination metadata. */
  protected async listData<TItem>(
    path: string,
    query?: Record<string, QueryValue>,
    extras?: RequestOptionsExtras,
  ): Promise<Paginated<TItem>> {
    const res: AstroidResponse<TItem[]> = await this.client.get<TItem[]>(path, {
      ...(extras ?? {}),
      ...(query ? { query } : {}),
    });
    return { data: res.data ?? [], meta: normalizeMeta(res) };
  }

  /**
   * Fetch a cursor-paginated (keyset) list endpoint, returning the items plus a
   * normalized `nextCursor` / `hasMore` pair.
   *
   * The caller drives the loop: pass `page.nextCursor` back as `query.cursor`
   * for the next request, and stop when `hasMore` is `false` or `nextCursor` is
   * `null`. For automatic iteration over every page without holding them in
   * memory, prefer {@link Resource.iterateCursorData}.
   *
   * `nextCursor` is read from `meta.nextCursor`, falling back to `meta.cursor`;
   * a missing or empty cursor is normalized to `null`, and `hasMore` falls back
   * to `nextCursor !== null` when the API omits it.
   *
   * @param path   Resource path, e.g. `/analytics/agents`.
   * @param query  Typed filters, optionally including a starting `cursor`.
   * @param extras Extra request options forwarded to the HTTP client.
   */
  protected async listCursorData<TItem>(
    path: string,
    query?: Record<string, QueryValue>,
    extras?: RequestOptionsExtras,
  ): Promise<CursorPaginated<TItem>> {
    const res: AstroidResponse<TItem[]> = await this.client.get<TItem[]>(path, {
      ...(extras ?? {}),
      ...(query ? { query } : {}),
    });
    const page = normalizeCursorPage(res);
    return { items: page.items, nextCursor: page.nextCursor, hasMore: page.hasMore };
  }

  /**
   * An async iterator over every item across all pages of a list endpoint.
   *
   * @example
   * for await (const tx of client.transactions.iterate()) { ... }
   */
  protected iterateData<TItem>(
    path: string,
    query?: Record<string, QueryValue>,
    extras?: RequestOptionsExtras,
  ): AsyncGenerator<TItem, void, void> {
    return paginate<TItem>((page) =>
      this.client.get<TItem[]>(path, { ...(extras ?? {}), query: { ...(query ?? {}), page } }),
    );
  }

  /**
   * An async iterator over every item across all pages of a cursor-paginated
   * (keyset) list endpoint, following the opaque `meta.nextCursor` the API
   * returns in each response.
   *
   * Only one page is held in memory at a time and the next page is requested
   * lazily as the consumer advances the generator. Iteration stops as soon as
   * the API stops handing out a new cursor, so callers never manage cursors by
   * hand. An initial `cursor` passed in `query` resumes iteration from a
   * previously captured position.
   *
   * @param path   Resource path, e.g. `/wallets`.
   * @param query  Typed filters; may include a starting `cursor` to resume from.
   * @param extras Extra request options forwarded to the HTTP client.
   *
   * @example
   * for await (const wallet of client.wallets.iterateByCursor()) { ... }
   */
  protected iterateCursorData<TItem>(
    path: string,
    query?: Record<string, QueryValue>,
    extras?: RequestOptionsExtras,
  ): AsyncGenerator<TItem, void, void> {
    return paginateCursor<TItem>((cursor) => {
      const merged: Record<string, QueryValue> = { ...(query ?? {}) };
      if (cursor !== undefined) merged['cursor'] = cursor;
      const hasQuery = Object.keys(merged).length > 0;
      return this.client.get<TItem[]>(path, {
        ...(extras ?? {}),
        ...(hasQuery ? { query: merged } : {}),
      });
    });
  }
}

/** Best-effort pagination metadata, filling gaps the API may omit. */
function normalizeMeta(res: AstroidResponse<unknown[]>): PaginationMeta {
  const meta = (res.meta ?? {}) as Partial<PaginationMeta>;
  const page = meta.page ?? 1;
  const limit = meta.limit ?? (Array.isArray(res.data) ? res.data.length : 0);
  const total = meta.total ?? (Array.isArray(res.data) ? res.data.length : 0);
  const totalPages = meta.totalPages ?? (limit > 0 ? Math.ceil(total / limit) : 1);
  return {
    page,
    limit,
    total,
    totalPages,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1,
  };
}

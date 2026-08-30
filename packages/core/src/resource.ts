/**
 * Base class shared by every SDK resource namespace (`wallets`, `agents`, …).
 *
 * It holds the `HttpClient` and offers small helpers so resource methods stay
 * declarative: unwrap `data`, build a paginated list, and expose an
 * auto-iterator. Resources never touch fetch/headers/retries directly.
 */

import type { Paginated, PaginationMeta } from '@astroid/types';

import type { HttpClient } from './http-client.js';
import type { AstroidResponse, QueryValue, RequestOptions } from './http-types.js';
import { paginate } from './pagination.js';

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
    const res = await this.client.get<TData>(path, { ...(extras ?? {}), ...(query ? { query } : {}) });
    return res.data;
  }

  /** Fetch a list endpoint, returning both items and pagination metadata. */
  protected async listData<TItem>(
    path: string,
    query?: Record<string, QueryValue>,
    extras?: RequestOptionsExtras,
  ): Promise<Paginated<TItem>> {
    const res: AstroidResponse<TItem[]> = await this.client.get<TItem[]>(path, { ...(extras ?? {}), ...(query ? { query } : {}) });
    return { data: res.data ?? [], meta: normalizeMeta(res) };
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

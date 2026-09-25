/**
 * Pagination serialization and helper utilities for @astroid/client.
 */

import type { PaginationParams, PaginatedResponse } from '@astroid/types';
import type { QueryValue } from '@astroid/core';

/**
 * Serializes standard pagination parameters into a query parameter record.
 */
export function serializePaginationParams(params?: PaginationParams): Record<string, QueryValue> {
  if (!params) {
    return {};
  }
  const query: Record<string, QueryValue> = {};
  if (params.cursor !== undefined) {
    query['cursor'] = params.cursor;
  }
  if (params.limit !== undefined) {
    query['limit'] = params.limit;
  }
  if (params.order !== undefined) {
    query['order'] = params.order;
  }
  return query;
}

/**
 * Unwraps a paginated response envelope.
 */
export function unwrapPaginatedResponse<T>(response: PaginatedResponse<T>): T[] {
  return response.data;
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

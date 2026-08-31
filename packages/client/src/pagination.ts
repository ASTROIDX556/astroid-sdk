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

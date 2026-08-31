/**
 * Common shared types, pagination, and response metadata.
 */

/** Standard pagination request parameters. */
export interface PaginationParams {
  cursor?: string;
  limit?: number;
  order?: 'asc' | 'desc';
}

/** Standard paginated response envelope. */
export interface PaginatedResponse<T> {
  data: T[];
  meta?: ResponseMeta;
}

/** Standard metadata returned with API responses. */
export interface ResponseMeta {
  cursor?: string;
  hasMore?: boolean;
  total?: number;
  [key: string]: unknown;
}

/** Standard API error payload structure. */
export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

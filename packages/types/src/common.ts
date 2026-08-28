/**
 * Transport-level types shared by every Astroid API response.
 *
 * The response envelope is contractually fixed across all repositories:
 * `{ success, data, meta, requestId }` for success and
 * `{ success: false, error, requestId }` for failure.
 */

/** Machine-readable API error codes returned in the error envelope. */
export const ApiErrorCode = {
  // Auth
  AUTHENTICATION_ERROR: 'AUTHENTICATION_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  INVALID_API_KEY: 'INVALID_API_KEY',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  // Validation
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  BAD_REQUEST: 'BAD_REQUEST',
  // Domain
  POLICY_VIOLATION: 'POLICY_VIOLATION',
  BUDGET_EXCEEDED: 'BUDGET_EXCEEDED',
  RISK_THRESHOLD_EXCEEDED: 'RISK_THRESHOLD_EXCEEDED',
  APPROVAL_REQUIRED: 'APPROVAL_REQUIRED',
  WALLET_FROZEN: 'WALLET_FROZEN',
  INSUFFICIENT_FUNDS: 'INSUFFICIENT_FUNDS',
  PROPOSAL_EXPIRED: 'PROPOSAL_EXPIRED',
  // Resource
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  // Rate / server
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  // Client-side (SDK generated)
  NETWORK_ERROR: 'NETWORK_ERROR',
  TIMEOUT: 'TIMEOUT',
} as const;
export type ApiErrorCode = (typeof ApiErrorCode)[keyof typeof ApiErrorCode];

/** The `error` object embedded in a failed response envelope. */
export interface ApiError {
  code: ApiErrorCode | string;
  message: string;
  /** Optional structured detail (e.g. field validation errors, policy context). */
  details?: Record<string, unknown>;
}

/** Metadata attached to a successful response (pagination, timing, etc.). */
export interface ResponseMeta {
  page?: number;
  limit?: number;
  total?: number;
  totalPages?: number;
  hasNextPage?: boolean;
  hasPreviousPage?: boolean;
  [key: string]: unknown;
}

/** A successful API response envelope. */
export interface ApiSuccessResponse<TData> {
  success: true;
  data: TData;
  meta?: ResponseMeta;
  requestId: string;
}

/** A failed API response envelope. */
export interface ApiErrorResponse {
  success: false;
  error: ApiError;
  meta?: ResponseMeta;
  requestId: string;
}

/** The union of both envelope shapes. */
export type ApiResponse<TData> = ApiSuccessResponse<TData> | ApiErrorResponse;

/** Pagination metadata returned for list endpoints. */
export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

/** A page of results plus its pagination metadata. */
export interface Paginated<TItem> {
  data: TItem[];
  meta: PaginationMeta;
}

/** Query parameters supported by every list endpoint. */
export interface PaginationParams {
  page?: number;
  limit?: number;
  sort?: string;
  order?: 'asc' | 'desc';
  search?: string;
}

/**
 * Generic list parameters: pagination plus an arbitrary, string-serialisable
 * filter map (e.g. `{ status: 'COMPLETED', asset: 'USDC' }`).
 */
export interface ListParams extends PaginationParams {
  filter?: Record<string, string | number | boolean | undefined>;
}

/** A value that can be safely encoded into a query string. */
export type QueryValue = string | number | boolean | null | undefined | Array<string | number>;

/** A raw query parameter map. */
export type QueryParams = Record<string, QueryValue>;

/* -------------------------------------------------------------------------- */
/* Cursor-based pagination                                                     */
/* -------------------------------------------------------------------------- */

/** Query parameters for cursor-based (keyset) pagination. */
export interface CursorPaginationParams {
  /** Maximum number of items per page. Defaults to the endpoint default; capped at 100. */
  limit?: number;
  /** Opaque cursor from the previous page, used to fetch the next page. */
  cursor?: string;
  /** Sort direction. Defaults to `'desc'` (newest first). */
  order?: 'asc' | 'desc';
}

/** A page of results returned by a cursor-paginated list endpoint. */
export interface CursorPaginated<TItem> {
  items: TItem[];
  /** Opaque cursor for the next page, or `null` when there are no more pages. */
  nextCursor: string | null;
  /** Whether more pages are available after this one. */
  hasMore: boolean;
}

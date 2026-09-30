/**
 * `@astroid/errors` — typed error classes for the Astroid SDK.
 *
 * Every failure surfaced by the SDK is an `AstroidError` (or subclass), never a
 * generic `Error`. Consumers can branch on `instanceof PolicyViolationError`,
 * inspect `error.code`, `error.status`, and `error.requestId`, and read
 * structured `details`.
 */

import { ApiErrorCode, type ApiError } from '@astroid/types';
export {
  errorClassForStatus,
  statusCodeToCode,
  mapStatusToError,
  errorFromStatus,
  extractApiError,
  type ErrorEnvelopeInput,
} from './mapper.js';
import { extractApiError, mapStatusToError } from './mapper.js';

export {
  isAstroidError,
  isAuthenticationError,
  isForbiddenError,
  isValidationError,
  isNotFoundError,
  isConflictError,
  isPolicyViolationError,
  isInsufficientFundsError,
  isRateLimitError,
  isApiRateLimitError,
  isNetworkError,
  isTimeoutError,
  isServerError,
} from './guards.js';

export {
  AstroidError,
  setIncludeStackInErrors,
  getIncludeStackInErrors,
  type AstroidErrorOptions,
  type SerializedAstroidError,
} from './base.js';
import { AstroidError } from './base.js';

/* -------------------------------------------------------------------------- */
/* Specialized HTTP/API error classes                                          */
/* -------------------------------------------------------------------------- */

export {
  AuthenticationError,
  AuthorizationError,
  ForbiddenError,
  ValidationError,
  NotFoundError,
  ConflictError,
  PolicyViolationError,
  InsufficientFundsError,
  BudgetExceededError,
  ApprovalRequiredError,
  RateLimitError,
  ApiRateLimitError,
  NetworkError,
  AstroidTimeoutError,
  ServerError,
  InternalServerError,
} from './classes.js';
import {
  AuthenticationError,
  AstroidTimeoutError,
  ForbiddenError,
  ValidationError,
  NotFoundError,
  ConflictError,
  PolicyViolationError,
  InsufficientFundsError,
  BudgetExceededError,
  ApprovalRequiredError,
  RateLimitError,
  NetworkError,
  InternalServerError,
} from './classes.js';

/** Alias for {@link InsufficientFundsError} — matches the naming used in API docs and client middleware. */
export const AstroidInsufficientFundsError = InsufficientFundsError;

/** Alias for {@link PolicyViolationError} — matches the naming used in API docs and client middleware. */
export const AstroidPolicyViolationError = PolicyViolationError;

/**
 * Maps an API error code to its concrete error class. Unknown codes fall back to
 * the base `AstroidError`.
 */
export function errorClassForCode(code: string): typeof AstroidError {
  switch (code) {
    case ApiErrorCode.AUTHENTICATION_ERROR:
    case ApiErrorCode.UNAUTHORIZED:
    case ApiErrorCode.INVALID_API_KEY:
    case ApiErrorCode.TOKEN_EXPIRED:
      return AuthenticationError;
    case ApiErrorCode.FORBIDDEN:
      return ForbiddenError;
    case ApiErrorCode.VALIDATION_ERROR:
    case ApiErrorCode.BAD_REQUEST:
      return ValidationError;
    case ApiErrorCode.NOT_FOUND:
      return NotFoundError;
    case ApiErrorCode.CONFLICT:
      return ConflictError;
    case ApiErrorCode.POLICY_VIOLATION:
    case ApiErrorCode.POLICY_REJECTED:
    case ApiErrorCode.RISK_THRESHOLD_EXCEEDED:
      return PolicyViolationError;
    case ApiErrorCode.BUDGET_EXCEEDED:
      return BudgetExceededError;
    case ApiErrorCode.INSUFFICIENT_FUNDS:
    case ApiErrorCode.INSUFFICIENT_BALANCE:
    case ApiErrorCode.WALLET_FROZEN:
      return InsufficientFundsError;
    case ApiErrorCode.APPROVAL_REQUIRED:
      return ApprovalRequiredError;
    case ApiErrorCode.PROPOSAL_EXPIRED:
      // An expired proposal is a resource-state conflict: the entity existed
      // but is no longer actionable, mirroring a 409-style stale-state error.
      return ConflictError;
    case ApiErrorCode.INVALID_SIGNATURE:
      // A signature the API could not verify is a malformed-request class
      // failure: retrying the identical payload cannot succeed.
      return ValidationError;
    case ApiErrorCode.RATE_LIMITED:
      return RateLimitError;
    case ApiErrorCode.NETWORK_ERROR:
    case ApiErrorCode.TIMEOUT:
      return NetworkError;
    case ApiErrorCode.REQUEST_TIMEOUT:
      return AstroidTimeoutError;
    case ApiErrorCode.INTERNAL_ERROR:
    case ApiErrorCode.SERVICE_UNAVAILABLE:
      return InternalServerError;
    default:
      // Also support direct Horizon codes that may leak as API codes
      if (
        code === 'op_underfunded' ||
        code === 'op_low_reserve' ||
        code === 'tx_insufficient_balance'
      ) {
        return InsufficientFundsError;
      }
      return AstroidError;
  }
}

/**
 * Infers an error code from an HTTP status when the API did not supply one
 * (e.g. a proxy returned a bare 502).
 */
export function codeForStatus(status: number): string {
  if (status === 401) return ApiErrorCode.AUTHENTICATION_ERROR;
  if (status === 403) return ApiErrorCode.FORBIDDEN;
  if (status === 404) return ApiErrorCode.NOT_FOUND;
  if (status === 409) return ApiErrorCode.CONFLICT;
  if (status === 422 || status === 400) return ApiErrorCode.VALIDATION_ERROR;
  if (status === 429) return ApiErrorCode.RATE_LIMITED;
  if (status >= 500) return ApiErrorCode.INTERNAL_ERROR;
  return ApiErrorCode.BAD_REQUEST;
}

/** Fields the SDK knows how to lift out of an API error envelope. */
export interface NormalizeErrorContext {
  status?: number;
  requestId?: string;
  details?: Record<string, unknown>;
  cause?: unknown;
}

/**
 * Builds the correct typed error from an API error object (the `error` field of
 * a failed response envelope).
 *
 * @example
 * ```ts
 * const err = fromApiError(
 *   { code: 'POLICY_VIOLATION', message: 'Exceeds daily limit' },
 *   { status: 422, requestId: 'req_123' },
 * );
 * err instanceof PolicyViolationError; // true
 * ```
 */
export function fromApiError(
  apiError: ApiError,
  context: NormalizeErrorContext = {},
): AstroidError {
  const ErrorClass = errorClassForCode(apiError.code);
  const details = { ...(apiError.details ?? {}), ...(context.details ?? {}) };
  return new ErrorClass(apiError.message, {
    code: apiError.code,
    status: context.status,
    requestId: context.requestId,
    details: Object.keys(details).length > 0 ? details : undefined,
    cause: context.cause,
  });
}

/**
 * Builds a typed error from an HTTP status alone (used when the response body is
 * missing or unparseable).
 */
export function fromStatus(
  status: number,
  message: string,
  context: NormalizeErrorContext = {},
): AstroidError {
  const code = codeForStatus(status);
  const ErrorClass = errorClassForCode(code);
  return new ErrorClass(message, {
    code,
    status,
    requestId: context.requestId,
    details: context.details,
    cause: context.cause,
  });
}

/** Wraps a low-level transport failure as a `NetworkError`. */
export function toNetworkError(cause: unknown, message = 'Network request failed'): NetworkError {
  return new NetworkError(message, {
    code: ApiErrorCode.NETWORK_ERROR,
    cause,
  });
}

/**
 * Read a failed response body as JSON, tolerating anything a gateway can throw
 * at us.
 *
 * Returns `undefined` — rather than throwing — for the whole class of hostile
 * inputs: an HTML error page from a reverse proxy, an empty body, a body that
 * has already been consumed (the stream is locked), or a `content-type` that
 * lies about being JSON. Callers then fall back to mapping the HTTP status.
 */
async function readErrorBody(response: Response): Promise<unknown> {
  try {
    const text = await response.text();
    return text ? (JSON.parse(text) as unknown) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Parse a `Retry-After` header into a non-negative number of seconds.
 *
 * The header is defined as either *delta-seconds* or an HTTP-date, so both
 * forms are supported. Unparseable values yield `undefined` rather than
 * poisoning `details`.
 */
function parseRetryAfterHeader(value: string | null): number | undefined {
  if (value === null) return undefined;
  const trimmed = value.trim();
  if (trimmed === '') return undefined;

  const seconds = Number(trimmed);
  if (Number.isFinite(seconds)) return Math.max(0, seconds);

  const target = Date.parse(trimmed);
  if (Number.isNaN(target)) return undefined;
  return Math.max(0, Math.ceil((target - Date.now()) / 1000));
}

/**
 * Build the typed {@link AstroidError} for a failed HTTP `Response`.
 *
 * This is the canonical entry point for turning a non-2xx response into a
 * strongly-typed error. It never throws and never returns a plain `Error` — you
 * decide whether to `throw` the result, hand it to a caller, or branch on it
 * with a guard such as {@link isRateLimitError}.
 *
 * Resolution order:
 * 1. The machine-readable `code` in the body envelope (highest fidelity).
 * 2. The HTTP `status` alone, for bodies with no usable envelope.
 * 3. The base {@link AstroidError} catch-all for unmapped statuses.
 *
 * `status`, `statusCode`, `code`, `requestId` (from the `x-request-id`
 * header), and the raw API `details` are all populated on the result. A
 * `Retry-After` header is folded into `details.retryAfter` for 429s that do not
 * already carry it in the body, so `RateLimitError.retryAfter` is populated even
 * when the body is missing or non-JSON.
 *
 * The `body` argument is optional: when omitted the response body is read and
 * parsed for you. Pass it explicitly when the body was already consumed
 * elsewhere (e.g. logged), or when you want to supply a pre-parsed value.
 *
 * Malformed input is expected, not exceptional — an HTML 502 page from a load
 * balancer still produces a correctly-typed `InternalServerError` rather than a
 * `SyntaxError` from `JSON.parse`.
 *
 * @example
 * ```ts
 * const res = await fetch('/api/wallets/wal_123');
 * if (!res.ok) throw await toAstroidError(res);
 *
 * // Or with a pre-read body:
 * const body = await res.json().catch(() => undefined);
 * if (!res.ok) throw await toAstroidError(res, body);
 * ```
 */
export async function toAstroidError(response: Response, body?: unknown): Promise<AstroidError> {
  const parsedBody = body === undefined ? await readErrorBody(response) : body;
  const requestId = response.headers.get('x-request-id') ?? undefined;

  // A body-supplied `retryAfter` is more precise than the header, so only fill
  // in the header value when the envelope did not already provide one.
  const envelopeRetryAfter = extractApiError(parsedBody)?.details?.retryAfter;
  const retryAfter =
    typeof envelopeRetryAfter === 'number'
      ? envelopeRetryAfter
      : parseRetryAfterHeader(response.headers.get('retry-after'));

  return mapStatusToError(response.status, undefined, {
    body: parsedBody,
    requestId,
    details: retryAfter === undefined ? undefined : { retryAfter },
  });
}

/**
 * Parse an HTTP `Response` and throw the corresponding typed error.
 *
 * Thin wrapper over {@link toAstroidError} for the common fetch one-liner, so
 * there is exactly one implementation of envelope parsing in the package.
 *
 * @example
 * ```ts
 * const res = await fetch('/api/wallets');
 * if (!res.ok) await fromErrorResponse(res);
 * ```
 *
 * @throws {AstroidError} always — the function never returns.
 */
export async function fromErrorResponse(response: Response): Promise<never> {
  throw await toAstroidError(response);
}

/* -------------------------------------------------------------------------- */
/* Documented aliases (issue #126)                                             */
/* -------------------------------------------------------------------------- */

/**
 * Alias for {@link AstroidError} — the "API error" name used throughout the
 * API docs and client middleware. `err instanceof AstroidApiError` matches
 * every error the SDK throws.
 */
export const AstroidApiError = AstroidError;

/** Alias for {@link ValidationError} — request/schema validation failures. */
export const AstroidValidationError = ValidationError;

/** Alias for {@link NetworkError} — transport failures and timeouts. */
export const AstroidNetworkError = NetworkError;

/* -------------------------------------------------------------------------- */
/* Structured Stellar error mapping (issue #253)                               */
/* -------------------------------------------------------------------------- */

export {
  InsufficientBalanceError,
  TrustlineMissingError,
  StellarAuthError,
  SequenceConflictError,
  TransactionExpiredError,
  StellarMalformedError,
  StellarNetworkError,
  STELLAR_OPERATION_CODE_MAP,
  STELLAR_TRANSACTION_CODE_MAP,
  STELLAR_CODE_STATUS_MAP,
  extractStellarResultCodes,
  errorClassForStellarCode,
  mapStellarError,
  stellarCodeToApiError,
  isStellarError,
  type StellarResultCodes,
  type StellarMappingContext,
} from './stellar.js';

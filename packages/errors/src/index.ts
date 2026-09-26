/**
 * `@astroid/errors` — typed error classes for the Astroid SDK.
 *
 * Every failure surfaced by the SDK is an `AstroidError` (or subclass), never a
 * generic `Error`. Consumers can branch on `instanceof PolicyViolationError`,
 * inspect `error.code`, `error.status`, and `error.requestId`, and read
 * structured `details`.
 */

import { ApiErrorCode, type ApiError } from '@astroid/types';
export { errorClassForStatus, statusCodeToCode, mapStatusToError, errorFromStatus, extractApiError, type ErrorEnvelopeInput } from './mapper.js';

export {
  AstroidError,
  type AstroidErrorOptions,
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
  NetworkError,
  ServerError,
  InternalServerError,
} from './classes.js';
import {
  AuthenticationError,
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
    case ApiErrorCode.RATE_LIMITED:
      return RateLimitError;
    case ApiErrorCode.NETWORK_ERROR:
    case ApiErrorCode.TIMEOUT:
      return NetworkError;
    case ApiErrorCode.INTERNAL_ERROR:
    case ApiErrorCode.SERVICE_UNAVAILABLE:
      return InternalServerError;
    default:
      // Also support direct Horizon codes that may leak as API codes
      if (code === 'op_underfunded' || code === 'op_low_reserve' || code === 'tx_insufficient_balance') {
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
export function fromApiError(apiError: ApiError, context: NormalizeErrorContext = {}): AstroidError {
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
 * Parse an HTTP `Response` and throw the corresponding typed error.
 *
 * Reads the response body once, parses the JSON envelope, and builds a
 * typed `AstroidError` via {@link fromApiError} or {@link fromStatus}.
 * Useful as a one-liner in fetch-based code:
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
  const status = response.status;
  const requestId = response.headers.get('x-request-id') ?? undefined;

  let body: unknown;
  try {
    const text = await response.text();
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = undefined;
  }

  const envelope = body as
    | { error?: { code?: string; message?: string; details?: Record<string, unknown> } }
    | undefined;

  if (envelope?.error) {
    const apiError = {
      code: envelope.error.code ?? codeForStatus(status),
      message: envelope.error.message ?? `Request failed with status ${status}`,
      details: envelope.error.details,
    };
    throw fromApiError(apiError, { status, requestId });
  }

  throw fromStatus(status, `Request failed with status ${status}`, { requestId });
}

/** Type guard: is this value an Astroid SDK error? */
export function isAstroidError(value: unknown): value is AstroidError {
  return value instanceof AstroidError;
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

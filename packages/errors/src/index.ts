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

/** Structured context available on every Astroid error. */
export interface AstroidErrorOptions {
  code: string;
  status?: number;
  /** Explicit HTTP status; defaults to `status` when omitted (issue #279). */
  statusCode?: number;
  requestId?: string;
  details?: Record<string, unknown>;
  cause?: unknown;
}

/**
 * Base class for all Astroid SDK errors.
 *
 * Exposes rich diagnostic context: the machine-readable `code`, the HTTP
 * `status`/`statusCode` of the failed response, the `requestId` for log
 * correlation, and structured `details`.
 *
 * @example
 * ```ts
 * try {
 *   await astroid.transactions.create(input);
 * } catch (err) {
 *   if (err instanceof BudgetExceededError) {
 *     console.error(err.code, err.statusCode, err.details);
 *   }
 * }
 * ```
 */
export class AstroidError extends Error {
  /** Machine-readable error code (mirrors the API error code where possible). */
  readonly code: string;
  /** HTTP status code, when the error originated from an HTTP response. */
  readonly status: number | undefined;
  /**
   * HTTP status code of the failed response that produced this error.
   *
   * Alias of {@link status} provided for issue #279 parity — consumers can
   * read either property; both always carry the same value.
   */
  readonly statusCode: number | undefined;
  /** The API request id, for correlating with backend logs. */
  readonly requestId: string | undefined;
  /** Structured, machine-readable detail. */
  readonly details: Record<string, unknown> | undefined;

  constructor(message: string, options: AstroidErrorOptions) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = new.target.name;
    this.code = options.code;
    this.status = options.status;
    this.statusCode = options.statusCode ?? options.status;
    this.requestId = options.requestId;
    this.details = options.details;
    // Restore prototype chain for reliable `instanceof` across transpile targets.
    Object.setPrototypeOf(this, new.target.prototype);
  }

  /** Whether retrying the request could plausibly succeed. */
  get isRetryable(): boolean {
    return false;
  }

  /** A plain, serialisable representation (safe to log — no secrets). */
  toJSON(): Record<string, unknown> {
  return {
    name: this.name,
    message: this.message,
    code: this.code,
    status: this.status,
    statusCode: this.statusCode,
    requestId: this.requestId,
    details: this.details,
    stack: this.stack,
  };
  }
}

/**
 * Error thrown when an API request fails authentication (HTTP 401).
 *
 * Typically indicates missing or invalid API credentials, an expired bearer token,
 * or an invalid API key.
 */
export class AuthenticationError extends AstroidError {
  /**
   * Create an `AuthenticationError`.
   *
   * @param message Human-readable error message.
   * @param options Error configuration options.
   */
  constructor(message: string, options: AstroidErrorOptions) {
    super(message, options);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Error thrown when an authenticated request lacks necessary permissions (HTTP 403).
 *
 * Indicates that the client is authenticated but forbidden from accessing the requested resource
 * or performing the requested operation.
 */
export class ForbiddenError extends AstroidError {
  /**
   * Create a `ForbiddenError`.
   *
   * @param message Human-readable error message.
   * @param options Error configuration options.
   */
  constructor(message: string, options: AstroidErrorOptions) {
    super(message, options);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Alias for {@link ForbiddenError} (HTTP 403) for backwards compatibility.
 */
export const AuthorizationError = ForbiddenError;
export type AuthorizationError = ForbiddenError;

/**
 * Error thrown when a request fails schema, type, or business validation (HTTP 400/422).
 *
 * Exposes structured field-level validation errors via {@link fieldErrors} when provided by the backend.
 */
export class ValidationError extends AstroidError {
  /**
   * Create a `ValidationError`.
   *
   * @param message Human-readable error message.
   * @param options Error configuration options including validation details.
   */
  constructor(message: string, options: AstroidErrorOptions) {
    super(message, options);
    Object.setPrototypeOf(this, new.target.prototype);
  }

  /** Field-level validation issues, when the API provides them. */
  get fieldErrors(): Record<string, string[]> | undefined {
    return (this.details?.fields ?? this.details?.validationErrors) as
      | Record<string, string[]>
      | undefined;
  }
}

/**
 * Error thrown when the requested resource cannot be found (HTTP 404).
 */
export class NotFoundError extends AstroidError {
  /**
   * Create a `NotFoundError`.
   *
   * @param message Human-readable error message.
   * @param options Error configuration options.
   */
  constructor(message: string, options: AstroidErrorOptions) {
    super(message, options);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Error thrown when a request conflicts with the current resource state (HTTP 409).
 */
export class ConflictError extends AstroidError {
  /**
   * Create a `ConflictError`.
   *
   * @param message Human-readable error message.
   * @param options Error configuration options.
   */
  constructor(message: string, options: AstroidErrorOptions) {
    super(message, options);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Error thrown when a transaction is blocked because it violates one or more spending policies.
 */
export class PolicyViolationError extends AstroidError {
  /**
   * Create a `PolicyViolationError`.
   *
   * @param message Human-readable error message.
   * @param options Error configuration options.
   */
  constructor(message: string, options: AstroidErrorOptions) {
    super(message, options);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Error thrown when a transaction is blocked because the source account lacks sufficient funds.
 */
export class InsufficientFundsError extends AstroidError {
  /**
   * Create an `InsufficientFundsError`.
   *
   * @param message Human-readable error message.
   * @param options Error configuration options.
   */
  constructor(message: string, options: AstroidErrorOptions) {
    super(message, options);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Alias for {@link InsufficientFundsError} — matches the naming used in API docs and client middleware. */
export const AstroidInsufficientFundsError = InsufficientFundsError;

/** Alias for {@link PolicyViolationError} — matches the naming used in API docs and client middleware. */
export const AstroidPolicyViolationError = PolicyViolationError;

/**
 * Error thrown when a transaction is blocked because it would exceed an available budget.
 */
export class BudgetExceededError extends AstroidError {
  /**
   * Create a `BudgetExceededError`.
   *
   * @param message Human-readable error message.
   * @param options Error configuration options.
   */
  constructor(message: string, options: AstroidErrorOptions) {
    super(message, options);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Error thrown when a transaction requires human approval before it can execute.
 */
export class ApprovalRequiredError extends AstroidError {
  /**
   * Create an `ApprovalRequiredError`.
   *
   * @param message Human-readable error message.
   * @param options Error configuration options.
   */
  constructor(message: string, options: AstroidErrorOptions) {
    super(message, options);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Error thrown when request rate limits are exceeded (HTTP 429).
 *
 * Inspect {@link retryAfter} to determine how many seconds to wait before retrying.
 */
export class RateLimitError extends AstroidError {
  /**
   * Create a `RateLimitError`.
   *
   * @param message Human-readable error message.
   * @param options Error configuration options.
   */
  constructor(message: string, options: AstroidErrorOptions) {
    super(message, options);
    Object.setPrototypeOf(this, new.target.prototype);
  }

  /** Seconds to wait before retrying, from the `Retry-After` header if present. */
  get retryAfter(): number | undefined {
    const value = this.details?.retryAfter;
    return typeof value === 'number' ? value : undefined;
  }

  override get isRetryable(): boolean {
    return true;
  }
}

/**
 * Error thrown on transport-level failures (DNS resolution, connection reset, offline, or timeout).
 */
export class NetworkError extends AstroidError {
  /**
   * Create a `NetworkError`.
   *
   * @param message Human-readable error message.
   * @param options Error configuration options.
   */
  constructor(message: string, options: AstroidErrorOptions) {
    super(message, options);
    Object.setPrototypeOf(this, new.target.prototype);
  }

  override get isRetryable(): boolean {
    return true;
  }
}

/**
 * Error thrown when the backend returns a 5xx Internal Server Error or unexpected failure.
 */
export class InternalServerError extends AstroidError {
  /**
   * Create an `InternalServerError`.
   *
   * @param message Human-readable error message.
   * @param options Error configuration options.
   */
  constructor(message: string, options: AstroidErrorOptions) {
    super(message, options);
    Object.setPrototypeOf(this, new.target.prototype);
  }

  override get isRetryable(): boolean {
    return true;
  }
}

/**
 * Alias for {@link InternalServerError} — 5xx server-side failure.
 */
export const ServerError = InternalServerError;
export type ServerError = InternalServerError;

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

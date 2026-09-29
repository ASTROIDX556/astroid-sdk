/**
 * `@astroid/errors` — specialized HTTP/API error classes.
 *
 * Lives in its own module so both the package entrypoint and the Stellar
 * domain-error module (`stellar.ts`) can import the classes without circular
 * imports.
 *
 * @module
 */

import { AstroidError, type AstroidErrorOptions } from './base.js';

/** 401 — missing/invalid credentials, expired token, or invalid API key. */
export class AuthenticationError extends AstroidError {}

/** 403 — authenticated but not permitted. */
export class ForbiddenError extends AstroidError {}

/** 403 — authenticated but not permitted (alias for ForbiddenError). */
export const AuthorizationError = ForbiddenError;
export type AuthorizationError = ForbiddenError;

/** 400/422 — request failed schema or business validation. */
export class ValidationError extends AstroidError {
  /** Field-level validation issues, when the API provides them. */
  get fieldErrors(): Record<string, string[]> | undefined {
    return (this.details?.fields ?? this.details?.validationErrors) as
      | Record<string, string[]>
      | undefined;
  }
}

/** 404 — the requested resource does not exist. */
export class NotFoundError extends AstroidError {}

/** 409 — the request conflicts with the current resource state. */
export class ConflictError extends AstroidError {}

/** A transaction was blocked because it violates one or more spending policies. */
export class PolicyViolationError extends AstroidError {}

/** A transaction was blocked because the source account lacks sufficient funds. */
export class InsufficientFundsError extends AstroidError {}

/** A transaction was blocked because it would exceed an available budget. */
export class BudgetExceededError extends AstroidError {}

/** A transaction requires human approval before it can execute. */
export class ApprovalRequiredError extends AstroidError {}

/** 429 — rate limit exceeded. Inspect `retryAfter` before retrying. */
export class RateLimitError extends AstroidError {
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
 * 429 — rate limit exceeded (issue #76 naming).
 *
 * The issue's example list names the rate-limit class with the `Api` prefix;
 * the SDK's canonical name is {@link RateLimitError}. This subclass keeps the
 * documented name working so the code sample in the issue compiles verbatim
 * while `instanceof RateLimitError` continues to match every 429 the SDK
 * raises.
 */
export class ApiRateLimitError extends RateLimitError {}

/** A transport-level failure: DNS, connection reset, offline, or timeout. */
export class NetworkError extends AstroidError {
  override get isRetryable(): boolean {
    return true;
  }
}

/**
 * The caller-configured request deadline elapsed before the server responded.
 *
 * Derived from {@link NetworkError} so it is part of the core error hierarchy.
 * Like every transport failure it is retryable — no response was ever received.
 */
export class AstroidTimeoutError extends NetworkError {
  /** The deadline (in ms) that was exceeded, when known. */
  readonly timeoutMs: number | undefined;

  constructor(timeoutOrMessage: number | string, options?: AstroidErrorOptions) {
    const isDeadline = typeof timeoutOrMessage === 'number';
    super(
      isDeadline ? `Astroid request timed out after ${timeoutOrMessage}ms.` : timeoutOrMessage,
      { code: 'REQUEST_TIMEOUT', ...(options ?? {}) },
    );
    const detailTimeout =
      typeof options?.details?.timeoutMs === 'number' ? options.details.timeoutMs : undefined;
    this.timeoutMs = isDeadline ? timeoutOrMessage : detailTimeout;
  }
}

/** 5xx — the API failed to handle a valid request. */
export class InternalServerError extends AstroidError {
  override get isRetryable(): boolean {
    return true;
  }
}

/** Alias for InternalServerError — 5xx server-side failure. */
export const ServerError = InternalServerError;
export type ServerError = InternalServerError;

/**
 * `@astroid/errors` — specialized HTTP/API error classes.
 *
 * Lives in its own module so both the package entrypoint and the Stellar
 * domain-error module (`stellar.ts`) can import the classes without circular
 * imports.
 *
 * @module
 */

import { AstroidError } from './base.js';

/** 401 — missing/invalid credentials, expired token, or invalid API key. */
export class AuthenticationError extends AstroidError {}

/** 403 — authenticated but not permitted. */
export class AuthorizationError extends AstroidError {}

/** 400/422 — request failed schema or business validation. */
export class ValidationError extends AstroidError {
  /** Field-level validation issues, when the API provides them. */
  get fieldErrors(): Record<string, string[]> | undefined {
    return this.details?.fields as Record<string, string[]> | undefined;
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

/** A transport-level failure: DNS, connection reset, offline, or timeout. */
export class NetworkError extends AstroidError {
  override get isRetryable(): boolean {
    return true;
  }
}

/** 5xx — the API failed to handle a valid request. */
export class ServerError extends AstroidError {
  override get isRetryable(): boolean {
    return true;
  }
}

/**
 * `@astroid/errors` — HTTP response error factory.
 *
 * Safely maps raw HTTP responses and status codes to specific error subclasses.
 *
 * @module
 */

import {
  ApiError,
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
  InternalServerError,
} from './classes.js';
import { AstroidError, type AstroidErrorOptions } from './base.js';

/** Raw HTTP response shape for mapping. */
export interface RawHttpResponse {
  status: number;
  statusText?: string;
  body?: unknown;
  headers?: Record<string, string | string[] | undefined>;
  message?: string;
}

/**
 * Safely maps a raw HTTP response to a specific Astroid error subclass.
 */
export function createErrorFromResponse(response: RawHttpResponse): AstroidError {
  const status = response.status;
  const body = (typeof response.body === 'object' && response.body !== null
    ? response.body
    : {}) as Record<string, any>;
  const message =
    body.message ||
    body.error ||
    response.message ||
    response.statusText ||
    `HTTP Error ${status}`;

  const details: Record<string, unknown> = typeof response.body === 'object' && response.body !== null ? { ...(response.body as Record<string, unknown>) } : { body: response.body };

  if (response.headers) {
    const retryAfterHeader =
      response.headers['retry-after'] || response.headers['Retry-After'];
    if (retryAfterHeader) {
      const parsed = Number(Array.isArray(retryAfterHeader) ? retryAfterHeader[0] : retryAfterHeader);
      if (!isNaN(parsed)) {
        details.retryAfter = parsed;
      }
    }
  }

  const options: AstroidErrorOptions = { status, details, code: body.code };

  if (status === 400 || status === 422) {
    if (body?.code === 'POLICY_VIOLATION' || body?.policyId) {
      return new PolicyViolationError(message, options);
    }
    if (body?.code === 'INSUFFICIENT_FUNDS') {
      return new InsufficientFundsError(message, options);
    }
    if (body?.code === 'BUDGET_EXCEEDED') {
      return new BudgetExceededError(message, options);
    }
    if (body?.code === 'APPROVAL_REQUIRED') {
      return new ApprovalRequiredError(message, options);
    }
    return new ValidationError(message, options);
  }

  if (status === 401) {
    return new AuthenticationError(message, options);
  }

  if (status === 403) {
    return new ForbiddenError(message, options);
  }

  if (status === 404) {
    return new NotFoundError(message, options);
  }

  if (status === 409) {
    return new ConflictError(message, options);
  }

  if (status === 429) {
    return new RateLimitError(message, options);
  }

  if (status >= 500) {
    return new InternalServerError(message, options);
  }

  return new ApiError(message, options);
}

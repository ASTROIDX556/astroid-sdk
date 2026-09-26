/**
 * `@astroid/errors` — HTTP status/response-to-error mapping utilities.
 *
 * This module is the bridge between raw HTTP failures and the typed Astroid
 * error hierarchy. It maps HTTP response status codes — and, when available,
 * the parsed error envelope from the response body — into the correct
 * specialized error subclass so consumers can branch on `instanceof` instead
 * of string-matching error messages.
 *
 * Mapping rules (checked in priority order):
 *
 * 1. **API error code** — when the response body contains
 *    `{ error: { code, message, details } }`, the machine-readable code wins.
 *    Codes are resolved through {@link errorClassForCode}.
 * 2. **HTTP status** — when no usable code is present, the status code alone
 *    determines the error class via {@link errorClassForStatus}.
 * 3. **Fallback** — anything unrecognized becomes a base {@link AstroidError}.
 *
 * @example
 * ```ts
 * import { mapStatusToError } from '@astroid/errors';
 *
 * // Status only:
 * mapStatusToError(404, 'Wallet not found');
 * // → NotFoundError with code 'NOT_FOUND', statusCode 404
 *
 * // Status + envelope:
 * mapStatusToError(429, 'Slow down', {
 *   body: { error: { code: 'RATE_LIMITED', message: 'Slow down', details: { retryAfter: 30 } } },
 * });
 * // → RateLimitError with retryAfter === 30
 * ```
 *
 * @module
 */

import { ApiErrorCode, type ApiError } from '@astroid/types';
import {
  AstroidError,
  AuthenticationError,
  AuthorizationError,
  ValidationError,
  NotFoundError,
  ConflictError,
  RateLimitError,
  ServerError,
  errorClassForCode,
  type AstroidErrorOptions,
} from './index.js';

/* -------------------------------------------------------------------------- */
/* HTTP status → error class                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Map an HTTP response status code to the specialized error class that best
 * represents it. Used as the fallback when the response body carries no
 * machine-readable error code.
 *
 * @example
 * ```ts
 * errorClassForStatus(429); // → RateLimitError
 * errorClassForStatus(500); // → ServerError
 * errorClassForStatus(418); // → AstroidError (no more specific class applies)
 * ```
 */
export function errorClassForStatus(status: number): typeof AstroidError {
  if (status === 401) return AuthenticationError;
  if (status === 403) return AuthorizationError;
  if (status === 404) return NotFoundError;
  if (status === 409) return ConflictError;
  if (status === 400 || status === 422) return ValidationError;
  if (status === 429) return RateLimitError;
  if (status >= 500) return ServerError;
  return AstroidError;
}

/**
 * Infer a machine-readable error code from an HTTP status when the API did not
 * supply one (e.g. a bare 502 from a proxy). Always returns a valid
 * {@link ApiErrorCode}-style string so errors remain consistently typed.
 */
export function statusCodeToCode(status: number): string {
  if (status === 401) return ApiErrorCode.AUTHENTICATION_ERROR;
  if (status === 403) return ApiErrorCode.FORBIDDEN;
  if (status === 404) return ApiErrorCode.NOT_FOUND;
  if (status === 409) return ApiErrorCode.CONFLICT;
  if (status === 400 || status === 422) return ApiErrorCode.VALIDATION_ERROR;
  if (status === 429) return ApiErrorCode.RATE_LIMITED;
  if (status >= 500) return ApiErrorCode.INTERNAL_ERROR;
  return ApiErrorCode.BAD_REQUEST;
}

/* -------------------------------------------------------------------------- */
/* Envelope extraction                                                         */
/* -------------------------------------------------------------------------- */

/**
 * The minimal error-envelope shapes {@link mapStatusToError} understands in a
 * response body.
 */
export interface ErrorEnvelopeInput {
  /** Body of the failed HTTP response, if it could be read/parsed. */
  body?: unknown;
  /** Value of the `x-request-id` response header, when present. */
  requestId?: string;
  /** Extra structured detail to merge into the built error. */
  details?: Record<string, unknown>;
  /** Underlying cause (e.g. the original transport failure). */
  cause?: unknown;
}

/**
 * Extract the `{ code, message, details }` API error from a response body.
 * Understands both the standard envelope (`{ error: { code, message } }`) and
 * a flat top-level shape (`{ code, message }`). Returns `undefined` when no
 * usable envelope is present.
 */
export function extractApiError(body: unknown): ApiError | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const obj = body as Record<string, unknown>;

  const errorField = obj.error;
  if (typeof errorField === 'object' && errorField !== null) {
    const err = errorField as Record<string, unknown>;
    if (typeof err.code === 'string' && typeof err.message === 'string') {
      return {
        code: err.code,
        message: err.message,
        details:
          typeof err.details === 'object' && err.details !== null
            ? (err.details as Record<string, unknown>)
            : undefined,
      };
    }
  }

  // Flat shape: { code, message } at the top level
  if (typeof obj.code === 'string' && typeof obj.message === 'string') {
    return {
      code: obj.code,
      message: obj.message,
      details:
        typeof obj.details === 'object' && obj.details !== null
          ? (obj.details as Record<string, unknown>)
          : undefined,
    };
  }

  return undefined;
}

/** Best-effort human-readable message extraction from a response body. */
function extractMessage(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const obj = body as Record<string, unknown>;

  const errorField = obj.error;
  if (typeof errorField === 'object' && errorField !== null) {
    const msg = (errorField as Record<string, unknown>).message;
    if (typeof msg === 'string') return msg;
  }
  if (typeof obj.message === 'string') return obj.message;
  if (typeof obj.detail === 'string') return obj.detail;
  if (typeof obj.title === 'string') return obj.title;
  if (typeof obj.error === 'string') return obj.error;
  return undefined;
}

/* -------------------------------------------------------------------------- */
/* Core mapping                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Map a failed HTTP response (status + optional body) to a strongly-typed
 * {@link AstroidError} subclass instance.
 *
 * Resolution order:
 * 1. A machine-readable error **code** from the body envelope (via
 *    {@link errorClassForCode}) — highest fidelity.
 * 2. The HTTP **status** code alone (via {@link errorClassForStatus}).
 * 3. The base {@link AstroidError} as a catch-all.
 *
 * The original `message` is always preserved, and diagnostic properties
 * (`statusCode`, `status`, `code`, `requestId`, `details`) are populated from
 * the response where available.
 *
 * @param status   The HTTP response status code.
 * @param message  A human-readable message; when omitted it is extracted from
 *                 the body, falling back to `Request failed with status <n>`.
 * @param context  Optional body / requestId / details / cause.
 * @returns The instantiated error — throw it, or inspect it programmatically.
 *
 * @example
 * ```ts
 * const err = mapStatusToError(403, 'Not allowed');
 * err instanceof AuthorizationError; // true
 * err.statusCode;                    // 403
 * ```
 */
export function mapStatusToError(
  status: number,
  message?: string,
  context: ErrorEnvelopeInput = {},
): AstroidError {
  const envelope = extractApiError(context.body);
  const resolvedMessage =
    message ?? envelope?.message ?? extractMessage(context.body) ?? `Request failed with status ${status}`;

  // 1. Body code wins — it is the most specific signal.
  if (envelope) {
    const ErrorClass = errorClassForCode(envelope.code);
    const details = { ...(envelope.details ?? {}), ...(context.details ?? {}) };
    return new ErrorClass(resolvedMessage, {
      code: envelope.code,
      status,
      statusCode: status,
      requestId: context.requestId,
      details: Object.keys(details).length > 0 ? details : undefined,
      cause: context.cause,
    });
  }

  // 2. Status-only mapping.
  const ErrorClass = errorClassForStatus(status);
  return new ErrorClass(resolvedMessage, {
    code: statusCodeToCode(status),
    status,
    statusCode: status,
    requestId: context.requestId,
    details: context.details,
    cause: context.cause,
  });
}

/**
 * Convenience wrapper for building typed errors from a status alone, with an
 * explicit message. Equivalent to {@link mapStatusToError} without a body.
 */
export function errorFromStatus(
  status: number,
  message: string,
  context: Omit<ErrorEnvelopeInput, 'body'> = {},
): AstroidError {
  return mapStatusToError(status, message, context);
}

/**
 * Options shape accepted by class constructors across `@astroid/errors`.
 * Re-exported here so the mapper module is self-contained for consumers that
 * build errors manually.
 */
export type { AstroidErrorOptions };

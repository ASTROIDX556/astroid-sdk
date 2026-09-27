/**
 * `@astroid/errors` — base error class.
 *
 * Contains the root {@link AstroidError} of the SDK error hierarchy in its own
 * module so specialized error modules (e.g. `stellar.ts`) can extend it without
 * creating circular imports with the package entrypoint.
 *
 * @module
 */

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
 * Whether {@link AstroidError.toJSON} serializes the stack trace.
 *
 * Defaults to `true` so local development keeps full diagnostics. Production
 * entrypoints should set it to `false` **before** any error is constructed so
 * serialized error payloads never leak internal paths, hostnames or source
 * lines to logs, wire responses, or third-party collectors (issue #76).
 *
 * @example
 * ```ts
 * // process entrypoint, before handling any request:
 * import { setIncludeStackInErrors } from '@astroid/errors';
 * setIncludeStackInErrors(process.env.NODE_ENV === 'development');
 * ```
 */
let includeStackInErrors = true;

/** Configure whether {@link AstroidError.toJSON} serializes the stack trace. */
export function setIncludeStackInErrors(include: boolean): void {
  includeStackInErrors = include;
}

/** Read the current stack-serialization setting (mostly for tests). */
export function getIncludeStackInErrors(): boolean {
  return includeStackInErrors;
}

/**
 * Serialisable form of an {@link AstroidError}, matching the API error payload
 * structure (`ApiError` in `@astroid/types`) so error envelopes can be relayed
 * to callers or telemetry backends verbatim (issue #76).
 */
export interface SerializedAstroidError {
  name: string;
  message: string;
  /** Machine-readable error code. */
  code: string;
  /** HTTP status, when the error originated from an HTTP response. */
  status?: number;
  /**
   * HTTP status alias of {@link status}, always the same value. Consumers can
   * read either name, mirroring the `error.statusCode` field used by some
   * API error payloads.
   */
  statusCode?: number;
  /** API request id for correlating with backend logs, when known. */
  requestId?: string;
  /** Structured, machine-readable detail, when present. */
  details?: Record<string, unknown>;
  /**
   * Stack trace — only present when stack serialization is enabled via
   * {@link setIncludeStackInErrors} (enabled by default, disabled in
   * production so internal paths never leak).
   */
  stack?: string;
}

/**
 * Base class for all Astroid SDK errors.
 *
 * Consumers can branch on `instanceof` for any subclass, and inspect
 * `error.code`, `error.status`, `error.requestId`, and structured `details`.
 *
 * @example
 * ```ts
 * try {
 *   await astroid.transactions.create(input);
 * } catch (err) {
 *   if (err instanceof BudgetExceededError) {
 *     console.error(err.code, err.details);
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

  /**
   * Alias for {@link code} using the `errorCode` spelling from the API error
   * envelope, so callers can branch on either name.
   */
  get errorCode(): string {
    return this.code;
  }

  /**
   * Whether this error instance is safe to retry.
   *
   * Alias of {@link isRetryable} using the `retryable` spelling common in API
   * error envelopes, so callers can branch on either name.
   */
  get retryable(): boolean {
    return this.isRetryable;
  }

  /** Whether retrying the request could plausibly succeed. */
  get isRetryable(): boolean {
    return false;
  }

  /**
   * A plain, serialisable representation matching the API error payload
   * structure — safe to log and to relay to callers as an `ApiError`-shaped
   * envelope.
   *
   * The stack trace is included only while stack serialization is enabled
   * (default). Call {@link setIncludeStackInErrors}(false) at the production
   * entrypoint so internal paths never leak through serialized payloads
   * (issue #76). No secrets are ever serialized.
   */
  toJSON(): SerializedAstroidError {
    const payload: SerializedAstroidError = {
      name: this.name,
      message: this.message,
      code: this.code,
      status: this.status,
      statusCode: this.statusCode,
      requestId: this.requestId,
      details: this.details,
    };
    if (includeStackInErrors) {
      payload.stack = this.stack;
    }
    return payload;
  }
}

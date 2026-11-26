/**
 * `@astroid/client` — public configuration types.
 *
 * This module is the canonical home of the retry configuration surface
 * accepted by `new Astroid({ ... })` (issue #559):
 *
 * - {@link RetryClientOptions} — the shorthand knobs (`maxRetries`,
 *   `baseDelayMs`, `retries`, `minTimeout`, …) that are merged into the core
 *   `retry` block before the transport is built.
 * - {@link RetryOptions} — the user-facing retry policy (re-exported from
 *   `@astroid/core`).
 * - {@link RetryConfig} — the fully-resolved policy with every default applied.
 * - {@link RetryMiddlewareConfig} — per-middleware overrides for
 *   `createRetryMiddleware(...)`.
 *
 * Keeping the retry types in one place means consumers can import them without
 * pulling in the `Astroid` client class:
 *
 * ```ts
 * import type { RetryClientOptions, RetryConfig } from '@astroid/client/client';
 *
 * const retry: RetryClientOptions = { maxRetries: 5, baseDelayMs: 200 };
 * const astroid = new Astroid({ apiKey: 'sk_live_...', ...retry });
 * ```
 *
 * @module
 */

import type { RetryConfig, RetryOptions } from '@astroid/core';

export type { RetryConfig, RetryOptions } from '@astroid/core';
export type { RetryMiddlewareConfig } from './middleware/retry.js';

/**
 * Retry parameters accepted directly by the client constructor.
 *
 * These are conveniences over the core `retry` block: each field is normalised
 * into a {@link RetryOptions} value and merged into `config.retry`, with the
 * shorthand winning over the equivalent `retry.*` key. Mutations (POST/PATCH)
 * are only retried when explicitly flagged; GET/PUT/DELETE retry by default.
 *
 * @example
 * ```ts
 * const astroid = new Astroid({
 *   apiKey: 'sk_live_...',
 *   maxRetries: 4,       // shorthand for retry.maxRetries
 *   baseDelayMs: 200,    // shorthand for retry.baseDelayMs
 *   maxDelayMs: 8_000,   // cap, including Retry-After waits
 *   jitter: false,       // deterministic delays (useful in tests)
 * });
 * ```
 */
export interface RetryClientOptions extends RetryOptions {
  /** Alias for `maxRetries`. */
  retries?: number;
  /** Alias for `baseDelayMs`. */
  minTimeout?: number;
  /** Alias for `maxDelayMs`. */
  maxTimeout?: number;
  /** Alias for `backoffFactor`. */
  factor?: number;
  /**
   * Base retry delay in ms. Legacy alias for `baseDelayMs` / `minTimeout`.
   * @deprecated Prefer `baseDelayMs` or `minTimeout`.
   */
  retryDelay?: number;
  /** Alias for `retry` — accepts a partial retry policy or `false` to disable. */
  retryPolicy?: boolean | Partial<RetryConfig>;
  /** Alias for `retryPolicy`. */
  retryOptions?: boolean | Partial<RetryConfig>;
}

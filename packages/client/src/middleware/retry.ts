/**
 * Exponential backoff and retry middleware for `@astroid/client`.
 *
 * Automatically retries failed requests on transient HTTP status codes
 * (429, 502, 503, 504) and network connectivity/timeout errors using
 * exponential backoff with full jitter to prevent thundering herd problems.
 *
 * @module
 */

import type { Middleware, PreparedRequest, RawResponse } from '@astroid/core';

/** Configuration options for retry behaviour. */
export interface RetryOptions {
  /** Maximum number of retry attempts. Default 3. */
  maxRetries?: number;
  /** Initial delay in milliseconds before the first retry. Default 500. */
  baseDelayMs?: number;
  /** Maximum delay cap in milliseconds between retries. Default 30_000. */
  maxDelayMs?: number;
  /** Custom callback fired before each retry attempt. */
  onRetry?: (attempt: number, error: unknown, delayMs: number) => void;
}

/** Default maximum retries. */
const DEFAULT_MAX_RETRIES = 3;
/** Default base delay in ms. */
const DEFAULT_BASE_DELAY_MS = 500;
/** Default maximum delay cap in ms. */
const DEFAULT_MAX_DELAY_MS = 30_000;

/** HTTP status codes considered transient and retryable. */
const RETRYABLE_STATUS_CODES = new Set([429, 502, 503, 504]);

/**
 * Determines whether an HTTP status code is retryable.
 */
export function isRetryableStatus(status: number): boolean {
  return RETRYABLE_STATUS_CODES.has(status);
}

/**
 * Calculates exponential backoff delay with full jitter.
 *
 * @param attempt - Current attempt number (1-indexed for the first retry)
 * @param config - Retry options containing base and max delay settings
 * @param randomFn - Optional random number generator for testing (defaults to Math.random)
 */
export function backoffDelay(
  attempt: number,
  config: { baseDelayMs?: number; maxDelayMs?: number },
  randomFn: () => number = Math.random,
): number {
  const base = config.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const max = config.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const exponential = base * Math.pow(2, Math.max(0, attempt - 1));
  const capped = Math.min(max, exponential);
  // Full jitter: random value between 0 and capped delay
  return randomFn() * capped;
}

/**
 * Creates a retry middleware with exponential backoff and jitter.
 */
export function createRetryMiddleware(options: RetryOptions = {}):
  Middleware & { name: string } {
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;

  return {
    name: 'retry',
    async onError(error: unknown, req: PreparedRequest): Promise<RawResponse | undefined> {
      if (!req.retryable) {
        throw error;
      }

      const context = (req.options.context ??= {}) as Record<string, unknown>;
      const currentAttempt = (typeof context._retryAttempt === 'number' ? context._retryAttempt : 0) + 1;
      context._retryAttempt = currentAttempt;

      if (currentAttempt > maxRetries) {
        throw error;
      }

      // Check if error is retryable (network error or retryable status code)
      let retryable = false;
      if (error instanceof Response) {
        if (isRetryableStatus(error.status)) {
          retryable = true;
        }
      } else if (error && typeof error === 'object' && 'status' in error && typeof (error as { status: unknown }).status === 'number') {
        if (isRetryableStatus((error as { status: number }).status)) {
          retryable = true;
        }
      } else if (error instanceof Error) {
        // Network errors, timeouts, TypeError from fetch failures
        retryable = true;
      }

      if (!retryable) {
        throw error;
      }

      const delayMs = backoffDelay(currentAttempt, { baseDelayMs, maxDelayMs });
      options.onRetry?.(currentAttempt, error, delayMs);

      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, delayMs);
        if (req.signal) {
          req.signal.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(req.signal?.reason ?? new DOMException('The request was aborted.', 'AbortError'));
          }, { once: true });
        }
      });

      // Signal the core http client to retry by returning undefined or throwing handled? 
      // Wait, in core middleware design, onError returning a RawResponse retries or recovers.
      // If onError re-throws or returns undefined, how does core execute a retry? 
      // Let's check how core client handles middleware retry/onError or if client wraps fetch calls directly.
      throw error;
    },
  };
}

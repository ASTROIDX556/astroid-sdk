/**
 * Exponential backoff with full jitter, and the retry decision helper.
 */

import type { RetryConfig } from './config.js';

/**
 * Compute the delay (ms) before retry `attempt` (1-based) using exponential
 * backoff with full jitter, capped at `maxDelayMs`.
 *
 * A `random` function is injected so callers/tests stay deterministic; it
 * defaults to `Math.random`.
 */
export function backoffDelay(
  attempt: number,
  config: RetryConfig,
  random: () => number = Math.random,
): number {
  const exponential = config.baseDelayMs * 2 ** (attempt - 1);
  const capped = Math.min(exponential, config.maxDelayMs);
  // Full jitter: a random point in [0, capped].
  return Math.floor(random() * capped);
}

/** Retry rate limits and server failures; other 4xx responses need correction. */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

/** Sleep for `ms`, resolving early (rejecting) if the signal aborts. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

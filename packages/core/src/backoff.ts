/**
 * Exponential backoff with jitter, and the retry decision helper.
 */

import type { RetryConfig } from './config.js';

/**
 * Compute the delay (ms) before retry `attempt` (1-based) using exponential
 * backoff capped at `maxDelayMs`.
 *
 * By default the capped delay is passed through full jitter (a random point in
 * `[0, capped]`) so fleets of agents do not retry in lockstep. Set
 * `config.jitter` to `false` for deterministic, un-jittered delays.
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
  // Full jitter unless explicitly disabled.
  return config.jitter === false ? capped : Math.floor(random() * capped);
}

/**
 * HTTP statuses retried by default: rate limiting (`429`) and the gateway /
 * transient server errors (`502`, `503`, `504`).
 *
 * Every other status — including `4xx` client errors and `500` — is treated as
 * non-transient unless the caller supplies their own `retryableStatuses`.
 */
export const DEFAULT_RETRYABLE_STATUSES: readonly number[] = [429, 502, 503, 504];

/**
 * Whether a response status warrants a retry.
 *
 * @param status   The HTTP status code to classify.
 * @param statuses The allow-list of retryable statuses. Defaults to
 *                 {@link DEFAULT_RETRYABLE_STATUSES}.
 */
export function isRetryableStatus(
  status: number,
  statuses: readonly number[] = DEFAULT_RETRYABLE_STATUSES,
): boolean {
  return statuses.includes(status);
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

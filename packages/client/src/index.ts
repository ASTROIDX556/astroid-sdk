/**
 * Typed HTTP client for the Astroid REST API.
 *
 * @module
 */

import type { HttpMethod, Middleware, PreparedRequest, RawResponse, RetryOptions } from '@astroid/core';
import { HttpClient } from '@astroid/core';

// Re-export core types and errors for convenience
export {
  HttpClient,
  backoffDelay,
  isRetryableStatus,
  createRetryMiddleware,
  retryMiddleware,
} from '@astroid/core';
export type {
  PreparedRequest,
  RawResponse,
  Middleware,
  RetryOptions,
} from '@astroid/core';

export * from './errors.js';
export { createCorrelationMiddleware } from './middleware/correlation.js';
export { createErrorTranslatorMiddleware } from './middleware/error.js';
export { createRateLimiterMiddleware } from './middleware/rate-limiter.js';

/** Options for configuring the Astroid client. */
export interface AstroidClientOptions {
  /** API key for authenticating requests. */
  apiKey?: string;
  /** Base URL for the Astroid API. Default: https://api.astroid.sh/v1 */
  baseUrl?: string;
  /** Custom fetch implementation (e.g. node-fetch or global fetch). */
  fetch?: typeof fetch;
  /** Global retry configuration or false to disable. */
  retry?: RetryOptions | false;
  /** Number of retries or retry options. */
  retries?: number | RetryOptions | false;
  /** Default request timeout in milliseconds. */
  timeout?: number;
  /** Rate limiting options. */
  rateLimit?: {
    maxRequestsPerSecond?: number;
    burstCapacity?: number;
    maxQueueLength?: number;
    queueTimeoutMs?: number;
  };
}

/**
 * Main Astroid SDK HTTP Client.
 */
export class Astroid {
  private readonly client: HttpClient;

  constructor(options: AstroidClientOptions = {}) {
    let retryOpt: RetryOptions | false | undefined = options.retry;
    if (retryOpt === undefined && options.retries !== undefined) {
      if (typeof options.retries === 'number') {
        retryOpt = { maxRetries: options.retries };
      } else {
        retryOpt = options.retries;
      }
    }

    this.client = new HttpClient({
      apiKey: options.apiKey,
      baseUrl: options.baseUrl,
      fetch: options.fetch,
      retry: retryOpt,
      timeoutMs: options.timeout,
      rateLimit: options.rateLimit,
    });
  }

  /** Register middleware. */
  use(middleware: Middleware): this {
    this.client.use(middleware);
    return this;
  }

  /** Execute an arbitrary HTTP request. */
  async request<T>(method: HttpMethod, path: string, options: { query?: Record<string, unknown>; body?: unknown; headers?: Record<string, string>; timeout?: number; signal?: AbortSignal; retry?: RetryOptions | false } = {}): Promise<T> {
    return this.client.request<T>(method, path, options);
  }

  // Resource namespaces
  get wallets() {
    return {
      get: async (id: string) => this.client.request<any>('GET', `/wallets/${id}`),
      list: async () => this.client.request<any>('GET', '/wallets'),
    };
  }
}

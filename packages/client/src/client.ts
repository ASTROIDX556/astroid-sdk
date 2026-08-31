/**
 * Astroid REST client implementation.
 *
 * @module
 */

import { HttpClient, type ClientConfig, type RequestOptions } from '@astroid/core';
import { AgentsResource } from '@astroid/agent';
import { WalletsResource } from '@astroid/wallet';
import { TransactionsResource } from '@astroid/transaction';
import { PoliciesResource } from '@astroid/policy';
import { BudgetsResource } from '@astroid/budget';
import { AnalyticsResource } from '@astroid/analytics';
import { AuthResource } from '@astroid/auth';
import { WebhooksResource } from '@astroid/webhook';
import { NotificationsResource } from '@astroid/notification';

import { createErrorTranslatorMiddleware } from './middleware/error.js';
import { createRateLimiterMiddleware, type RateLimitMiddlewareOptions } from './middleware/rate-limiter.js';
import { createCorrelationMiddleware } from './middleware/correlation.js';
import { createRetryMiddleware, type RetryOptions } from './middleware/retry.js';

/** Configuration options for {@link AstroidClient}. */
export interface AstroidClientConfig extends ClientConfig {
  /** Rate limiting options. */
  rateLimit?: RateLimitMiddlewareOptions | boolean;
  /** Retry configuration options or boolean flag. */
  retry?: RetryOptions | boolean;
  /** Maximum number of retries (shorthand option). */
  retries?: number;
  /** Base retry delay in ms (shorthand option). */
  retryDelay?: number;
}

/**
 * Astroid API Client.
 */
export class AstroidClient {
  readonly http: HttpClient;
  readonly agents: AgentsResource;
  readonly wallets: WalletsResource;
  readonly transactions: TransactionsResource;
  readonly policies: PoliciesResource;
  readonly budgets: BudgetsResource;
  readonly analytics: AnalyticsResource;
  readonly auth: AuthResource;
  readonly webhooks: WebhooksResource;
  readonly notifications: NotificationsResource;

  constructor(config: AstroidClientConfig) {
    this.http = new HttpClient(config);

    // Register core middleware
    this.http.use(createCorrelationMiddleware());
    this.http.use(createErrorTranslatorMiddleware());

    if (config.rateLimit !== false) {
      const opts = typeof config.rateLimit === 'object' ? config.rateLimit : undefined;
      this.http.use(createRateLimiterMiddleware(opts));
    }

    if (config.retry !== false) {
      const retryOpts: RetryOptions = {};
      if (typeof config.retry === 'object' && config.retry !== null) {
        Object.assign(retryOpts, config.retry);
      }
      if (typeof config.retries === 'number') {
        retryOpts.maxRetries = config.retries;
      }
      if (typeof config.retryDelay === 'number') {
        retryOpts.baseDelayMs = config.retryDelay;
      }
      this.http.use(createRetryMiddleware(retryOpts));
    }

    this.agents = new AgentsResource(this.http);
    this.wallets = new WalletsResource(this.http);
    this.transactions = new TransactionsResource(this.http);
    this.policies = new PoliciesResource(this.http);
    this.budgets = new BudgetsResource(this.http);
    this.analytics = new AnalyticsResource(this.http);
    this.auth = new AuthResource(this.http);
    this.webhooks = new WebhooksResource(this.http);
    this.notifications = new NotificationsResource(this.http);
  }

  /** Register a custom middleware. */
  use(middleware: Parameters<HttpClient['use']>[0]): this {
    this.http.use(middleware);
    return this;
  }

  /** Perform a raw GET request. */
  async get<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.http.get<T>(path, options);
  }

  /** Perform a raw POST request. */
  async post<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.http.post<T>(path, body, options);
  }

  /** Perform a raw PUT request. */
  async put<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.http.put<T>(path, body, options);
  }

  /** Perform a raw DELETE request. */
  async delete<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.http.delete<T>(path, options);
  }
}

export { AstroidClient as Astroid };

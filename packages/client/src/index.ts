import { HttpClient, type HttpClientOptions } from '@astroid/core';
import { SessionManager, createSessionMiddleware, type SessionTokens } from '@astroid/auth';
import { AuthenticationError } from '@astroid/errors';
import { AgentResource } from '@astroid/agent';
import { WalletResource } from '@astroid/wallet';
import { PolicyResource } from '@astroid/policy';
import { BudgetResource } from '@astroid/budget';
import { AuthResource } from '@astroid/auth';
import { createCorrelationMiddleware } from './middleware/correlation.js';
import { createRateLimiterMiddleware } from './middleware/rate-limiter.js';
import { createErrorTranslatorMiddleware } from './middleware/error.js';
import { createRetryMiddleware } from './middleware/retry.js';

export interface AstroidClientOptions extends HttpClientOptions {
  apiKey?: string;
  accessToken?: string;
  refreshToken?: string;
  onTokenUpdate?: (tokens: SessionTokens) => void | Promise<void>;
  onTokenRefresh?: (refreshToken: string) => Promise<SessionTokens>;
  rateLimit?: {
    maxRequestsPerSecond?: number;
    burstCapacity?: number;
    maxQueueLength?: number;
    queueTimeoutMs?: number;
  };
  retry?: {
    maxRetries?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
    onRetry?: (attempt: number, error: unknown, delayMs: number) => void;
  } | false;
  correlationId?: string;
}

export class Astroid extends HttpClient {
  public readonly agents: AgentResource;
  public readonly wallets: WalletResource;
  public readonly policies: PolicyResource;
  public readonly budgets: BudgetResource;
  public readonly auth: AuthResource;
  public readonly sessionManager: SessionManager;

  constructor(options: AstroidClientOptions = {}) {
    const sessionManager = new SessionManager({
      accessToken: options.accessToken,
      refreshToken: options.refreshToken,
      onTokenUpdate: options.onTokenUpdate,
    });

    const refreshFn = options.onTokenRefresh ?? (async (refreshToken: string) => {
      const authResource = new AuthResource(new HttpClient({ baseUrl: options.baseUrl, fetch: options.fetch }));
      const res = await authResource.refreshToken(refreshToken);
      return {
        accessToken: res.accessToken,
        refreshToken: res.refreshToken,
        tokenType: res.tokenType ?? 'Bearer',
        expiresIn: res.expiresIn,
      };
    });

    super({
      ...options,
      headers: {
        ...(options.apiKey ? { 'x-api-key': options.apiKey } : {}),
        ...options.headers,
      },
    });

    this.sessionManager = sessionManager;

    // Register middleware stack
    this.use(createCorrelationMiddleware());
    this.use(createSessionMiddleware(sessionManager, refreshFn));

    if (options.rateLimit !== false) {
      this.use(createRateLimiterMiddleware(options.rateLimit));
    }

    if (options.retry !== false) {
      this.use(createRetryMiddleware(options.retry));
    }

    this.use(createErrorTranslatorMiddleware());

    this.agents = new AgentResource(this);
    this.wallets = new WalletResource(this);
    this.policies = new PolicyResource(this);
    this.budgets = new BudgetResource(this);
    this.auth = new AuthResource(this);
  }
}

export * from './middleware/correlation.js';
export * from './middleware/rate-limiter.js';
export * from './middleware/error.js';
export * from './middleware/retry.js';
export { backoffDelay, isRetryableStatus } from './middleware/retry.js';

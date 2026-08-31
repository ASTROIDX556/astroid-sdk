import { HttpClient, type HttpClientOptions, type HttpRequestOptions } from '@astroid/core';

export interface AstroidClientOptions extends HttpClientOptions {
  apiKey?: string;
  retry?: boolean | { maxAttempts?: number; baseDelayMs?: number };
  rateLimit?: {
    maxRequestsPerSecond?: number;
    burstCapacity?: number;
    maxQueueLength?: number;
    queueTimeoutMs?: number;
  };
}

export class Astroid {
  private httpClient: HttpClient;

  constructor(options: AstroidClientOptions = {}) {
    const headers: Record<string, string> = {
      ...(options.headers || {}),
    };
    if (options.apiKey) {
      headers['Authorization'] = `Bearer ${options.apiKey}`;
    }
    this.httpClient = new HttpClient({
      ...options,
      headers,
    });
  }

  public use(_middleware: any): this {
    return this;
  }

  public wallets = {
    get: async (id: string, options?: Omit<HttpRequestOptions, 'method' | 'path'>) => {
      const res = await this.httpClient.get<{ data: any }>(`/wallets/${id}`, options);
      return res.body.data ?? res.body;
    },
  };

  public agents = {
    get: async (id: string, options?: Omit<HttpRequestOptions, 'method' | 'path'>) => {
      const res = await this.httpClient.get<{ data: any }>(`/agents/${id}`, options);
      return res.body.data ?? res.body;
    },
  };
}

export { createRateLimiterMiddleware } from './middleware/rate-limiter.js';
export { createCorrelationMiddleware } from './middleware/correlation.js';
export { createErrorTranslatorMiddleware } from './middleware/error.js';

export * from './error-parser-middleware.js';
export * from './errors.js';
export * from './middleware/correlation.js';
export * from './middleware/error.js';
export * from './middleware/rate-limiter.js';
export * from './query.js';

import { HttpClient } from '@astroid/core';
import type { ClientConfig } from '@astroid/core';
import { serializeQuery, type QueryParams } from './query.js';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path?: string;
  headers?: Record<string, string>;
  query?: QueryParams;
  correlationId?: string;
  timeoutMs?: number;
  retryable?: boolean;
  signal?: AbortSignal;
  context?: Record<string, unknown>;
}

export class Astroid extends HttpClient {
  constructor(config: ClientConfig) {
    super(config);
  }

  public async request<T = unknown>(options: RequestOptions): Promise<T> {
    const queryString = serializeQuery(options.query);
    const pathWithQuery = `${options.path ?? ''}${queryString}`;
    return super.request<T>({
      ...options,
      path: pathWithQuery,
    });
  }

  public readonly wallets = {
    get: async (id: string, options?: { query?: QueryParams }) => {
      return this.request<{ data: any }>({ method: 'GET', path: `/wallets/${id}`, query: options?.query });
    },
    list: async (options?: { query?: QueryParams }) => {
      return this.request<{ data: any[] }>({ method: 'GET', path: '/wallets', query: options?.query });
    },
    balance: async (id: string, options?: { query?: QueryParams }) => {
      return this.request<{ data: any }>({ method: 'GET', path: `/wallets/${id}/balance`, query: options?.query });
    },
  };

  public readonly agents = {
    get: async (id: string, options?: { query?: QueryParams }) => {
      return this.request<{ data: any }>({ method: 'GET', path: `/agents/${id}`, query: options?.query });
    },
    list: async (options?: { query?: QueryParams }) => {
      return this.request<{ data: any[] }>({ method: 'GET', path: '/agents', query: options?.query });
    },
  };

  public readonly transactions = {
    get: async (id: string, options?: { query?: QueryParams }) => {
      return this.request<{ data: any }>({ method: 'GET', path: `/transactions/${id}`, query: options?.query });
    },
    list: async (options?: { query?: QueryParams }) => {
      return this.request<{ data: any[] }>({ method: 'GET', path: '/transactions', query: options?.query });
    },
  };
}

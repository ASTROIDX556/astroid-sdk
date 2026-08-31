/**
 * @astroid/client entry point.
 */

import type { PaginationParams, PaginatedResponse } from '@astroid/types';
import type { QueryValue, AstroidResponse } from '@astroid/core';
import { serializePaginationParams } from './pagination.js';

export { serializePaginationParams, unwrapPaginatedResponse } from './pagination.js';

export interface AstroidClientConfig {
  apiKey: string;
  baseUrl: string;
  fetch?: typeof fetch;
  retry?: boolean | { maxAttempts?: number; baseDelayMs?: number };
  rateLimit?: {
    maxRequestsPerSecond: number;
    burstCapacity?: number;
    maxQueueLength?: number;
    queueTimeoutMs?: number;
  };
}

export class Astroid {
  public static version = '0.1.0';
  private config: AstroidClientConfig;

  constructor(config: AstroidClientConfig) {
    this.config = config;
  }

  public use(_middleware: unknown): this {
    return this;
  }

  public wallets = {
    get: async (id: string): Promise<{ id: string; name?: string }> => {
      return { id, name: 'Wallet' };
    },
  };

  /**
   * Helper to build query parameters including pagination support.
   */
  public buildQuery(params?: PaginationParams & Record<string, QueryValue>): Record<string, QueryValue> {
    if (!params) {
      return {};
    }
    const pagination = serializePaginationParams(params);
    const rest: Record<string, QueryValue> = {};
    for (const [key, value] of Object.entries(params)) {
      if (key !== 'cursor' && key !== 'limit' && key !== 'order') {
        rest[key] = value;
      }
    }
    return {
      ...pagination,
      ...rest,
    };
  }
}

export function createRateLimiterMiddleware(options: { maxRequestsPerSecond: number; burstCapacity?: number }) {
  return {
    name: 'rate-limiter',
    options,
  };
}

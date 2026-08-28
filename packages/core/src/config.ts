/**
 * Configuration parsing and normalization for the Astroid HTTP client.
 */

import type { HttpMethod } from './http-types.js';

export interface RetryConfig {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffFactor: number;
}

export interface AuthConfig {
  apiKey?: string;
  accessToken?: string | (() => Promise<string>);
}

export interface AstroidClientConfig {
  baseUrl: string;
  apiVersion?: string;
  apiKey?: string;
  accessToken?: string | (() => Promise<string>);
  headers?: Record<string, string>;
  timeoutMs?: number;
  retry?: Partial<RetryConfig> | boolean;
  fetch?: typeof globalThis.fetch;
}

export interface ResolvedConfig {
  baseUrl: string;
  apiVersion: string;
  auth: AuthConfig;
  headers: Record<string, string>;
  timeoutMs: number;
  retry: RetryConfig | undefined;
  fetch: typeof globalThis.fetch;
}

const DEFAULT_RETRY: RetryConfig = {
  maxRetries: 3,
  initialDelayMs: 500,
  maxDelayMs: 10000,
  backoffFactor: 2,
};

export function resolveConfig(config: AstroidClientConfig): ResolvedConfig {
  if (!config.baseUrl) {
    throw new Error('Astroid client configuration requires a `baseUrl`.');
  }

  let retry: RetryConfig | undefined;
  if (config.retry === true) {
    retry = DEFAULT_RETRY;
  } else if (config.retry === false || config.retry === undefined) {
    retry = undefined;
  } else {
    retry = {
      ...DEFAULT_RETRY,
      ...config.retry,
    };
  }

  return {
    baseUrl: config.baseUrl.replace(/\/+$/, ''),
    apiVersion: config.apiVersion ?? 'v1',
    auth: {
      apiKey: config.apiKey,
      accessToken: config.accessToken,
    },
    headers: config.headers ?? {},
    timeoutMs: config.timeoutMs ?? 30000,
    retry,
    fetch: config.fetch ?? globalThis.fetch,
  };
}

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
  timeoutMs?: number;
  headers?: Record<string, string>;
  retry?: Partial<RetryConfig> | boolean;
  fetch?: typeof globalThis.fetch;
}

export interface ResolvedConfig {
  baseUrl: string;
  apiVersion: string;
  auth: AuthConfig;
  timeoutMs: number;
  headers: Record<string, string>;
  retry: RetryConfig | undefined;
  fetch: typeof globalThis.fetch;
}

const DEFAULT_API_VERSION = 'v1';
const DEFAULT_TIMEOUT_MS = 30_000;

const DEFAULT_RETRY: RetryConfig = {
  maxRetries: 3,
  initialDelayMs: 500,
  maxDelayMs: 10_000,
  backoffFactor: 2,
};

export function resolveConfig(config: AstroidClientConfig): ResolvedConfig {
  if (!config.baseUrl) {
    throw new Error('AstroidClientConfig: `baseUrl` is required.');
  }

  let retry: RetryConfig | undefined;
  if (config.retry === true) {
    retry = DEFAULT_RETRY;
  } else if (config.retry === false) {
    retry = undefined;
  } else if (config.retry) {
    retry = { ...DEFAULT_RETRY, ...config.retry };
  } else {
    retry = DEFAULT_RETRY;
  }

  const fetchImpl = config.fetch ?? globalThis.fetch;
  if (!fetchImpl) {
    throw new Error('AstroidClientConfig: No global `fetch` found. Pass a fetch implementation.');
  }

  return {
    baseUrl: config.baseUrl.replace(/\/+$/, ''),
    apiVersion: config.apiVersion ?? DEFAULT_API_VERSION,
    auth: {
      apiKey: config.apiKey,
      accessToken: config.accessToken,
    },
    timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    headers: config.headers ?? {},
    retry,
    fetch: fetchImpl,
  };
}

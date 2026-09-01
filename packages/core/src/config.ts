/**
 * Configuration parsing and normalization for the Astroid HTTP client.
 */

import type { AuthTokens } from '@astroid/types';

/** How the SDK authenticates each request. */
export interface AuthConfig {
  /** A secret API key (`sk_live_…` / `sk_test_…`). Sent as a Bearer token. */
  apiKey?: string;
  /**
   * A short-lived JWT access token (alternative to an API key), **or** an
   * async function that returns one. When a function is provided it is
   * evaluated before every outbound request so the client always uses a
   * fresh token. Concurrent requests share a single in-flight promise to
   * avoid redundant invocations.
   */
  accessToken?: string | (() => Promise<string>);
  /** A refresh token used to obtain a new access token pair. */
  refreshToken?: string;
  /** Callback invoked whenever tokens are refreshed or updated. */
  onTokenUpdate?: (tokens: AuthTokens) => void | Promise<void>;
  /**
   * Resolved dynamic token provider (set internally by `resolveConfig` when
   * `accessToken` is a function). Consumers should not set this directly.
   */
  tokenProvider?: () => Promise<string>;
}

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
    headers: { ...(config.headers ?? {}) },
    auth: {
      apiKey: config.apiKey,
      accessToken: typeof config.accessToken === 'function' ? undefined : config.accessToken,
      refreshToken: config.refreshToken,
      onTokenUpdate: config.onTokenUpdate,
      tokenProvider: typeof config.accessToken === 'function' ? config.accessToken : undefined,
    },
    fetch: fetchImpl,
    network: config.network,
    enableOfflineQueue: config.enableOfflineQueue ?? false,
    rateLimit: config.rateLimit,
  };
}

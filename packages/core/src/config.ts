/**
 * Client configuration and its normalisation.
 *
 * `resolveConfig` turns the loose, user-facing `AstroidClientConfig` into a
 * fully-populated `ResolvedConfig` with every default applied, so the rest of
 * the SDK never has to reason about `undefined`.
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

/** Retry/backoff behaviour for transient failures. */
export interface RetryConfig {
  /** Maximum number of retries after the first attempt. Default 2. */
  maxRetries: number;
  /** Base backoff in ms; grows exponentially with jitter. Default 250. */
  baseDelayMs: number;
  /** Upper bound for a single backoff delay in ms. Default 8000. */
  maxDelayMs: number;
}

/** User-facing configuration passed to `new Astroid({ ... })`. */
export interface AstroidClientConfig extends AuthConfig {
  /** API base URL. Defaults to the public API. */
  baseUrl?: string;
  /** API version path segment. Default `v1`. */
  apiVersion?: string;
  /** Global request timeout in milliseconds. Default 10_000. */
  timeoutMs?: number;
  /** Retry configuration, or `false` to disable retries entirely. */
  retry?: Partial<RetryConfig> | false;
  /** Extra headers merged into every request. */
  headers?: Record<string, string>;
  /** Injected fetch implementation (for tests / non-standard runtimes). */
  fetch?: typeof fetch;
  /** Default Stellar network fallback when a request doesn't specify one. */
  network?: string;
  /** Opt into the offline queue for mutating requests. Default false. */
  enableOfflineQueue?: boolean;
}

/** Fully-resolved configuration with all defaults applied. */
export interface ResolvedConfig {
  baseUrl: string;
  apiVersion: string;
  timeoutMs: number;
  retry: RetryConfig | null;
  headers: Record<string, string>;
  auth: AuthConfig;
  fetch: typeof fetch;
  network: string | undefined;
  enableOfflineQueue: boolean;
}

/** The default public API base URL. */
export const DEFAULT_BASE_URL = 'https://api.astroid.finance';

const DEFAULT_RETRY: RetryConfig = {
  maxRetries: 2,
  baseDelayMs: 250,
  maxDelayMs: 8000,
};

/** Strip a single trailing slash so URL joins stay clean. */
function trimTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

/**
 * Normalise user config into a `ResolvedConfig`. Throws if neither an API key
 * nor an access token is supplied (the SDK cannot authenticate otherwise).
 */
export function resolveConfig(config: AstroidClientConfig): ResolvedConfig {
  const fetchImpl = config.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new TypeError(
      'No fetch implementation found. Pass `fetch` in the client config on runtimes without a global fetch.',
    );
  }

  const retry = config.retry === false ? null : { ...DEFAULT_RETRY, ...(config.retry ?? {}) };

  return {
    baseUrl: trimTrailingSlash(config.baseUrl ?? DEFAULT_BASE_URL),
    apiVersion: config.apiVersion ?? 'v1',
    timeoutMs: config.timeoutMs ?? 10_000,
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
  };
}

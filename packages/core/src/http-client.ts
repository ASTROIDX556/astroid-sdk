/**
 * The Astroid HTTP client: auth headers, timeouts, retries with backoff,
 * response-envelope unwrapping, and typed error mapping. Every SDK resource is
 * built on this class; it holds no domain knowledge itself.
 */

import {
  fromApiError,
  fromStatus,
  toNetworkError,
  type AstroidError,
} from '@astroid/errors';
import type { ApiError } from '@astroid/types';

import { resolveConfig, type AstroidClientConfig, type ResolvedConfig } from './config.js';
import {
  MiddlewareStack,
  type AstroidResponse,
  type Middleware,
  type PreparedRequest,
  type RawResponse,
  type RequestOptions,
} from './http-types.js';
import { buildUrl } from './url.js';
import { backoffDelay, isRetryableStatus, sleep } from './backoff.js';

/** Methods considered safe to retry by default (idempotent verbs). */
const IDEMPOTENT_METHODS = new Set(['GET', 'PUT', 'DELETE']);

/** SDK version, surfaced in the User-Agent header. */
export const SDK_VERSION = '0.1.0';

export class HttpClient {
  readonly config: ResolvedConfig;
  readonly middleware = new MiddlewareStack();
  private tokenPromise: Promise<string> | undefined;

  constructor(config: AstroidClientConfig) {
    this.config = resolveConfig(config);
  }

  /** Register a middleware. Returns `this` for chaining. */
  use(middleware: Middleware): this {
    this.middleware.use(middleware);
    return this;
  }

  /** Update auth credentials at runtime (e.g. after a token refresh). */
  setAccessToken(accessToken: string | (() => Promise<string>) | undefined): void {
    this.config.auth.accessToken = accessToken;
    this.tokenPromise = undefined;
  }

  /* ----------------------------- verb helpers ----------------------------- */

  get<TData>(path: string, options: Omit<RequestOptions, 'method' | 'path'> = {}): Promise<AstroidResponse<TData>> {
    return this.request<TData>({ ...options, method: 'GET', path });
  }

  post<TData>(path: string, body?: unknown, options: Omit<RequestOptions, 'method' | 'path' | 'body'> = {}): Promise<AstroidResponse<TData>> {
    return this.request<TData>({ ...options, method: 'POST', path, body });
  }

  patch<TData>(path: string, body?: unknown, options: Omit<RequestOptions, 'method' | 'path' | 'body'> = {}): Promise<AstroidResponse<TData>> {
    return this.request<TData>({ ...options, method: 'PATCH', path, body });
  }

  put<TData>(path: string, body?: unknown, options: Omit<RequestOptions, 'method' | 'path' | 'body'> = {}): Promise<AstroidResponse<TData>> {
    return this.request<TData>({ ...options, method: 'PUT', path, body });
  }

  delete<TData>(path: string, options: Omit<RequestOptions, 'method' | 'path'> = {}): Promise<AstroidResponse<TData>> {
    return this.request<TData>({ ...options, method: 'DELETE', path });
  }

  /* ------------------------------- core loop ------------------------------ */

  /** Issue a request with retries, returning the unwrapped, typed response. */
  async request<TData>(options: RequestOptions): Promise<AstroidResponse<TData>> {
    let prepared = await this.prepare(options);
    const retry = this.config.retry;
    const maxAttempts = retry && prepared.retryable ? retry.maxRetries + 1 : 1;

    let lastError: unknown;
    let hasRetriedAuth = false;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const raw = await this.send(prepared);
        await this.middleware.applyResponse(raw, prepared);

        if (raw.status >= 200 && raw.status < 300) {
          return this.unwrap<TData>(raw);
        }

        // Handle 401 Unauthorized retry with dynamic token function
        if (raw.status === 401 && !hasRetriedAuth && typeof this.config.auth.accessToken === 'function') {
          hasRetriedAuth = true;
          this.tokenPromise = undefined; // clear cache to force fresh token retrieval
          prepared = await this.prepare(options);
          attempt--; // don't count the auth retry against standard retry count
          continue;
        }

        // Non-2xx: decide whether to retry, otherwise throw a typed error.
        const error = this.toError(raw);
        if (retry && prepared.retryable && attempt < maxAttempts && isRetryableStatus(raw.status)) {
          lastError = error;
          await sleep(this.retryDelay(attempt, raw), prepared.signal);
          continue;
        }
        await this.middleware.applyError(error, prepared);
        throw error;
      } catch (err) {
        if (isAbortError(err)) throw err;
        // Transport-level failure (DNS, reset, timeout): retry if allowed.
        const isTyped = isAstroidErrorLike(err);
        if (isTyped) throw err; // already thrown above, propagate
        const networkError = toNetworkError(err);
        if (retry && prepared.retryable && attempt < maxAttempts) {
          lastError = networkError;
          await sleep(backoffDelay(attempt, retry), prepared.signal);
          continue;
        }
        await this.middleware.applyError(networkError, prepared);
        throw networkError;
      }
    }
    // Exhausted retries.
    await this.middleware.applyError(lastError, prepared);
    throw lastError instanceof Error ? lastError : toNetworkError(lastError);
  }

  /* ------------------------------- internals ------------------------------ */

  /** Build the fully-prepared request (auth, headers, body, url). */
  private async prepare(options: RequestOptions): Promise<PreparedRequest> {
    const { auth, headers: baseHeaders, timeoutMs } = this.config;
    const headers: Record<string, string> = {
      accept: 'application/json',
      'user-agent': `astroid-sdk/${SDK_VERSION}`,
      ...baseHeaders,
      ...(options.headers ?? {}),
    };

    let token: string | undefined;
    if (typeof auth.accessToken === 'function') {
      if (!this.tokenPromise) {
        this.tokenPromise = auth.accessToken().finally(() => {
          // keep or clear? Caching pending promise during execution is desired.
        });
      }
      try {
        token = await this.tokenPromise;
      } finally {
        // once resolved, we can keep it or clear it. The requirement states:
        // "Prevent concurrent identical token refresh invocations by caching the pending promise during authorization flow execution."
      }
    } else if (typeof auth.accessToken === 'string') {
      token = auth.accessToken;
    }

    if (token) {
      headers['authorization'] = `Bearer ${token}`;
    } else if (auth.apiKey) {
      headers['authorization'] = `Bearer ${auth.apiKey}`;
    }
    if (options.idempotencyKey) {
      headers['idempotency-key'] = options.idempotencyKey;
    }

    let body: string | undefined;
    if (options.body !== undefined && options.method !== 'GET') {
      body = JSON.stringify(options.body);
      headers['content-type'] = 'application/json';
    }

    const retryable = options.retryable ?? (IDEMPOTENT_METHODS.has(options.method) || Boolean(options.idempotencyKey));

    const prepared: PreparedRequest = {
      method: options.method,
      url: buildUrl(this.config.baseUrl, this.config.apiVersion, options.path, options.query),
      headers,
      body,
      timeoutMs: options.timeoutMs ?? timeoutMs,
      retryable,
      signal: options.signal,
      options,
    };
    return this.middleware.applyRequest(prepared);
  }

  /** Perform one transport round-trip with a timeout. */
  private async send(req: PreparedRequest): Promise<RawResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), req.timeoutMs);
    const onExternalAbort = (): void => controller.abort();
    req.signal?.addEventListener('abort', onExternalAbort, { once: true });

    try {
      const response = await this.config.fetch(req.url, {
        method: req.method,
        headers: req.headers,
        body: req.body,
        signal: controller.signal,
      });
      const requestId = response.headers.get('x-request-id') ?? undefined;
      const parsed = await this.parseBody(response);
      return { status: response.status, headers: response.headers, body: parsed, requestId };
    } finally {
      clearTimeout(timer);
      req.signal?.removeEventListener('abort', onExternalAbort);
    }
  }

  /** Parse a JSON body, tolerating empty (204) and non-JSON responses. */
  private async parseBody(response: Response): Promise<unknown> {
    if (response.status === 204) return undefined;
    const text = await response.text();
    if (!text) return undefined;
    try {
      return JSON.parse(text);
    } catch {
      return { raw: text };
    }
  }

  /** Unwrap a success envelope `{ success, data, meta, requestId }`. */
  private unwrap<TData>(raw: RawResponse): AstroidResponse<TData> {
    const envelope = raw.body as { success?: boolean; data?: TData; meta?: any; error?: ApiError } | undefined;

    return {
      data: (envelope && 'data' in envelope ? envelope.data : raw.body) as TData,
      meta: envelope?.meta,
      requestId: raw.requestId,
      status: raw.status,
      headers: raw.headers,
    };
  }

  /** Map a failed RawResponse to an AstroidError. */
  private toError(raw: RawResponse): AstroidError {
    const apiError = (raw.body as { error?: ApiError })?.error;
    if (apiError) {
      return fromApiError(apiError, raw.status, raw.requestId);
    }
    return fromStatus(raw.status, (raw.body as { message?: string })?.message ?? 'API Error', raw.requestId);
  }

  private retryDelay(attempt: number, raw: RawResponse): number {
    const retry = this.config.retry;
    if (!retry) return 0;
    const header = raw.headers.get('retry-after');
    if (header) {
      const seconds = Number(header);
      if (!Number.isNaN(seconds)) return seconds * 1000;
      const date = Date.parse(header);
      if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
    }
    return backoffDelay(attempt, retry);
  }
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

function isAstroidErrorLike(err: unknown): boolean {
  return err !== null && typeof err === 'object' && 'name' in err && typeof (err as any).name === 'string' && (err as any).name.endsWith('Error') && 'status' in err;
}

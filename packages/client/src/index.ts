/**
 * `@astroid/client` — the main SDK entry point.
 *
 * ```ts
 * import { Astroid } from '@astroid/client';
 *
 * const astroid = new Astroid({ apiKey: process.env.ASTROID_API_KEY! });
 *
 * // Resource namespaces:
 * const wallet = await astroid.wallets.create({ label: 'Ops', walletType: 'CUSTODIAL' });
 *
 * // AI-native intent:
 * const result = await astroid.ai.requestPayment({
 *   intent: 'Purchase OpenAI credits',
 *   amount: 150,
 *   asset: 'USDC',
 * });
 * ```
 *
 * The client owns a single {@link HttpClient} and hands it to every resource, so
 * a runtime token refresh (via {@link Astroid.setAccessToken}) is seen by all of
 * them at once.
 *
 * @packageDocumentation
 */

import {
  HttpClient,
  SDK_VERSION,
  type AstroidClientConfig as CoreClientConfig,
  type Middleware,
  type QueryValue,
  type RetryConfig,
} from '@astroid/core';
import type { PaginatedResponse, PaginationParams, ResponseMeta } from '@astroid/types';
import {
  extractNextCursor,
  extractPaginationCursors,
  extractPrevCursor,
  serializePaginationParams,
} from './pagination.js';
import { buildFilterQuery, buildListQuery } from './filters.js';
import type { CommonListFilters } from './filters.js';
import { createCorrelationMiddleware } from './middleware/correlation.js';
import { createRateLimiterMiddleware } from './middleware/rate-limiter.js';
import { createLoggingMiddleware, type LoggingMiddlewareOptions } from './middleware/logging.js';
import { createErrorParserMiddleware } from './error-parser-middleware.js';
import {
  createDebugLogger,
  createInterceptorMiddleware,
  type DebugLoggerOptions,
  type RequestInterceptor,
  type ResponseInterceptor,
} from './interceptors.js';
import { AgentResource } from '@astroid/agent';
import { AnalyticsResource } from '@astroid/analytics';
import { AuthResource, SessionManager, createSessionMiddleware } from '@astroid/auth';
import { BudgetResource } from '@astroid/budget';
import { NotificationResource } from '@astroid/notification';
import { PolicyResource } from '@astroid/policy';
import { TransactionResource } from '@astroid/transaction';
import { WalletResource } from '@astroid/wallet';
import { WebhookResource } from '@astroid/webhook';
import type {
  AuthTokens,
  EventHandlerMap,
  PaymentIntent,
  PaymentIntentResult,
  WebhookEventEnvelope,
  WebhookEventName,
} from '@astroid/types';
import { createErrorTranslatorMiddleware } from './middleware/error.js';
import { createTokenRefreshInterceptor } from './token-refresh.js';

/**
 * Configuration accepted by `new Astroid({ ... })`.
 *
 * Extends the core client config with shorthand retry options
 * (`retries` / `minTimeout` / `maxTimeout` / `retryableStatuses` / `jitter`) for
 * convenience. Each is merged into the `retry` block, so the full
 * {@link RetryConfig} remains available for advanced use.
 */
export interface AstroidClientConfig extends CoreClientConfig {
  /** Maximum number of retries after the first attempt (shorthand for `retry.maxRetries`). */
  retries?: number;
  /**
   * Minimum (base) backoff delay in ms before the first retry — the delay grows
   * exponentially from here (shorthand for `retry.baseDelayMs`).
   */
  minTimeout?: number;
  /**
   * Maximum backoff delay in ms for any single retry (shorthand for
   * `retry.maxDelayMs`).
   */
  maxTimeout?: number;
  /**
   * HTTP statuses that should be retried (shorthand for
   * `retry.retryableStatuses`). Defaults to `[429, 502, 503, 504]`.
   */
  retryableStatuses?: number[];
  /**
   * Apply full jitter to each backoff delay (shorthand for `retry.jitter`).
   * Default `true`; set to `false` for deterministic delays.
   */
  jitter?: boolean;
  /**
   * Base retry delay in ms. Legacy alias for {@link AstroidClientConfig.minTimeout}.
   * @deprecated Prefer `minTimeout`.
   */
  retryDelay?: number;
  /** Request/response logging hooks with automatic header redaction. */
  logging?: LoggingMiddlewareOptions;
  /**
   * Request interceptors executed, in order, before each request is dispatched.
   * Each interceptor receives a mutable {@link RequestConfig} and may return a
   * replacement config to rewrite the URL, method, headers, or body.
   */
  requestInterceptors?: RequestInterceptor[];
  /**
   * Response interceptors executed, in order, as each response is received.
   * Each interceptor receives a mutable {@link ResponseConfig} and may return a
   * replacement config to transform the response.
   */
  responseInterceptors?: ResponseInterceptor[];
  /**
   * Enable the built-in debug logger. Pass `true` for defaults or a
   * {@link DebugLoggerOptions} object to tune the log sink, body inclusion, and
   * header redaction.
   */
  debug?: boolean | DebugLoggerOptions;
  /**
   * Custom correlation/tracing headers applied to every outbound request
   * (issue #255). Shorthand for the core `tracingHeaders` option: use this to
   * stamp a fixed deployment- or tenant-level `X-Correlation-ID`, or to set the
   * `X-Request-ID` / `X-Astroid-Correlation-ID` header names with static values.
   * Per-request `options.headers`, `options.correlationId` and
   * `options.requestId` always take precedence.
   */
  tracingHeaders?: Record<string, string>;
}

/**
 * Alias for {@link AstroidClientConfig} using the conventional `ClientOptions`
 * name. Accepts the full retry surface (`retry`, `retries`, `retryDelay`) in
 * addition to the core transport options.
 */
export type ClientOptions = AstroidClientConfig;

/** The AI-native namespace: express intents, not low-level transfers. */
export class AiResource {
  constructor(private readonly client: HttpClient) {}

  /**
   * Submit a high-level financial intent. The backend orchestrates the whole
   * workflow — proposal, policy evaluation, risk scoring, transaction — and
   * returns a {@link PaymentIntentResult} whose `outcome` says what happened
   * (`executed`, `pending_approval`, `simulated`, or `rejected`), always with a
   * human-readable `explanation`.
   *
   * Set `simulateOnly: true` to force AI Simulation Mode (nothing is created).
   */
  async requestPayment(intent: PaymentIntent): Promise<PaymentIntentResult> {
    const res = await this.client.post<PaymentIntentResult>('/ai/request-payment', intent);
    return res.data;
  }

  /**
   * Simulate an intent without creating anything. Convenience wrapper over
   * {@link AiResource.requestPayment} with `simulateOnly` forced on.
   */
  async simulatePayment(intent: Omit<PaymentIntent, 'simulateOnly'>): Promise<PaymentIntentResult> {
    return this.requestPayment({ ...intent, simulateOnly: true });
  }
}

/** A listener for a specific event name, typed via {@link EventHandlerMap}. */
export type EventListener<K extends WebhookEventName> = EventHandlerMap[K];

/** Unsubscribe function returned by {@link Astroid.on}. */
export type Unsubscribe = () => void;

/**
 * A plugin extends the client at construction time. It receives the fully-built
 * {@link Astroid} instance and may register middleware, attach event listeners,
 * or hang extra helpers off it. Return value is ignored.
 */
export interface AstroidPlugin {
  name: string;
  install(client: Astroid): void;
}

/**
 * A minimal, fully-typed event emitter over the platform's webhook event names.
 * The client uses this so application code can react to events it feeds in
 * (e.g. from a webhook handler or a websocket) with the same names the backend
 * emits: `astroid.on('transaction.completed', tx => ...)`.
 */
class TypedEmitter {
  private readonly listeners = new Map<WebhookEventName, Set<(...args: never[]) => void>>();

  on<K extends WebhookEventName>(event: K, listener: EventListener<K>): Unsubscribe {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener as (...args: never[]) => void);
    return () => this.off(event, listener);
  }

  once<K extends WebhookEventName>(event: K, listener: EventListener<K>): Unsubscribe {
    const wrapped = ((data, envelope) => {
      off();
      (listener as (d: unknown, e: unknown) => void)(data, envelope);
    }) as EventListener<K>;
    const off = this.on(event, wrapped);
    return off;
  }

  off<K extends WebhookEventName>(event: K, listener: EventListener<K>): void {
    this.listeners.get(event)?.delete(listener as (...args: never[]) => void);
  }

  emit<K extends WebhookEventName>(event: WebhookEventEnvelope<K>): void {
    const set = this.listeners.get(event.event);
    if (!set) return;
    for (const listener of [...set]) {
      (listener as (d: unknown, e: unknown) => void)(event.data, event);
    }
  }

  removeAll(event?: WebhookEventName): void {
    if (event) this.listeners.delete(event);
    else this.listeners.clear();
  }
}

/**
 * The Astroid SDK client. Construct once and reuse; it is safe to share across
 * requests. Each resource namespace shares the one underlying {@link HttpClient},
 * so a token refresh or middleware registration is seen by all of them at once.
 */
export class Astroid {
  /** The SDK version, for diagnostics. */
  static readonly version = SDK_VERSION;

  /** The shared low-level HTTP client (escape hatch for un-wrapped calls). */
  readonly http: HttpClient;

  readonly sessionManager: SessionManager;
  readonly auth: AuthResource;
  readonly wallets: WalletResource;
  readonly agents: AgentResource;
  readonly policies: PolicyResource;
  readonly budgets: BudgetResource;
  readonly transactions: TransactionResource;
  readonly notifications: NotificationResource;
  readonly analytics: AnalyticsResource;
  readonly webhooks: WebhookResource;
  readonly ai: AiResource;

  private readonly emitter = new TypedEmitter();
  private readonly plugins: AstroidPlugin[] = [];

  constructor(config: AstroidClientConfig | HttpClient) {
    this.http = config instanceof HttpClient ? config : new HttpClient(normalizeConfig(config));

    const authConfig = this.http.config.auth;

    // If accessToken is a dynamic function, extract it as a token provider.
    const dynamicTokenProvider =
      !(config instanceof HttpClient) && typeof config.accessToken === 'function'
        ? config.accessToken
        : undefined;

    this.sessionManager = new SessionManager({
      accessToken: typeof authConfig.accessToken === 'string' ? authConfig.accessToken : undefined,
      refreshToken: authConfig.refreshToken,
      onTokenUpdate: authConfig.onTokenUpdate,
    });

    this.auth = new AuthResource(this.http, this.sessionManager);
    this.wallets = new WalletResource(this.http);
    this.agents = new AgentResource(this.http);
    this.policies = new PolicyResource(this.http);
    this.budgets = new BudgetResource(this.http);
    this.transactions = new TransactionResource(this.http);
    this.notifications = new NotificationResource(this.http);
    this.analytics = new AnalyticsResource(this.http);
    this.webhooks = new WebhookResource(this.http);
    this.ai = new AiResource(this.http);

    // Structured error translation: map Horizon and API error payloads to typed domain exceptions
    // (e.g. op_low_reserve → InsufficientFundsError, POLICY_VIOLATION → PolicyViolationError).
    // Installed by default so consumers get high-fidelity errors without manual middleware wiring.
    this.use(createErrorTranslatorMiddleware());

    // Token refresh interceptor (issue #103): a single-flight refresh shared
    // by all concurrent 401s, plus a middleware that queues requests issued
    // while a refresh is in flight so they don't race it with a stale token.
    const refreshTokens = async (refreshToken: string): Promise<AuthTokens> => {
      const res = await this.http.post<AuthTokens>('/auth/refresh', { refreshToken });
      this.setAccessToken(res.data.accessToken);
      return res.data;
    };

    this.use(
      createSessionMiddleware(this.sessionManager, refreshTokens),
    );

    const tokenRefresh = createTokenRefreshInterceptor({
      sessionManager: this.sessionManager,
      refresh: refreshTokens,
    });
    this.use(tokenRefresh.middleware);
    this.http.set401Handler(tokenRefresh.handleUnauthorized);

    // Wire up the dynamic token provider (called before every request;
    // the HttpClient deduplicates concurrent calls automatically).
    if (dynamicTokenProvider) {
      this.http.setTokenProvider(dynamicTokenProvider);
    }

    // Token-bucket rate limiting: throttle and queue outbound requests when
    // configured so agents never trip API gateway rate limits mid-workflow.
    const clientConfig = config instanceof HttpClient ? undefined : config;
    if (clientConfig?.rateLimit) {
      this.http.use(createRateLimiterMiddleware(clientConfig.rateLimit));
    }

    // Correlation ID + telemetry: every outbound request carries a
    // X-Astroid-Correlation-ID header and fires onRequest/onResponse hooks.
    // Static tracing headers from the config are honoured as defaults and are
    // overridden by per-request options.
    this.http.use(createCorrelationMiddleware(clientConfig?.telemetry, clientConfig?.tracingHeaders));

    // Request/response logging with header redaction (opt-in via config).
    if (clientConfig?.logging) {
      this.http.use(createLoggingMiddleware(clientConfig.logging));
    }

    // Pluggable request/response interceptors. When `debug` is enabled the
    // built-in debug logger interceptors are appended so callers get visibility
    // without wiring them by hand.
    const debugInterceptors =
      clientConfig?.debug === true
        ? createDebugLogger()
        : clientConfig?.debug && typeof clientConfig.debug === 'object'
          ? createDebugLogger(clientConfig.debug)
          : undefined;
    const requestInterceptors = [
      ...(clientConfig?.requestInterceptors ?? []),
      ...(debugInterceptors ? [debugInterceptors.requestInterceptor] : []),
    ];
    const responseInterceptors = [
      ...(clientConfig?.responseInterceptors ?? []),
      ...(debugInterceptors ? [debugInterceptors.responseInterceptor] : []),
    ];
    if (requestInterceptors.length > 0 || responseInterceptors.length > 0) {
      this.http.use(createInterceptorMiddleware({ requestInterceptors, responseInterceptors }));
    }

    // Auto-register the error parser middleware so all responses are routed
    // through the rich error mapping layer.
    this.http.use(createErrorParserMiddleware());
  }

  /** Register a request/response middleware. Returns `this` for chaining. */
  use(middleware: Middleware): this {
    this.http.use(middleware);
    return this;
  }

  /**
   * Install a plugin. The plugin's `install` is invoked immediately with this
   * client, so it can register middleware, attach listeners, or add helpers.
   * Returns `this` for chaining.
   */
  register(plugin: AstroidPlugin): this {
    this.plugins.push(plugin);
    plugin.install(this);
    return this;
  }

  /** The names of every installed plugin, in install order. */
  get installedPlugins(): readonly string[] {
    return this.plugins.map((p) => p.name);
  }

  /* -------------------------------- events -------------------------------- */

  /**
   * Subscribe to an event. Returns an unsubscribe function.
   *
   * ```ts
   * const off = astroid.on('transaction.completed', (tx) => console.log(tx.id));
   * // later: off();
   * ```
   *
   * The client does not open its own connection — feed it events from your
   * webhook handler (after {@link WebhookResource.constructEvent}) or a stream
   * via {@link Astroid.emit}, and they fan out to your typed listeners.
   */
  on<K extends WebhookEventName>(event: K, listener: EventListener<K>): Unsubscribe {
    return this.emitter.on(event, listener);
  }

  /** Subscribe to the next occurrence of an event only. */
  once<K extends WebhookEventName>(event: K, listener: EventListener<K>): Unsubscribe {
    return this.emitter.once(event, listener);
  }

  /** Remove a previously-registered listener. */
  off<K extends WebhookEventName>(event: K, listener: EventListener<K>): void {
    this.emitter.off(event, listener);
  }

  /** Dispatch an event envelope to all matching listeners. */
  emit<K extends WebhookEventName>(event: WebhookEventEnvelope<K>): void {
    this.emitter.emit(event);
  }

  /** Remove all listeners for one event, or (with no argument) for every event. */
  removeAllListeners(event?: WebhookEventName): void {
    this.emitter.removeAll(event);
  }

  /**
   * Update the bearer access token at runtime (e.g. after a refresh). All
   * resource namespaces pick it up immediately because they share one client.
   */
  setAccessToken(accessToken: string | undefined): void {
    this.http.setAccessToken(accessToken);
  }

  /**
   * Merge pagination parameters with arbitrary query parameters into a single
   * serialisable record, ready to pass as the `query` option of any request.
   *
   * Pagination fields (`cursor`, `limit`, `order`, `page`) are normalized via
   * {@link serializePaginationParams} — `limit` is clamped into `[1, 200]`,
   * empty cursors and invalid `order` values are dropped — while every other
   * key passes through untouched.
   */
  buildQuery(
    params: PaginationParams & Record<string, QueryValue>,
  ): Record<string, QueryValue> {
    const { cursor, limit, order, page, ...rest } = params;
    return {
      ...rest,
      ...serializePaginationParams(
        cursor !== undefined || limit !== undefined || order !== undefined || page !== undefined
          ? { cursor, limit, order, page }
          : undefined,
      ),
    };
  }

  /**
   * Merge list filters (pagination + common filters) onto an optional base
   * query without mutating either input. Filter values win over colliding
   * base keys. Ready to pass as the `query` option of any request.
   *
   * ```ts
   * astroid.http.get('/agents', {
   *   query: astroid.buildListQuery({ status: 'ACTIVE', limit: 50 }),
   * });
   * ```
   */
  buildListQuery(
    filters?: CommonListFilters | null,
    baseQuery?: Record<string, QueryValue> | null,
  ): Record<string, QueryValue> {
    return buildListQuery(filters, baseQuery);
  }

  /**
   * Serialize list filters to a query-parameter record (pure, no mutation).
   */
  buildFilterQuery(filters?: CommonListFilters | null): Record<string, QueryValue> {
    return buildFilterQuery(filters);
  }

  /**
   * Extract the `next_cursor` pagination cursor from response headers.
   *
   * Returns `null` when the header is missing, empty, or malformed — never throws.
   */
  getNextCursor(headers: Headers | Record<string, string | string[] | null | undefined> | null | undefined): string | null {
    return extractNextCursor(headers);
  }

  /**
   * Extract the `prev_cursor` pagination cursor from response headers.
   *
   * Returns `null` when the header is missing, empty, or malformed — never throws.
   */
  getPrevCursor(headers: Headers | Record<string, string | string[] | null | undefined> | null | undefined): string | null {
    return extractPrevCursor(headers);
  }

  /**
   * Extract both `next_cursor` / `prev_cursor` cursors from response headers.
   */
  getPaginationCursors(headers: Headers | Record<string, string | string[] | null | undefined> | null | undefined): {
    nextCursor: string | null;
    prevCursor: string | null;
  } {
    return extractPaginationCursors(headers);
  }
}

export default Astroid;

/**
 * Normalise the flat retry shorthand options
 * (`retries` / `minTimeout` / `maxTimeout` / `retryableStatuses` / `jitter`)
 * into a single core `retry` block, merging with any explicit `retry` object.
 *
 * Shorthand keys win over the corresponding `retry.*` field; `retry: false`
 * always disables retries. When no shorthand is supplied the config is returned
 * untouched so core defaults apply.
 */
function normalizeConfig(config: AstroidClientConfig): CoreClientConfig {
  const { retries, retryDelay, minTimeout, maxTimeout, retryableStatuses, jitter, retry, ...rest } =
    config;

  const shorthand: Partial<RetryConfig> = {};
  if (retries !== undefined) shorthand.maxRetries = retries;
  const baseDelayMs = minTimeout ?? retryDelay;
  if (baseDelayMs !== undefined) shorthand.baseDelayMs = baseDelayMs;
  if (maxTimeout !== undefined) shorthand.maxDelayMs = maxTimeout;
  if (retryableStatuses !== undefined) shorthand.retryableStatuses = retryableStatuses;
  if (jitter !== undefined) shorthand.jitter = jitter;

  // Nothing to merge, or retries explicitly disabled: leave the config as-is.
  if (Object.keys(shorthand).length === 0 || retry === false) return config;

  const baseRetry: Partial<RetryConfig> = retry && typeof retry === 'object' ? retry : {};
  return {
    ...rest,
    retry: { ...baseRetry, ...shorthand },
  };
}

// Re-export the resource classes and their param types so consumers can name
// them without reaching into individual packages.
export {
  AuthResource,
  SessionManager,
  createSessionMiddleware,
  parseJwt,
  isTokenExpired,
  getTokenExpiration,
  type TokenStorage,
  type SessionManagerConfig,
} from '@astroid/auth';
export { WalletResource, type WalletListParams } from '@astroid/wallet';
export { AgentResource, type AgentListParams, type AgentCursorListParams } from '@astroid/agent';
export { PolicyResource, type PolicyListParams } from '@astroid/policy';
export { BudgetResource, type BudgetListParams } from '@astroid/budget';
export { TransactionResource, type ProposalListParams } from '@astroid/transaction';
export { NotificationResource } from '@astroid/notification';
export { AnalyticsResource } from '@astroid/analytics';
export {
  WebhookResource,
  WebhookSignatureError,
  type WebhookListParams,
  type ConstructEventOptions,
} from '@astroid/webhook';

// Convenience re-exports of the most-used types and errors.
export {
  createRetryMiddleware,
  retryMiddleware,
  backoffDelay,
  isRetryableStatus,
  parseRetryAfter,
  DEFAULT_RETRYABLE_STATUSES,
  DEFAULT_TIMEOUT_MS,
  AstroidTimeoutError,
  type Middleware,
  type RateLimitConfig,
  type RetryConfig,
  type RetryMiddlewareOptions,
} from '@astroid/core';
// Retry policy helpers from the modular `retry` entry point. `createRetryMiddleware`
// and `retryMiddleware` are already re-exported above; these add the pieces the
// retry module owns directly.
export {
  computeRetryDelay,
  type RetryMiddlewareConfig,
} from './retry.js';
export {
  createRateLimiterMiddleware,
  rateLimiterMiddleware,
  type RateLimitMiddlewareOptions,
} from './middleware/rate-limiter.js';
export * from '@astroid/types';
export {
  AstroidError,
  AuthenticationError,
  AuthorizationError,
  ForbiddenError,
  ValidationError,
  NotFoundError,
  ConflictError,
  PolicyViolationError,
  BudgetExceededError,
  ApprovalRequiredError,
  RateLimitError,
  NetworkError,
  InternalServerError,
  ServerError,
  isAstroidError,
} from '@astroid/errors';
export {
  InsufficientFundsError,
  AstroidPolicyViolationError,
  AstroidInsufficientFundsError,
  AstroidApiError,
  AstroidValidationError,
  AstroidNetworkError,
} from '@astroid/errors';
// Centralized Stellar domain errors and mapping (issue #253).
export {
  InsufficientBalanceError,
  TrustlineMissingError,
  StellarAuthError,
  SequenceConflictError,
  TransactionExpiredError,
  StellarMalformedError,
  StellarNetworkError,
  mapStellarError,
  extractStellarResultCodes,
  errorClassForStellarCode,
  isStellarError,
} from '@astroid/errors';
export {
  createErrorTranslatorMiddleware,
  errorTranslatorMiddleware,
  errorMiddleware,
  translateErrorBody,
} from './middleware/error.js';
export {
  createCorrelationMiddleware,
  correlationMiddleware,
  CORRELATION_ID_HEADER,
  REQUEST_ID_HEADER,
  X_CORRELATION_ID_HEADER,
  type CorrelationTracingConfig,
} from './middleware/correlation.js';

// Re-export telemetry types for consumers
export {
  type TelemetryHooks,
  type TelemetryRequestInfo,
  type TelemetryResponseInfo,
} from '@astroid/core';

// Error response parser — re-exports so consumers can parse raw responses
// without reaching into internal modules.
export {
  StellarHorizonError,
  parseErrorResponse,
  parseErrorBody,
  type ParsedError,
} from './errors.js';
export { createErrorParserMiddleware } from './error-parser-middleware.js';

// Pluggable request/response interceptors and the built-in debug logger.
export {
  createInterceptorMiddleware,
  createDebugLogger,
  redactDebugHeaders,
  type RequestConfig,
  type ResponseConfig,
  type RequestInterceptor,
  type ResponseInterceptor,
  type InterceptorOptions,
  type DebugLogger,
  type DebugLoggerOptions,
} from './interceptors.js';

// Token refresh interceptor — single-flight refresh + request queueing.
export {
  createTokenRefreshInterceptor,
  type TokenRefreshInterceptor,
  type TokenRefreshInterceptorOptions,
  type UnauthorizedHandler,
} from './token-refresh.js';

// Shared auto-pagination helpers — cursor (keyset) iteration for any list
// endpoint, plus query-parameter builders for standalone list requests.
export type { PaginationParams, PaginatedResponse, ResponseMeta };
export {
  paginateCursor,
  normalizeCursorPage,
  MAX_CURSOR_PAGES,
  type CursorPage,
  type CursorPageFetcher,
  type PaginateCursorOptions,
} from './pagination.js';
export {
  buildPaginationQuery,
  buildPaginationQueryString,
  serializePaginationParams,
  unwrapPaginatedResponse,
  clampPaginationLimit,
  normalizePaginationCursor,
  normalizePaginationOrder,
  resolvePaginationParams,
  extractPaginationCursors,
  extractNextCursor,
  extractPrevCursor,
  hasNextPage,
  hasPrevPage,
  normalizePaginatedResponse,
  MIN_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
  DEFAULT_PAGE_LIMIT,
  DEFAULT_PAGE_ORDER,
  DEFAULT_PAGINATION_PARAMS,
  type PaginationCursors,
  type PaginationHeadersInput,
} from './pagination.js';

// Standardized query-parameter serialization (issue #264): strings, numbers,
// booleans, Dates (ISO), arrays and nested objects; null/undefined omitted.
export {
  serializeQuery,
  type QueryParams,
  type QueryParamValue,
  type QueryParamScalar,
  type QueryArrayFormat,
  type SerializeQueryOptions,
} from './query.js';

// Typed list-filter builders and cursor-iteration helpers: pagination
// (`limit`, `cursor`, `order`/`direction`) plus common filters (`search`,
// `status`, `asset`, `walletId`, `agentId`, date ranges, `sort`).
export {
  buildFilterQuery,
  buildListQuery,
  buildListQueryString,
  normalizeSortDirection,
  normalizeFilterString,
  normalizeFilterDate,
  normalizeStatusFilter,
  parsePaginatedResponse,
  iterateCursorPages,
  collectCursorPages,
  MAX_LIST_PAGES,
  type SortDirection,
  type CursorPaginationInput,
  type SearchFilter,
  type SortingFilter,
  type DateRangeFilter,
  type StatusFilter,
  type EntityScopeFilter,
  type CommonListFilters,
  type ListQueryParams,
  type ListPageFetcher,
  type IterateCursorPagesOptions,
} from './filters.js';

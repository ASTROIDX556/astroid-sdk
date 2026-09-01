/**
 * `@astroid/client` — correlation ID middleware with telemetry hooks.
 *
 * Every outbound request automatically carries an `X-Astroid-Correlation-ID`
 * (and `X-Request-ID`) header so that operators can trace a single SDK
 * operation across the client, API gateway, and backend services.
 *
 * When no caller-supplied correlation ID is present in the request options,
 * the middleware generates a UUID v4 (via `crypto.randomUUID()`) and injects
 * it into the header. Callers may supply their own via `options.correlationId`.
 *
 * The middleware also measures request duration and fires the optional
 * `onRequest` / `onResponse` telemetry hooks configured on the client, making
 * it straightforward to integrate with logging, tracing, or APM tools.
 *
 * @example
 * ```ts
 * import { Astroid, createCorrelationMiddleware } from '@astroid/client';
 *
 * const astroid = new Astroid({
 *   apiKey: 'sk_test_...',
 *   telemetry: {
 *     onRequest: (info) => console.log(`→ ${info.method} ${info.url} [${info.correlationId}]`),
 *     onResponse: (info) => console.log(`← ${info.status} in ${info.durationMs}ms [${info.correlationId}]`),
 *   },
 * });
 *
 * // The correlation middleware is registered by default; the hooks fire
 * // automatically.
 * await astroid.wallets.list();
 * ```
 *
 * @module
 */

import type { Middleware, PreparedRequest, RawResponse } from '@astroid/core';
import type { TelemetryHooks } from '@astroid/core';

/** Context key used to store the correlation ID in `request.options.context`. */
const CORRELATION_ID_KEY = '_correlationId';
/** Context key used to store the request start time in milliseconds. */
const START_TIME_KEY = '_startTime';

/**
 * Generate a UUID v4 using the Web Crypto API (`crypto.randomUUID()`).
 *
 * Falls back to a manual implementation when `crypto` is unavailable (e.g.
 * Node < 19 without a global `crypto`), though this is unlikely in practice
 * since the SDK requires Node >= 20.
 */
function generateCorrelationId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  // Fallback: manual UUID v4 from hex digits
  const hex = '0123456789abcdef';
  let uuid = '';
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) {
      uuid += '-';
    } else if (i === 14) {
      uuid += '4';
    } else if (i === 19) {
      uuid += hex[(Math.random() * 4) | 8];
    } else {
      uuid += hex[(Math.random() * 16) | 0];
    }
  }
  return uuid;
}

/**
 * The header name used for correlation IDs. Exported so consumers and tests
 * can reference the canonical header without hardcoding it.
 */
export const CORRELATION_ID_HEADER = 'x-astroid-correlation-id';

/**
 * The header name used for request tracing IDs. This is the server-facing
 * request ID header (distinct from the correlation ID used for client-side
 * trace linking).
 */
export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * Create the correlation ID middleware.
 *
 * The middleware:
 * 1. Generates or re-uses a correlation ID from `options.correlationId`.
 * 2. Injects `X-Astroid-Correlation-ID` and `X-Request-ID` headers.
 * 3. Records the request start time for duration measurement.
 * 4. Fires `onRequest` with the request info.
 * 5. On response, computes the round-trip duration and fires `onResponse`.
 *
 * @param telemetry Optional telemetry hooks (from the client config) to invoke
 *                  for each request/response lifecycle event.
 * @returns A {@link Middleware} that can be registered via `client.use()`.
 */
export function createCorrelationMiddleware(
  telemetry?: TelemetryHooks,
): Middleware {
  return {
    name: 'correlation',

    async onRequest(req: PreparedRequest): Promise<PreparedRequest> {
      const correlationId =
        req.options.correlationId ?? generateCorrelationId();

      // Inject headers
      req.headers[CORRELATION_ID_HEADER] = correlationId;
      req.headers[REQUEST_ID_HEADER] = correlationId;

      // Store in context for response phase and error enrichment
      const context = { ...req.options.context };
      context[CORRELATION_ID_KEY] = correlationId;
      context[START_TIME_KEY] = Date.now();

      // Fire telemetry hook
      if (telemetry?.onRequest) {
        await telemetry.onRequest({
          method: req.method,
          url: req.url,
          correlationId,
          headers: req.headers,
        });
      }

      return { ...req, options: { ...req.options, context } };
    },

    async onResponse(res: RawResponse, req: PreparedRequest): Promise<void> {
      if (!telemetry?.onResponse) return;

      const correlationId =
        (req.options.context?.[CORRELATION_ID_KEY] as string) ?? res.requestId ?? '';
      const startTime =
        (req.options.context?.[START_TIME_KEY] as number) ?? Date.now();
      const durationMs = Date.now() - startTime;

      await telemetry.onResponse({
        method: req.method,
        url: req.url,
        correlationId,
        status: res.status,
        durationMs,
        success: res.status >= 200 && res.status < 300,
      });
    },
  };
}

/** Singleton correlation middleware instance (no telemetry hooks). */
export const correlationMiddleware = createCorrelationMiddleware();

/**
 * `@astroid/client` — error parser middleware.
 *
 * Intercepts raw HTTP error responses and re-parses them through the rich
 * {@link parseErrorBody} parser. Because the core `HttpClient` middleware
 * `onError` hook is observational (it cannot replace the thrown error), this
 * middleware **mutates the existing error instance in-place** — enriching its
 * `details`, `code`, and `message` properties with the richer parsed values so
 * application code that catches it sees typed field errors, Stellar Horizon
 * result codes, etc.
 *
 * For full control over error replacement, use {@link parseErrorResponse}
 * directly on raw `Response` objects.
 *
 * @module
 */

import type { Middleware, PreparedRequest } from '@astroid/core';
import { parseErrorBody, type StellarHorizonError } from './errors.js';

/**
 * Create an error parser middleware that enriches errors thrown by the HTTP
 * client with typed details from the rich error parser.
 *
 * @example
 * ```ts
 * import { Astroid, createErrorParserMiddleware } from '@astroid/client';
 *
 * const astroid = new Astroid({ apiKey: 'sk_test_...' });
 * astroid.use(createErrorParserMiddleware());
 *
 * // Now errors from failed requests carry richer details:
 * try {
 *   await astroid.wallets.get('nonexistent');
 * } catch (err) {
 *   if (err instanceof ValidationError) {
 *     console.error(err.details?.fields); // { walletId: ['Not found'] }
 *   }
 * }
 * ```
 */
export function createErrorParserMiddleware(): Middleware {
  /**
   * In-flight response bodies for non-success responses, keyed by a composite
   * of request-id + url so the error handler can re-parse them.
   */
  const pendingBodies = new Map<string, unknown>();

  function bodyKey(req: PreparedRequest): string {
    return `${req.options.context?._requestId ?? ''}:${req.url}`;
  }

  return {
    name: 'astroid-error-parser',

    onResponse(res, req) {
      // Only capture bodies for error responses.
      if (res.status >= 400 && res.body !== undefined) {
        pendingBodies.set(bodyKey(req), res.body);
      }
    },

    onError(error, req) {
      const key = bodyKey(req);
      const body = pendingBodies.get(key);
      pendingBodies.delete(key);

      if (body === undefined) return;

      const status = (error as { status?: number }).status ?? 500;
      const requestId = req.options.context?._requestId as string | undefined;

      // Re-parse through the rich error parser.
      const parsed = parseErrorBody(status, body, requestId);

      // Enrich the original error in-place. We cannot replace the thrown error
      // object, but we can mutate its properties so application code sees the
      // richer typed details.
      const target = error as Record<string, unknown>;

      if (parsed.details && !target.details) {
        target.details = parsed.details;
      }
      if (parsed.code && target.code !== parsed.code) {
        target.code = parsed.code;
      }
      if (parsed.message && target.message !== parsed.message) {
        target.message = parsed.message;
      }

      // If the parsed error is a StellarHorizonError, copy stellar-specific
      // properties onto the original error for application code to branch on.
      if ('stellarCode' in parsed) {
        const stellar = parsed as StellarHorizonError;
        target.stellarCode = stellar.stellarCode;
        if (stellar.operationCode) {
          target.operationCode = stellar.operationCode;
        }
      }
    },
  };
}

/**
 * `@astroid/client` — Typed HTTP client for the Astroid REST API.
 *
 * @module
 */

export { AstroidClient, Astroid, type AstroidClientConfig } from './client.js';
export { parseErrorResponse, parseErrorBody, StellarHorizonError, type ParsedError } from './errors.js';
export {
  createErrorParserMiddleware,
  errorParserMiddleware,
  type ErrorParserOptions,
} from './error-parser-middleware.js';
export {
  createErrorTranslatorMiddleware,
  errorTranslatorMiddleware,
} from './middleware/error.js';
export {
  createRateLimiterMiddleware,
  rateLimiterMiddleware,
  type RateLimitMiddlewareOptions,
} from './middleware/rate-limiter.js';
export {
  createCorrelationMiddleware,
  correlationMiddleware,
  type CorrelationMiddlewareOptions,
} from './middleware/correlation.js';
export {
  createRetryMiddleware,
  retryMiddleware,
  backoffDelay,
  isRetryableStatus,
  type RetryOptions,
} from './middleware/retry.js';

/**
 * `@astroid/client/client` — AstroidClient and AstroidHttpClient export and aliases.
 *
 * Provides {@link AstroidClient}, {@link AstroidHttpClient}, and their
 * configuration options as direct entry points for the HTTP client with
 * configurable exponential backoff retry handling.
 *
 * @module
 */

import { Astroid } from './index.js';

export {
  Astroid,
  Astroid as AstroidClient,
  Astroid as AstroidHttpClient,
  HttpClient,
} from './index.js';
export type {
  AstroidClientConfig,
  AstroidClientOptions,
  AstroidHttpClientConfig,
  AstroidHttpClientOptions,
  ClientOptions,
  RetryOptions,
  RetryConfig,
  AstroidPlugin,
  EventListener,
  Unsubscribe,
} from './index.js';
// Retry configuration types live in `./types.ts` (issue #559); the rest are
// re-exported from the package entry point.
export type { RetryMiddlewareConfig } from './types.js';
export * from './index.js';

export default Astroid;

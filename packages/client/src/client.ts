/**
 * `@astroid/client/client` — AstroidClient export and aliases.
 *
 * Provides {@link AstroidClient} and {@link AstroidClientOptions} as
 * direct entry points for the HTTP client with configurable exponential
 * backoff retry handling.
 *
 * @module
 */

import { Astroid } from './index.js';

export { Astroid, Astroid as AstroidClient } from './index.js';
export type {
  AstroidClientConfig,
  AstroidClientOptions,
  ClientOptions,
  AstroidPlugin,
  EventListener,
  Unsubscribe,
} from './index.js';
export * from './index.js';

export default Astroid;

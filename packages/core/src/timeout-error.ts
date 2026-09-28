/**
 * Error raised when a request exceeds its configured timeout.
 *
 * Defined in the shared `@astroid/errors` module as a subclass of
 * `NetworkError`, so it is part of the core error hierarchy
 * (`isAstroidError(err)`, `err instanceof NetworkError`, `err.code`,
 * `err.isRetryable` all work). This module re-exports it so the previously
 * published import path from `@astroid/core` keeps working.
 */

export { AstroidTimeoutError } from '@astroid/errors';

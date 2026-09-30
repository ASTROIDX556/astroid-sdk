/**
 * Error raised when a request exceeds its configured timeout.
 *
 * Defined in `@astroid/errors` as a subclass of `NetworkError`, so it is part
 * of the core error hierarchy. This module re-exports it so the previously
 * published import path from `@astroid/core` keeps working.
 */

export { AstroidTimeoutError } from '@astroid/errors';

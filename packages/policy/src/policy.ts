/**
 * `@astroid/policy` — canonical policy module exports.
 *
 * Provides client-side input validation and sanitization helpers for policies,
 * re-exporting the core PolicyResource and policy configuration validators.
 *
 * @module
 */

export * from './validation.js';
export { PolicyResource, PoliciesResource, PolicyClient } from './index.js';

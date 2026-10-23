/**
 * `PolicyClient` — CRUD + simulation wrapper for the `/policies` resource.
 *
 * This module re-exports {@link PolicyResource} under the `PolicyClient` name so
 * callers can import the class using either naming convention:
 *
 * ```ts
 * import { PolicyClient } from '@astroid/policy';
 * // or
 * import { PolicyResource } from '@astroid/policy';
 * ```
 *
 * Both are identical; `PolicyClient` is the name mentioned in the acceptance
 * criteria for issue #242. Mirrors the `AgentClient` / `AgentResource` pairing
 * in `@astroid/agent`.
 *
 * @module
 */

export { PolicyResource as PolicyClient } from './index.js';

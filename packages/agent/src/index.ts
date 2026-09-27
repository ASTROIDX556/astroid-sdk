/**
 * `@astroid/agent` — agent lifecycle resource methods.
 *
 * The implementation lives in `./agent.js`; this entrypoint re-exports the
 * public surface so both import styles keep working:
 *
 * ```ts
 * import { AgentResource } from '@astroid/agent';
 * import { AgentResource } from '@astroid/agent/dist/agent.js';
 * ```
 *
 * @module
 */

export {
  AgentResource,
  AgentsResource,
  type AgentListParams,
  type AgentCursorListParams,
} from './agent.js';
export { AstroidValidationError } from './errors.js';
export { validateCreateAgentParams, isValidCreateAgentParams } from './validation.js';
export { AgentClient } from './client.js';

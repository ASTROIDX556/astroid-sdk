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
export {
  // CreateAgentDto guards
  validateCreateAgentParams,
  isValidCreateAgentParams,
  // UpdateAgentDto guards
  validateUpdateAgentParams,
  isValidUpdateAgentParams,
  // Shared primitive guards
  isValidStellarPublicKey,
  assertValidStellarPublicKey,
  isValidAmountString,
  assertValidAmountString,
  isValidAgentId,
  assertValidAgentId,
  // Metadata guards
  validateAgentMetadata,
  isValidAgentMetadata,
} from './validation.js';
export { AgentClient } from './client.js';

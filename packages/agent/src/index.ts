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
  DEFAULT_BATCH_STATUS_CONCURRENCY,
  partitionAgentStatuses,
  type AgentListParams,
  type AgentCursorListParams,
  type AgentStatusLookup,
  type BatchAgentStatusOptions,
  type PartitionedAgentStatuses,
} from './agent.js';
export { AstroidValidationError } from './errors.js';
export {
  // CreateAgentDto guards
  validateCreateAgentParams,
  isValidCreateAgentParams,
  validateAgentConfig,
  isValidAgentConfig,
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

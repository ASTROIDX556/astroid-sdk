export * from './enums.js';
export * from './common.js';
export * from './asset.js';
export * from './entities.js';
export * from './dto.js';
/**
 * Policy condition matchers, rule definitions, simulation request/response
 * DTOs and decision reason codes.
 *
 * @see {@link PolicyCondition}
 * @see {@link PolicyRule}
 * @see {@link PolicySimulationRequest}
 * @see {@link PolicySimulationResult}
 * @see {@link PolicyReasonCode}
 */
export * from './policy.js';
export * from './analytics.js';
export * from './agent-events.js';
export * from './webhooks.js';
export * from './budget.js';
export * from './ai.js';
export * from './transaction-simulation.js';
export * from './transaction.js';
export * from './fee-optimization.js';
export * from './schemas.js';

// Agent resource DTOs and helpers. `AgentEntity`/`Agent`, `AgentStatus` and
// `AgentRole` originate in `./entities.js` and `./enums.js`, so re-export only
// the members `agent.ts` adds to avoid duplicate-export ambiguity.
export {
  type AgentEntity,
  type AgentMetadata,
  type AgentInitialBudget,
  type CreateAgentDto,
  type UpdateAgentDto,
  type CreateAgentParams,
  type UpdateAgentParams,
  type ListAgentsParams,
  type AgentTimestamp,
  AGENT_LIFECYCLE_EVENT_TYPE_VALUES,
  type AgentLifecycleEventType,
  type AgentLifecycleEventPayload,
  type AgentLifecycleEvent,
  type ListAgentEventsParams,
  type AgentEventSubscriptionOptions,
  type AgentEventSubscription,
  AGENT_STATUS_VALUES,
  AGENT_ROLE_VALUES,
  isAgentStatus,
  isAgentRole,
  isAgentEntity,
  parseAgentEntity,
  normalizeCreateAgentDto,
} from './agent.js';

export type AgentId = string & { readonly __brand: 'AgentId' };
export type WalletId = string & { readonly __brand: 'WalletId' };
export type PolicyId = string & { readonly __brand: 'PolicyId' };
export type BudgetId = string & { readonly __brand: 'BudgetId' };

export function isAgentId(value: unknown): value is AgentId {
  return typeof value === 'string' && /^agt_[a-zA-Z0-9]{12,}$/.test(value);
}

export function isWalletId(value: unknown): value is WalletId {
  return typeof value === 'string' && /^wal_[a-zA-Z0-9]{12,}$/.test(value);
}

export function isPolicyId(value: unknown): value is PolicyId {
  return typeof value === 'string' && /^pol_[a-zA-Z0-9]{12,}$/.test(value);
}

export function isBudgetId(value: unknown): value is BudgetId {
  return typeof value === 'string' && /^bud_[a-zA-Z0-9]{12,}$/.test(value);
}

export function formatAgentId(id: string): AgentId {
  if (!isAgentId(id)) {
    throw new Error(`Invalid AgentId format: ${id}`);
  }
  return id;
}

export function formatWalletId(id: string): WalletId {
  if (!isWalletId(id)) {
    throw new Error(`Invalid WalletId format: ${id}`);
  }
  return id;
}

export function formatPolicyId(id: string): PolicyId {
  if (!isPolicyId(id)) {
    throw new Error(`Invalid PolicyId format: ${id}`);
  }
  return id;
}

export function formatBudgetId(id: string): BudgetId {
  if (!isBudgetId(id)) {
    throw new Error(`Invalid BudgetId format: ${id}`);
  }
  return id;
}

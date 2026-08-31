import { Resource } from '@astroid/core';
import type {
  Agent,
  AgentEventSubscription,
  AgentEventSubscriptionOptions,
  AgentLifecycleEvent,
  CreateAgentParams,
  ListAgentEventsParams,
  PaginatedResponse,
  PaginationParams,
  UpdateAgentParams,
} from '@astroid/types';
import { validateCreateAgentParams } from './validation.js';

export { AstroidValidationError } from './errors.js';
export { validateCreateAgentParams, isValidCreateAgentParams } from './validation.js';

/**
 * Resource methods for managing AI agents on Astroid.
 */
export class AgentResource extends Resource {
  /**
   * Create a new autonomous AI agent with strict input payload validation.
   * 
   * @param params Agent creation parameters.
   * @returns The created agent entity.
   */
  async create(params: CreateAgentParams): Promise<Agent> {
    validateCreateAgentParams(params);
    return this.http.post<Agent>('/v1/agents', params);
  }

  /**
   * Retrieve an agent by its unique identifier.
   * 
   * @param agentId The unique agent ID.
   * @returns The agent entity.
   */
  async get(agentId: string): Promise<Agent> {
    return this.http.get<Agent>(`/v1/agents/${agentId}`);
  }

  /**
   * List all agents associated with the organization.
   * 
   * @param params Optional pagination parameters.
   * @returns A paginated list of agent entities.
   */
  async list(params?: PaginationParams): Promise<PaginatedResponse<Agent>> {
    return this.http.get<PaginatedResponse<Agent>>('/v1/agents', { query: params });
  }

  /**
   * Update an existing agent configuration.
   * 
   * @param agentId The unique agent ID.
   * @param params Updated agent parameters.
   * @returns The updated agent entity.
   */
  async update(agentId: string, params: UpdateAgentParams): Promise<Agent> {
    return this.http.patch<Agent>(`/v1/agents/${agentId}`, params);
  }

  /* ------------------------------------------------------------------------ */
  /* Lifecycle event stream                                                   */
  /* ------------------------------------------------------------------------ */

  /**
   * Page through an agent's lifecycle events (creation, suspension, resumption,
   * budget exhaustion).
   *
   * @param agentId The unique agent ID.
   * @param params Optional event-type filters and pagination.
   * @returns A paginated list of lifecycle events.
   */
  async listEvents(
    agentId: string,
    params?: ListAgentEventsParams,
  ): Promise<PaginatedResponse<AgentLifecycleEvent>> {
    return this.client.get<PaginatedResponse<AgentLifecycleEvent>>(
      `/v1/agents/${encodeURIComponent(agentId)}/events`,
      { query: toAgentEventQuery(params) },
    );
  }

  /**
   * Create a subscription to an agent's lifecycle event stream.
   *
   * @param agentId The unique agent ID.
   * @param options Which event types to receive and whether to replay history.
   * @returns The created subscription.
   */
  async subscribe(
    agentId: string,
    options: AgentEventSubscriptionOptions = {},
  ): Promise<AgentEventSubscription> {
    return this.client.post<AgentEventSubscription>(
      `/v1/agents/${encodeURIComponent(agentId)}/events/subscriptions`,
      options,
    );
  }

  /**
   * Remove a subscription to an agent's lifecycle event stream.
   *
   * @param agentId The unique agent ID.
   * @param subscriptionId The subscription to remove.
   */
  async unsubscribe(agentId: string, subscriptionId: string): Promise<void> {
    await this.client.delete<void>(
      `/v1/agents/${encodeURIComponent(agentId)}/events/subscriptions/${encodeURIComponent(subscriptionId)}`,
    );
  }
}

/**
 * Drop `undefined` / `null` entries so they never reach the query string, and
 * serialise event-type filters as a comma-separated list.
 */
function toAgentEventQuery(params?: ListAgentEventsParams): Record<string, string | number | boolean> | undefined {
  if (!params) return undefined;
  const query: Record<string, string | number | boolean> = {};
  if (params.cursor !== undefined) query['cursor'] = params.cursor;
  if (params.limit !== undefined) query['limit'] = params.limit;
  if (params.order !== undefined) query['order'] = params.order;
  if (params.from !== undefined) query['from'] = params.from;
  if (params.to !== undefined) query['to'] = params.to;
  if (params.eventTypes !== undefined && params.eventTypes.length > 0) {
    query['eventTypes'] = params.eventTypes.join(',');
  }
  return query;
}

import { Resource, type RequestOptionsExtras } from '@astroid/core';
import type {
  Agent,
  AgentEventSubscription,
  AgentEventSubscriptionOptions,
  AgentLifecycleEvent,
  AgentLog,
  AgentStatusMetrics,
  CreateAgentParams,
  CursorPaginationParams,
  ListAgentEventsParams,
  ListAgentsParams,
  Paginated,
  PaginatedResponse,
  UpdateAgentParams,
} from '@astroid/types';
import { validateCreateAgentParams } from './validation.js';

/** Filters accepted by {@link AgentResource.list}. */
export type AgentListParams = ListAgentsParams;

/**
 * Filters accepted by {@link AgentResource.iterateByCursor}.
 *
 * The same filters as {@link AgentListParams}, but keyset-paginated: the
 * page-number field is dropped in favour of the opaque `cursor` (and optional
 * `order`) understood by every Astroid list endpoint.
 */
export type AgentCursorListParams = Omit<AgentListParams, 'page'> & CursorPaginationParams;

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
  async create(params: CreateAgentParams, options?: RequestOptionsExtras): Promise<Agent> {
    validateCreateAgentParams(params);
    const res = await this.client.post<Agent>('/agents', params, options);
    return res.data;
  }

  /**
   * Retrieve an agent by its unique identifier.
   *
   * @param agentId The unique agent ID.
   * @returns The agent entity.
   */
  async get(agentId: string, options?: RequestOptionsExtras): Promise<Agent> {
    return this.getData<Agent>(`/agents/${encodeURIComponent(agentId)}`, undefined, options);
  }

  /**
   * List all agents associated with the organization.
   *
   * @param params Optional filters and pagination parameters.
   * @returns A paginated list of agent entities.
   */
  async list(
    params: AgentListParams = {},
    options?: RequestOptionsExtras,
  ): Promise<Paginated<Agent>> {
    return this.listData<Agent>('/agents', { ...params }, options);
  }

  /**
   * Iterate every agent across all pages.
   *
   * @param params Optional filters and pagination parameters.
   */
  iterate(
    params: AgentListParams = {},
    options?: RequestOptionsExtras,
  ): AsyncGenerator<Agent, void, void> {
    return this.iterateData<Agent>('/agents', { ...params }, options);
  }

  /**
   * Lazily iterate every agent across all pages using cursor (keyset)
   * pagination.
   *
   * Where {@link AgentResource.iterate} walks 1-based page numbers, this follows
   * the opaque `meta.nextCursor` each response returns, so it keeps working on
   * endpoints that only expose keyset pagination. Only one page is held in memory
   * at a time and the next page is requested lazily as the consumer advances the
   * generator.
   *
   * @param params Optional filters, page size (`limit`) and sort `order`. Pass a
   *               previously captured `cursor` to resume from a saved position.
   * @returns An async generator yielding every matching agent in order.
   *
   * @example
   * ```ts
   * for await (const agent of astroid.agents.iterateByCursor({ status: 'ACTIVE', limit: 100 })) {
   *   console.log(agent.id);
   * }
   *
   * // Resume later from a cursor captured on a previous run:
   * for await (const agent of astroid.agents.iterateByCursor({ cursor: savedCursor })) {
   *   // ...
   * }
   * ```
   */
  iterateByCursor(
    params: AgentCursorListParams = {},
    options?: RequestOptionsExtras,
  ): AsyncGenerator<Agent, void, void> {
    return this.iterateCursorData<Agent>('/agents', { ...params }, options);
  }

  /**
   * Update an existing agent configuration.
   *
   * @param agentId The unique agent ID.
   * @param params Updated agent parameters.
   * @returns The updated agent entity.
   */
  async update(
    agentId: string,
    params: UpdateAgentParams,
    options?: RequestOptionsExtras,
  ): Promise<Agent> {
    const res = await this.client.patch<Agent>(
      `/agents/${encodeURIComponent(agentId)}`,
      params,
      options,
    );
    return res.data;
  }

  /**
   * Deactivate an agent by its unique identifier.
   *
   * Issues `POST /agents/:id/deactivate` and returns the updated agent
   * (typically with `status: 'ARCHIVED'`). The agent can no longer transact
   * until re-activated.
   *
   * @param agentId The unique agent ID.
   * @returns The deactivated agent entity.
   */
  async deactivate(agentId: string, options?: RequestOptionsExtras): Promise<Agent> {
    const res = await this.client.post<Agent>(
      `/agents/${encodeURIComponent(agentId)}/deactivate`,
      undefined,
      options,
    );
    return res.data;
  }

  /**
   * Delete an agent by its unique identifier.
   *
   * @param agentId The unique agent ID.
   */
  async delete(agentId: string, options?: RequestOptionsExtras): Promise<void> {
    await this.client.delete<void>(`/agents/${encodeURIComponent(agentId)}`, options);
  }

  /**
   * Fetch real-time operational status metrics for an agent.
   *
   * @param agentId The unique agent ID.
   * @returns The agent's status metrics.
   */
  async status(agentId: string, options?: RequestOptionsExtras): Promise<AgentStatusMetrics> {
    return this.getData<AgentStatusMetrics>(
      `/agents/${encodeURIComponent(agentId)}/status`,
      undefined,
      options,
    );
  }

  /**
   * Fetch paginated execution logs for an agent.
   *
   * @param agentId The unique agent ID.
   * @returns A paginated list of agent log entries.
   */
  async logs(agentId: string, options?: RequestOptionsExtras): Promise<Paginated<AgentLog>> {
    return this.listData<AgentLog>(
      `/agents/${encodeURIComponent(agentId)}/logs`,
      undefined,
      options,
    );
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
    options?: RequestOptionsExtras,
  ): Promise<PaginatedResponse<AgentLifecycleEvent>> {
    const res = await this.client.get<PaginatedResponse<AgentLifecycleEvent>>(
      `/v1/agents/${encodeURIComponent(agentId)}/events`,
      { query: toAgentEventQuery(params), ...options },
    );
    return res.data;
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
    requestOptions?: RequestOptionsExtras,
  ): Promise<AgentEventSubscription> {
    const res = await this.client.post<AgentEventSubscription>(
      `/v1/agents/${encodeURIComponent(agentId)}/events/subscriptions`,
      options,
      requestOptions,
    );
    return res.data;
  }

  /**
   * Remove a subscription to an agent's lifecycle event stream.
   *
   * @param agentId The unique agent ID.
   * @param subscriptionId The subscription to remove.
   */
  async unsubscribe(
    agentId: string,
    subscriptionId: string,
    options?: RequestOptionsExtras,
  ): Promise<void> {
    await this.client.delete<void>(
      `/v1/agents/${encodeURIComponent(agentId)}/events/subscriptions/${encodeURIComponent(subscriptionId)}`,
      options,
    );
  }
}

/**
 * Drop `undefined` / `null` entries so they never reach the query string, and
 * serialise event-type filters as a comma-separated list.
 */
function toAgentEventQuery(
  params?: ListAgentEventsParams,
): Record<string, string | number | boolean> | undefined {
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

/** Alias of {@link AgentResource} matching the `*sResource` client naming. */
export const AgentsResource = AgentResource;

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

/** Filters accepted by {@link AgentResource.list}. */
export type AgentListParams = ListAgentsParams;

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
    const res = await this.client.post<Agent>('/agents', params);
    return res.data;
  }

  /**
   * Retrieve an agent by its unique identifier.
   *
   * @param agentId The unique agent ID.
   * @returns The agent entity.
   */
  async get(agentId: string): Promise<Agent> {
    return this.getData<Agent>(`/agents/${encodeURIComponent(agentId)}`);
  }

  /**
   * List all agents associated with the organization.
   *
   * @param params Optional filters and pagination parameters.
   * @returns A paginated list of agent entities.
   */
  async list(params: AgentListParams = {}): Promise<Paginated<Agent>> {
    return this.listData<Agent>('/agents', { ...params });
  }

  /**
   * Iterate every agent across all pages.
   *
   * @param params Optional filters and pagination parameters.
   */
  iterate(params: AgentListParams = {}): AsyncGenerator<Agent, void, void> {
    return this.iterateData<Agent>('/agents', { ...params });
  }

  /**
   * Update an existing agent configuration.
   *
   * @param agentId The unique agent ID.
   * @param params Updated agent parameters.
   * @returns The updated agent entity.
   */
  async update(agentId: string, params: UpdateAgentParams): Promise<Agent> {
    const res = await this.client.patch<Agent>(`/agents/${encodeURIComponent(agentId)}`, params);
    return res.data;
  }

  /**
   * Delete an agent by its unique identifier.
   *
   * @param agentId The unique agent ID.
   */
  async delete(agentId: string): Promise<void> {
    await this.client.delete<void>(`/agents/${encodeURIComponent(agentId)}`);
  }

  /**
   * Fetch real-time operational status metrics for an agent.
   *
   * @param agentId The unique agent ID.
   * @returns The agent's status metrics.
   */
  async status(agentId: string): Promise<AgentStatusMetrics> {
    return this.getData<AgentStatusMetrics>(`/agents/${encodeURIComponent(agentId)}/status`);
  }

  /**
   * Fetch paginated execution logs for an agent.
   *
   * @param agentId The unique agent ID.
   * @returns A paginated list of agent log entries.
   */
  async logs(agentId: string): Promise<Paginated<AgentLog>> {
    return this.listData<AgentLog>(`/agents/${encodeURIComponent(agentId)}/logs`);
  }

  /**
   * List the agent's lifecycle event stream (creation, suspension, resumption,
   * budget exhaustion). Accepts an optional `event` filter and pagination.
   */
  async listEvents(
    agentId: string,
    params: PaginationParams & { event?: AgentLifecycleEventRecord['event'] } = {},
  ): Promise<Paginated<AgentLifecycleEventRecord>> {
    return this.listData<AgentLifecycleEventRecord>(
      `/agents/${encodeURIComponent(agentId)}/events`,
      { ...params },
    );
  }

  /**
   * Subscribe to an agent's lifecycle event stream via the SDK event bridge.
   *
   * Returns an unsubscribe function; call it (or abort via `options.signal`) to
   * stop receiving events. The handler receives the typed payload.
   *
   * > **Stub:** wiring to the live event bridge / polling transport is not yet
   * > implemented. This method validates its arguments and returns a working
   * > teardown, so callers can adopt the typed surface now and receive events
   * > once the transport lands. Backfill via `options.since` is forwarded to the
   * > transport when available.
   *
   * @param agentId The agent to observe (must be a non-empty string).
   * @param handler Called with each lifecycle event payload as it arrives.
   * @param options {@link AgentEventSubscriptionOptions} for error handling,
   *                abort support, and optional backfill (`since`).
   * @returns       A function that tears the subscription down.
   */
  subscribe(
    agentId: string,
    handler: (payload: AgentLifecycleEventRecord['data']) => void,
    options: AgentEventSubscriptionOptions = {},
  ): () => void {
    if (!agentId) {
      throw new Error('AgentResource.subscribe requires a non-empty agentId.');
    }

    let active = true;
    const abort = () => {
      active = false;
    };

    if (options.signal) {
      if (options.signal.aborted) {
        active = false;
      } else {
        options.signal.addEventListener('abort', abort, { once: true });
      }
    }

    void handler;
    void options.since;
    void options.replayLimit;

    return () => {
      active = false;
      options.signal?.removeEventListener('abort', abort);
    };
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

/** Alias of {@link AgentResource} matching the `*sResource` client naming. */
export const AgentsResource = AgentResource;

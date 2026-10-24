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
import {
  assertValidAgentId,
  validateCreateAgentParams,
  validateUpdateAgentParams,
} from './validation.js';

/** Filters accepted by {@link AgentResource.list}. */
export type AgentListParams = ListAgentsParams;

/**
 * Strongly typed query parameters accepted by {@link AgentResource.list}: page
 * size (`limit`), keyset `cursor`, and the `status` / `tag` filters (plus the
 * remaining filters inherited from {@link ListAgentsParams}).
 *
 * Pass a previously returned `meta.nextCursor` as `cursor` to continue from a
 * saved position. Only explicitly supplied values are serialized into the
 * request querystring — `undefined` entries are dropped.
 */
export type AgentListOptions = ListAgentsParams;

export type AgentStatusLookup =
  | { agentId: string; ok: true; status: AgentStatusMetrics }
  | { agentId: string; ok: false; reason: 'not_found' | 'error'; error: unknown };

export interface PartitionedAgentStatuses {
  statuses: Map<string, AgentStatusMetrics>;
  missing: string[];
  failed: Array<{ agentId: string; error: unknown }>;
}

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
   * The payload is checked against {@link CreateAgentDto} before the request is
   * dispatched: a malformed body throws an {@link AstroidValidationError}
   * locally rather than costing a round trip and a 422.
   *
   * @param params Agent creation parameters.
   * @returns The created agent entity.
   *
   * @example
   * ```ts
   * const agent = await astroid.agents.create({
   *   name: 'TradingBot',
   *   capabilities: ['trade'],
   *   initialBudget: { currency: 'USDC', amount: '100' }
   * });
   * ```
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
   *
   * @example
   * ```ts
   * const agent = await astroid.agents.get('agt_12345');
   * console.log(agent.status);
   * ```
   */
  async get(agentId: string, options?: RequestOptionsExtras): Promise<Agent> {
    return this.getData<Agent>(`/agents/${encodeURIComponent(agentId)}`, undefined, options);
  }

  /**
   * List all agents associated with the organization.
   *
   * Every supplied option is serialized into the request querystring by the
   * HTTP client (which builds the URL with `URLSearchParams`); options left
   * `undefined` never reach the wire.
   *
   * @param params Optional filters and pagination parameters.
   * @returns A paginated list of agent entities.
   *
   * @example
   * ```ts
   * const result = await astroid.agents.list({ status: 'ACTIVE', tag: 'trading', limit: 10 });
   * console.log(result.data.length);
   * ```
   *
   * @example Cursor pagination
   * ```ts
   * const first = await astroid.agents.list({ limit: 25 });
   * const next = await astroid.agents.list({ limit: 25, cursor: first.meta?.nextCursor });
   * ```
   */
  async list(
    params: AgentListOptions = {},
    options?: RequestOptionsExtras,
  ): Promise<Paginated<Agent>> {
    return this.listData<Agent>('/agents', toAgentListQuery(params), options);
  }

  /**
   * List all agents associated with the organization (`listAgents` spelling).
   *
   * Identical to {@link AgentResource.list}; provided so callers using the
   * `listAgents` resource-method naming don't need to guess.
   *
   * @param params Optional filters and pagination parameters.
   * @returns A paginated list of agent entities.
   *
   * @example
   * ```ts
   * const { data } = await astroid.agents.listAgents({ limit: 50, cursor: savedCursor });
   * ```
   */
  async listAgents(
    params: AgentListOptions = {},
    options?: RequestOptionsExtras,
  ): Promise<Paginated<Agent>> {
    return this.list(params, options);
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
   * The payload is checked against {@link UpdateAgentDto} before the request is
   * dispatched: a malformed body (or an empty no-op patch) throws an
   * {@link AstroidValidationError} locally rather than costing a round trip.
   *
   * @param agentId The unique agent ID.
   * @param params Updated agent parameters.
   * @param options Extra request options (timeout, signal, headers) forwarded
   *   to the HTTP client.
   * @returns The updated agent entity.
   *
   * @example
   * ```ts
   * const updatedAgent = await astroid.agents.update('agt_12345', { status: 'SUSPENDED' });
   * ```
   */
  async update(
    agentId: string,
    params: UpdateAgentParams,
    options?: RequestOptionsExtras,
  ): Promise<Agent> {
    assertValidAgentId(agentId);
    validateUpdateAgentParams(params);
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
   *
   * @example
   * ```ts
   * const deactivated = await astroid.agents.deactivate('agt_12345');
   * console.log(deactivated.status); // 'ARCHIVED'
   * ```
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
 * Serialize the `GET /agents` list options into a query record.
 *
 * Only explicitly supplied values are copied, so `undefined` filters never
 * become `?status=undefined`; an empty options object yields an empty record
 * (the HTTP client then omits the querystring entirely).
 */
function toAgentListQuery(params: AgentListOptions = {}): Record<string, string | number> {
  const query: Record<string, string | number> = {};
  if (params.page !== undefined) query['page'] = params.page;
  if (params.limit !== undefined) query['limit'] = params.limit;
  if (params.cursor !== undefined) query['cursor'] = params.cursor;
  if (params.status !== undefined) query['status'] = params.status;
  if (params.role !== undefined) query['role'] = params.role;
  if (params.tag !== undefined) query['tag'] = params.tag;
  if (params.search !== undefined) query['search'] = params.search;
  return query;
}

export function partitionAgentStatuses(
  results: readonly AgentStatusLookup[],
): PartitionedAgentStatuses {
  const partitioned: PartitionedAgentStatuses = { statuses: new Map(), missing: [], failed: [] };
  for (const result of results) {
    if (result.ok) {
      partitioned.statuses.set(result.agentId, result.status);
    } else if (result.reason === 'not_found') {
      partitioned.missing.push(result.agentId);
    } else {
      partitioned.failed.push({ agentId: result.agentId, error: result.error });
    }
  }
  return partitioned;
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

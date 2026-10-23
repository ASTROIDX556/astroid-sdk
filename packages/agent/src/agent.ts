import { Resource, type RequestOptionsExtras } from '@astroid/core';
import { NotFoundError } from '@astroid/errors';
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
  assertValidBatchConcurrency,
  validateBatchAgentIds,
  validateCreateAgentParams,
  validateUpdateAgentParams,
} from './validation.js';

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

/** Status requests {@link AgentResource.batchStatus} keeps in flight at once by default. */
export const DEFAULT_BATCH_STATUS_CONCURRENCY = 5;

/** Options accepted by {@link AgentResource.batchStatus}. */
export interface BatchAgentStatusOptions extends RequestOptionsExtras {
  /**
   * Most status requests in flight at once, a whole number of at least 1.
   * Defaults to {@link DEFAULT_BATCH_STATUS_CONCURRENCY}.
   */
  concurrency?: number;
}

/**
 * The outcome of looking up one agent in a batch.
 *
 * `not_found` means the API answered 404 for that id; `error` is any other
 * failure (network, timeout, 5xx, permissions), kept so the caller can decide
 * whether to retry just that id.
 */
export type AgentStatusLookup =
  | { agentId: string; ok: true; status: AgentStatusMetrics }
  | { agentId: string; ok: false; reason: 'not_found' | 'error'; error: unknown };

/** {@link AgentStatusLookup} results split by outcome; see {@link partitionAgentStatuses}. */
export interface PartitionedAgentStatuses {
  /** Metrics for every agent that was found, keyed by agent id. */
  statuses: Map<string, AgentStatusMetrics>;
  /** Ids the API does not know. */
  missing: string[];
  /** Ids whose lookup failed for another reason, with the error. */
  failed: Array<{ agentId: string; error: unknown }>;
}

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
   * @param params Optional filters and pagination parameters.
   * @returns A paginated list of agent entities.
   *
   * @example
   * ```ts
   * const result = await astroid.agents.list({ status: 'ACTIVE', limit: 10 });
   * console.log(result.data.length);
   * ```
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
  async deactivate(agentId: string): Promise<Agent> {
    const res = await this.client.post<Agent>(`/agents/${encodeURIComponent(agentId)}/deactivate`);
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
   * Fetch the status metrics of several agents in one call.
   *
   * The API documents `GET /agents/:id/status` and no multi-agent route, so
   * this runs one lookup per distinct id with at most `concurrency` of them in
   * flight, and returns once every id has an outcome. A missing or failing
   * agent never rejects the whole call: it comes back as a `not_found` or
   * `error` entry next to the agents that succeeded. Results follow the order
   * the ids first appear in, and an id passed twice is looked up once.
   *
   * Malformed input (a non-array, a blank or non-string id, a bad
   * `concurrency`) throws an {@link AstroidValidationError} before any request
   * is sent. If `options.signal` aborts, the call rejects with the abort reason
   * and starts no further lookups.
   *
   * @param agentIds The agent ids to look up. An empty list resolves to `[]`.
   * @param options `concurrency`, plus the usual timeout, signal and headers.
   * @returns One {@link AgentStatusLookup} per distinct id. Pass it to
   *   {@link partitionAgentStatuses} to split it by outcome.
   *
   * @example
   * ```ts
   * const results = await astroid.agents.batchStatus(['agt_1', 'agt_2', 'agt_3']);
   * const { statuses, missing, failed } = partitionAgentStatuses(results);
   * ```
   */
  async batchStatus(
    agentIds: readonly string[],
    options: BatchAgentStatusOptions = {},
  ): Promise<AgentStatusLookup[]> {
    const { concurrency = DEFAULT_BATCH_STATUS_CONCURRENCY, ...requestOptions } = options;
    const ids = validateBatchAgentIds(agentIds);
    assertValidBatchConcurrency(concurrency);

    const results: AgentStatusLookup[] = new Array(ids.length);
    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < ids.length) {
        if (requestOptions.signal?.aborted) {
          throw requestOptions.signal.reason ?? new Error('The batch status lookup was aborted.');
        }
        const index = next++;
        const agentId = ids[index] as string;
        results[index] = await this.lookupStatus(agentId, requestOptions);
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, worker));
    return results;
  }

  /** One batch lookup: the metrics, or why there are none. Never throws. */
  private async lookupStatus(
    agentId: string,
    options: RequestOptionsExtras,
  ): Promise<AgentStatusLookup> {
    try {
      return { agentId, ok: true, status: await this.status(agentId, options) };
    } catch (error) {
      return { agentId, ok: false, reason: isNotFound(error) ? 'not_found' : 'error', error };
    }
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
 * Split {@link AgentResource.batchStatus} results by outcome.
 *
 * `statuses` is keyed by agent id, so a dashboard can render each agent it asked
 * about from one lookup and show `missing` and `failed` ids separately.
 */
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

/** True for a typed not-found error or any error that carries HTTP status 404. */
function isNotFound(error: unknown): boolean {
  if (error instanceof NotFoundError) return true;
  return (
    typeof error === 'object' &&
    error !== null &&
    ((error as { status?: unknown }).status === 404 ||
      (error as { statusCode?: unknown }).statusCode === 404)
  );
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

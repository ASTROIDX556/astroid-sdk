/**
 * `@astroid/agent` — AI-agent identity resource.
 *
 * An agent is a first-class autonomous actor: it owns a wallet, spends against
 * budgets, and is bound by policies. This resource manages the agent's
 * lifecycle and exposes its recent activity feed.
 *
 * @packageDocumentation
 */

import { Resource } from '@astroid/core';
import type {
  Agent,
  AgentActivity,
  AgentLifecycleEventRecord,
  AgentEventSubscriptionOptions,
  AgentStatus,
  CreateAgentInput,
  Paginated,
  PaginationParams,
  UpdateAgentInput,
} from '@astroid/types';

/** Filters accepted by {@link AgentResource.list}. */
export interface AgentListParams extends PaginationParams {
  status?: AgentStatus;
  role?: string;
}

/**
 * The `agents` namespace on the Astroid client.
 *
 * Agents can be created, listed, updated, paused/resumed, and archived. Pausing
 * an agent halts its autonomous spending without tearing down its wallet or
 * history.
 */
export class AgentResource extends Resource {
  /** Register a new AI agent. */
  async create(input: CreateAgentInput): Promise<Agent> {
    const res = await this.client.post<Agent>('/agents', input);
    return res.data;
  }

  /** Fetch a single agent by id. */
  async get(agentId: string): Promise<Agent> {
    return this.getData<Agent>(`/agents/${encodeURIComponent(agentId)}`);
  }

  /** List agents, with optional status/role filters and pagination. */
  async list(params: AgentListParams = {}): Promise<Paginated<Agent>> {
    return this.listData<Agent>('/agents', { ...params });
  }

  /** Iterate every agent across all pages. */
  iterate(params: AgentListParams = {}): AsyncGenerator<Agent, void, void> {
    return this.iterateData<Agent>('/agents', { ...params });
  }

  /** Update an agent's mutable fields (name, capabilities, policies, metadata). */
  async update(agentId: string, input: UpdateAgentInput): Promise<Agent> {
    const res = await this.client.patch<Agent>(`/agents/${encodeURIComponent(agentId)}`, input);
    return res.data;
  }

  /** Pause an agent: suspend its autonomous activity. */
  async pause(agentId: string): Promise<Agent> {
    const res = await this.client.post<Agent>(`/agents/${encodeURIComponent(agentId)}/pause`);
    return res.data;
  }

  /** Resume a paused agent, returning it to `ACTIVE`. */
  async resume(agentId: string): Promise<Agent> {
    const res = await this.client.post<Agent>(`/agents/${encodeURIComponent(agentId)}/resume`);
    return res.data;
  }

  /** Archive an agent (soft-delete). */
  async archive(agentId: string): Promise<Agent> {
    const res = await this.client.post<Agent>(`/agents/${encodeURIComponent(agentId)}/archive`);
    return res.data;
  }

  /** The agent's recent activity feed (transactions, decisions, events). */
  async activity(
    agentId: string,
    params: PaginationParams = {},
  ): Promise<Paginated<AgentActivity>> {
    return this.listData<AgentActivity>(
      `/agents/${encodeURIComponent(agentId)}/activity`,
      { ...params },
    );
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
}

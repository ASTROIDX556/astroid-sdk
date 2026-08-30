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
  AgentLog,
  AgentStatus,
  AgentStatusMetrics,
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
  /** Register a new AI agent with runtime payload validation. */
  async create(input: CreateAgentInput): Promise<Agent> {
    // TODO: Add runtime schema checks for agent creation payloads
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
    // TODO: Add runtime schema checks for agent update payloads
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

  /** Paginated execution logs for the agent. */
  async logs(
    agentId: string,
    params: PaginationParams = {},
  ): Promise<Paginated<AgentLog>> {
    return this.listData<AgentLog>(
      `/agents/${encodeURIComponent(agentId)}/logs`,
      { ...params },
    );
  }

  /** Real-time operational status metrics for the agent. */
  async status(agentId: string): Promise<AgentStatusMetrics> {
    const res = await this.client.get<AgentStatusMetrics>(
      `/agents/${encodeURIComponent(agentId)}/status`,
    );
    return res.data;
  }
}

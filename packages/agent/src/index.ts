import { Resource } from '@astroid/core';
import type {
  Agent,
  AgentLog,
  AgentStatusMetrics,
  CreateAgentParams,
  ListAgentsParams,
  Paginated,
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
}

/** Alias of {@link AgentResource} matching the `*sResource` client naming. */
export const AgentsResource = AgentResource;

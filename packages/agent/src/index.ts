import { Resource } from '@astroid/core';
import type { Agent, CreateAgentParams, UpdateAgentParams, PaginatedResponse, PaginationParams } from '@astroid/types';
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
}

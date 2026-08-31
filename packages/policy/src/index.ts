import { Resource } from '@astroid/core';
import type {
  Paginated,
  Policy,
  PolicySimulationRequest,
  PolicySimulationResult,
} from '@astroid/types';

/** Filters accepted by {@link PolicyResource.list}. */
export interface PolicyListParams {
  /** Only policies that are enabled (or disabled). */
  enabled?: boolean;
  /** Only policies of this type. */
  type?: string;
  /** Only policies scoped to this agent. */
  agentId?: string;
}

export class PolicyResource extends Resource {
  /**
   * Create a new spending policy.
   */
  async create(input: Omit<Policy, 'id' | 'organizationId' | 'createdAt' | 'updatedAt'>): Promise<Policy> {
    const res = await this.client.post<Policy>('/policies', input);
    return res.data;
  }

  /**
   * Retrieve a policy by ID.
   */
  async get(id: string): Promise<Policy> {
    return this.getData<Policy>(`/policies/${encodeURIComponent(id)}`);
  }

  /**
   * List policies with optional filtering.
   */
  async list(params: PolicyListParams = {}): Promise<Paginated<Policy>> {
    return this.listData<Policy>('/policies', { ...params });
  }

  /**
   * Update an existing policy.
   */
  async update(id: string, input: Partial<Omit<Policy, 'id' | 'organizationId' | 'createdAt' | 'updatedAt'>>): Promise<Policy> {
    const res = await this.client.patch<Policy>(`/policies/${encodeURIComponent(id)}`, input);
    return res.data;
  }

  /**
   * Delete a policy.
   */
  async delete(id: string): Promise<void> {
    await this.client.delete<void>(`/policies/${encodeURIComponent(id)}`);
  }

  /**
   * Perform a pre-flight server-side policy simulation.
   */
  async simulate(input: PolicySimulationRequest): Promise<PolicySimulationResult> {
    const res = await this.client.post<PolicySimulationResult>('/policies/simulate', input);
    return res.data;
  }

  /**
   * Perform a policy simulation dry-run check against active spending policies.
   */
  async simulatePolicy(input: PolicySimulationRequest): Promise<PolicySimulationResult> {
    return this.simulate(input);
  }
}

/** Alias of {@link PolicyResource} matching the `*sResource` client naming. */
export const PoliciesResource = PolicyResource;

export * from './simulator.js';

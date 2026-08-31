import { Resource } from '@astroid/core';
import type {
  Policy,
  PolicySimulationRequest,
  PolicySimulationResult,
} from '@astroid/types';

export class PolicyResource extends Resource {
  /**
   * Create a new spending policy.
   */
  async create(input: Omit<Policy, 'id' | 'organizationId' | 'createdAt' | 'updatedAt'>): Promise<Policy> {
    return this.http.post<Policy>('/policies', input);
  }

  /**
   * Retrieve a policy by ID.
   */
  async get(id: string): Promise<Policy> {
    return this.http.get<Policy>(`/policies/${encodeURIComponent(id)}`);
  }

  /**
   * List policies with optional filtering.
   */
  async list(params?: { enabled?: boolean; type?: string }): Promise<{ data: Policy[]; meta?: { page: number; limit: number; total: number; totalPages: number } }> {
    return this.http.get('/policies', { params });
  }

  /**
   * Update an existing policy.
   */
  async update(id: string, input: Partial<Omit<Policy, 'id' | 'organizationId' | 'createdAt' | 'updatedAt'>>): Promise<Policy> {
    return this.http.patch<Policy>(`/policies/${encodeURIComponent(id)}`, input);
  }

  /**
   * Delete a policy.
   */
  async delete(id: string): Promise<void> {
    return this.http.delete<void>(`/policies/${encodeURIComponent(id)}`);
  }

  /**
   * Perform a pre-flight server-side policy simulation.
   */
  async simulate(input: PolicySimulationRequest): Promise<PolicySimulationResult> {
    return this.http.post<PolicySimulationResult>('/policies/simulate', input);
  }

  /**
   * Perform a policy simulation dry-run check against active spending policies.
   */
  async simulatePolicy(input: PolicySimulationRequest): Promise<PolicySimulationResult> {
    return this.simulate(input);
  }
}

export * from './simulator.js';

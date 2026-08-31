import { Resource } from '@astroid/core';
import type { Policy, PolicySimulationResult, SimulatePolicyRequest } from '@astroid/types';

export * from './simulator.js';

export interface CreatePolicyInput {
  name: string;
  type: Policy['type'];
  configuration: Policy['configuration'];
  priority?: number;
  enabled?: boolean;
}

export interface UpdatePolicyInput {
  name?: string;
  type?: Policy['type'];
  configuration?: Policy['configuration'];
  priority?: number;
  enabled?: boolean;
}

export interface ListPoliciesParams {
  enabled?: boolean;
  limit?: number;
  page?: number;
}

export class PolicyResource extends Resource {
  /**
   * Create a new policy.
   */
  public async create(input: CreatePolicyInput): Promise<Policy> {
    return this.http.post<Policy>('/policies', input);
  }

  /**
   * Get a policy by its ID.
   */
  public async get(policyId: string): Promise<Policy> {
    return this.http.get<Policy>(`/policies/${policyId}`);
  }

  /**
   * List policies with optional filtering.
   */
  public async list(params?: ListPoliciesParams): Promise<{ data: Policy[]; meta?: any }> {
    return this.http.get<{ data: Policy[]; meta?: any }>('/policies', { query: params });
  }

  /**
   * Update an existing policy.
   */
  public async update(policyId: string, input: UpdatePolicyInput): Promise<Policy> {
    return this.http.patch<Policy>(`/policies/${policyId}`, input);
  }

  /**
   * Delete a policy by ID.
   */
  public async delete(policyId: string): Promise<void> {
    return this.http.delete<void>(`/policies/${policyId}`);
  }

  /**
   * Simulate a transaction payload or request against policies.
   */
  public async simulate(payload: SimulatePolicyRequest): Promise<PolicySimulationResult> {
    return this.http.post<PolicySimulationResult>('/policies/simulate', payload);
  }

  /**
   * Simulate transactions or requests against a specific policy by ID.
   */
  public async simulatePolicy(policyId: string, payload: SimulatePolicyRequest): Promise<PolicySimulationResult> {
    return this.http.post<PolicySimulationResult>(`/policies/${policyId}/simulate`, payload);
  }
}

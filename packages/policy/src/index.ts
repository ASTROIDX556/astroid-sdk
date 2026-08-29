/**
 * `@astroid/policy` — spending-policy resource with pre-flight simulation.
 *
 * Policies are the programmable guardrails on every transaction (amount caps,
 * asset allow-lists, recipient rules, time windows, …). The `simulate` method
 * is the AI-native pre-flight: it evaluates a hypothetical transfer against all
 * applicable policies and returns violations, required approvals, risk, and
 * budget impact — without creating anything.
 *
 * @packageDocumentation
 */

import { Resource } from '@astroid/core';
import type {
  CreatePolicyInput,
  Paginated,
  PaginationParams,
  Policy,
  PolicySimulationResult,
  PolicyType,
  SimulatePolicyInput,
  UpdatePolicyInput,
} from '@astroid/types';

export {
  simulatePolicy,
  type PolicySimulationReport,
  type SimulatedTransaction,
} from './simulator.js';

/** Filters accepted by {@link PolicyResource.list}. */
export interface PolicyListParams extends PaginationParams {
  type?: PolicyType;
  enabled?: boolean;
  agentId?: string;
  walletId?: string;
}

/**
 * The `policies` namespace on the Astroid client.
 *
 * Beyond CRUD, this resource exposes {@link PolicyResource.simulate} — the
 * "AI Simulation Mode" that lets an agent check whether an action *would* be
 * allowed and reason about the explanation before committing to it.
 */
export class PolicyResource extends Resource {
  /** Create a new policy. */
  async create(input: CreatePolicyInput): Promise<Policy> {
    const res = await this.client.post<Policy>('/policies', input);
    return res.data;
  }

  /** Fetch a single policy by id. */
  async get(policyId: string): Promise<Policy> {
    return this.getData<Policy>(`/policies/${encodeURIComponent(policyId)}`);
  }

  /** List policies, with optional type/enabled/scope filters and pagination. */
  async list(params: PolicyListParams = {}): Promise<Paginated<Policy>> {
    return this.listData<Policy>('/policies', { ...params });
  }

  /** Iterate every policy across all pages. */
  iterate(params: PolicyListParams = {}): AsyncGenerator<Policy, void, void> {
    return this.iterateData<Policy>('/policies', { ...params });
  }

  /** Update a policy's configuration, priority, or enabled state. */
  async update(policyId: string, input: UpdatePolicyInput): Promise<Policy> {
    const res = await this.client.patch<Policy>(`/policies/${encodeURIComponent(policyId)}`, input);
    return res.data;
  }

  /** Enable a policy. */
  async enable(policyId: string): Promise<Policy> {
    const res = await this.client.post<Policy>(`/policies/${encodeURIComponent(policyId)}/enable`);
    return res.data;
  }

  /** Disable a policy without deleting it. */
  async disable(policyId: string): Promise<Policy> {
    const res = await this.client.post<Policy>(`/policies/${encodeURIComponent(policyId)}/disable`);
    return res.data;
  }

  /** Permanently delete a policy. */
  async delete(policyId: string): Promise<void> {
    await this.client.delete<void>(`/policies/${encodeURIComponent(policyId)}`);
  }

  /**
   * Pre-flight a hypothetical transaction against all applicable policies.
   * Nothing is created; the result explains whether it would be allowed, which
   * policies it would violate, what approvals it would require, and its risk and
   * budget impact.
   */
  async simulate(input: SimulatePolicyInput): Promise<PolicySimulationResult> {
    const res = await this.client.post<PolicySimulationResult>('/policies/simulate', input);
    return res.data;
  }
}

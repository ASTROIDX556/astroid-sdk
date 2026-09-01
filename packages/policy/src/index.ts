import { Resource } from '@astroid/core';
import type {
  Paginated,
  Policy,
  PolicySimulationRequest,
  PolicySimulationResult,
} from '@astroid/types';

import { simulatePolicy } from './simulator.js';
import type { PolicySimulationReport, SimulatedTransaction } from './simulator.js';

export type { PolicySimulationReport, SimulatedTransaction };

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

  /**
   * Pre-flight check a proposed transaction against an agent's configured
   * spending and security policies before execution.
   *
   * This is the high-level simulation wrapper: it fetches the active policies
   * for the given agent (or wallet), converts the proposed transaction into a
   * {@link SimulatedTransaction}, and evaluates it client-side with the local
   * policy engine. The result tells the caller whether the transaction may
   * proceed and, if not, exactly which rules were breached — all without
   * spending network fees on a transaction that would be rejected.
   *
   * @param options.agentId     Agent whose policies apply (mutually exclusive with `walletId`).
   * @param options.walletId    Wallet whose policies apply (mutually exclusive with `agentId`).
   * @param options.transaction The proposed transaction to evaluate.
   * @returns                   A structured report with a `passed` flag and per-rule violations.
   * @throws                    If neither `agentId` nor `walletId` is provided.
   */
  async simulateTransaction(options: {
    agentId?: string;
    walletId?: string;
    transaction: SimulatedTransaction;
  }): Promise<PolicySimulationReport> {
    const { agentId, walletId, transaction } = options;

    if (!agentId && !walletId) {
      throw new Error('simulateTransaction requires an `agentId` or `walletId` to scope the policy check.');
    }

    const params: PolicyListParams & { walletId?: string } = { enabled: true };
    if (agentId) params.agentId = agentId;
    if (walletId) (params as { walletId?: string }).walletId = walletId;

    const { data: policies } = await this.list(params);

    return simulatePolicy(policies, transaction);
  }
}

/** Alias of {@link PolicyResource} matching the `*sResource` client naming. */
export const PoliciesResource = PolicyResource;

export * from './simulator.js';

import { Resource, type RequestOptionsExtras } from '@astroid/core';
import type {
  Paginated,
  Policy,
  PolicySimulationEvaluation,
  PolicySimulationInput,
  PolicySimulationRequest,
  PolicySimulationResult,
  PolicyType,
  PolicyRule,
  TransactionDetails,
  PolicyRuleSimulationResult,
  PolicyUpdateSimulationRequest,
  PolicyUpdateSimulationResult,
} from '@astroid/types';

import { simulatePolicy as evaluatePolicyRules } from './simulator.js';
import type { PolicySimulationReport, SimulatedTransaction } from './simulator.js';
import { simulatePolicy } from './simulate-policy.js';
import { simulatePolicyUpdate } from './simulate-policy-update.js';
import { simulatePolicyEvaluation } from './simulation.js';
import { assertPolicyCreateInput, assertPolicySimulationRequest } from './schemas.js';

/**
 * The client-side (offline) policy engine. `evaluatePolicyRules` is the pure
 * evaluator that takes a set of policy rules and a transaction payload and
 * returns a {@link PolicySimulationReport} — no network required.
 */
export { evaluatePolicyRules };

/**
 * CRUD + simulation wrapper for the `/policies` resource, also exported as
 * `PolicyClient` (the name used in the #242 acceptance criteria).
 */
export { PolicyClient } from './client.js';

/**
 * Server-side policy simulation endpoint helper. Import `simulatePolicy` to run
 * a dry-run against the API without constructing a {@link PolicyResource}.
 */
export {
  simulatePolicy,
  POLICY_SIMULATE_PATH,
  type PolicySimulationHttpClient,
} from './simulate-policy.js';

/**
 * Server-side policy update simulation endpoint helper (issue #249). Import
 * `simulatePolicyUpdate` to validate a proposed rule change against historical
 * transactions without constructing a {@link PolicyResource}.
 */
export {
  simulatePolicyUpdate,
  validatePolicyUpdateSimulationInput,
  POLICY_SIMULATE_UPDATE_PATH,
  type PolicyUpdateSimulationHttpClient,
} from './simulate-policy-update.js';

/**
 * Single-policy simulation helper — a dry-run against one policy by id
 * (`POST /policies/{id}/simulate`), plus the local payload validation and the
 * defensive response parser that back it.
 */
export {
  simulatePolicyEvaluation,
  toPolicySimulationEvaluation,
  validatePolicySimulationInput,
  policySimulationPath,
  isValidPolicySimulationAmount,
  isValidPolicySpentInWindow,
  riskBandForScore,
  POLICY_SIMULATE_BY_ID_PATH,
} from './simulation.js';

/** Offline policy-engine types and helpers (see {@link evaluatePolicyRules}). */
export {
  simulatePolicyLocal,
  type SimulatedTransaction,
  type PolicySimulationReport,
  type DecodedOperation,
  type DecodedTxPayload,
  type LocalPolicySimulationResult,
} from './simulator.js';

/**
 * Policy scope matchers — selecting which rules apply to a transaction
 * context before simulation ({@link matchesPolicyScope}, {@link matchPolicies}).
 */
export {
  matchesPolicyScope,
  matchPolicies,
  combineMatchers,
  type PolicyMatcher,
  type PolicyScope,
} from './matchers.js';

/**
 * Local authorization pre-flight engine — validating a proposed transaction
 * against a {@link PolicySet} offline ({@link evaluatePolicy}), including
 * destination allow/deny lists, time-of-day windows and signature weight
 * thresholds. See `./evaluation.js`.
 */
export {
  evaluatePolicy,
  policySetFromPolicies,
  normalizeAddress,
  addressesMatch,
  isActionWithinAllowedHours,
  resolveSignedWeight,
  type EvaluatePolicyOptions,
  type PolicyAllowedHours,
  type PolicyEvaluationResult,
  type PolicyRule,
  type PolicyRuleCheck,
  type PolicyRuleEvaluation,
  type PolicySet,
  type TransactionDetails,
  type TransactionSignature,
} from './evaluation.js';

/**
 * Policy DTOs re-exported from `@astroid/types` so consumers of
 * `@astroid/policy` can name the simulation request/response types without a
 * second import.
 */
export type {
  Policy,
  PolicyConfiguration,
  PolicySimulationRequest,
  PolicySimulationResult,
  PolicySimulationInput,
  PolicySimulationEvaluation,
  PolicyRuleBreach,
  PolicyViolation,
  PolicyViolationDetail,
  PolicyRiskAssessment,
  PolicyRiskFactor,
  PolicyBudgetImpact,
  PolicyUpdateSimulationRequest,
  PolicyUpdateSimulationOutcome,
  PolicyUpdateSimulationImpact,
  PolicyUpdateSimulationResult,
  SimulatePolicyRequest,
  Paginated,
} from '@astroid/types';

/**
 * `PolicyType` is both a union type and a runtime lookup table, so it is
 * re-exported as a value: consumers filtering by
 * {@link PolicyListParams.type} can enumerate the valid types with
 * `Object.values(PolicyType)` instead of hardcoding the strings.
 */
export { PolicyType } from '@astroid/types';

/**
 * The payload accepted by {@link PolicyResource.create}: a {@link Policy}
 * without the fields the server owns.
 *
 * Exported so callers can type a draft before handing it over — the output of
 * `PolicyBuilder#build()` is exactly this type. Note that server-owned fields
 * are omitted rather than made optional, so a stale `id` or `deletedAt` left
 * over from a fetched record is a compile error rather than a silent overwrite.
 */
export type PolicyCreateInput = Omit<
  Policy,
  'id' | 'organizationId' | 'createdAt' | 'updatedAt' | 'deletedAt'
>;

/**
 * The payload accepted by {@link PolicyResource.update}.
 *
 * A partial {@link PolicyCreateInput}: every field is optional, but the
 * server-owned fields are still excluded, so a PATCH can never rewrite them.
 */
export type PolicyUpdateInput = Partial<PolicyCreateInput>;

/** Filters accepted by {@link PolicyResource.list}. */
export interface PolicyListParams {
  /** Only policies that are enabled (or disabled). */
  enabled?: boolean;
  /** Only policies of this type. */
  type?: PolicyType;
  /** Only policies scoped to this agent. */
  agentId?: string;
  /** Only policies scoped to this wallet. */
  walletId?: string;
}

export class PolicyResource extends Resource {
  /**
   * Create a new spending policy.
   *
   * @param input The policy to create — a {@link PolicyCreateInput}, which is
   *   also the type `PolicyBuilder#build()` returns.
   * @throws `ValidationError` when the API rejects the payload.
   */
  async create(input: PolicyCreateInput): Promise<Policy> {
    const payload = assertPolicyCreateInput(input);
    const res = await this.client.post<Policy>('/policies', payload);
    return res.data;
  }

  /**
   * Retrieve a policy by ID.
   *
   * @param id The policy id.
   * @throws `NotFoundError` when no policy has that id.
   */
  async get(id: string, options?: RequestOptionsExtras): Promise<Policy> {
    return this.getData<Policy>(`/policies/${encodeURIComponent(id)}`, undefined, options);
  }

  /**
   * List policies with optional filtering.
   *
   * @param params Filters — `enabled`, `type`, `agentId`, `walletId`.
   * @returns       The matching policies plus pagination metadata.
   */
  async list(
    params: PolicyListParams = {},
    options?: RequestOptionsExtras,
  ): Promise<Paginated<Policy>> {
    return this.listData<Policy>('/policies', { ...params }, options);
  }

  /**
   * Update an existing policy.
   *
   * @param id    The policy id.
   * @param input The fields to change — a {@link PolicyUpdateInput}.
   * @throws      `NotFoundError` when no policy has that id.
   */
  async update(
    id: string,
    input: PolicyUpdateInput,
    options?: RequestOptionsExtras,
  ): Promise<Policy> {
    const res = await this.client.patch<Policy>(
      `/policies/${encodeURIComponent(id)}`,
      input,
      options,
    );
    return res.data;
  }

  /**
   * Delete a policy.
   *
   * @param id The policy id.
   * @throws   `NotFoundError` when no policy has that id.
   */
  async delete(id: string, options?: RequestOptionsExtras): Promise<void> {
    await this.client.delete<void>(`/policies/${encodeURIComponent(id)}`, options);
  }

  /**
   * Create a new spending policy (`createPolicy` spelling).
   *
   * Identical to {@link PolicyResource.create}; provided so callers using the
   * `createPolicy` / `getPolicy` / `listPolicies` naming from the API reference
   * don't need to guess the shorthand.
   *
   * @param input The policy to create — a {@link PolicyCreateInput}.
   * @returns     The created policy record.
   * @throws      `ValidationError` when the API rejects the payload; the
   *              structured error carries the API message and field details.
   *
   * @example
   * ```ts
   * const policy = await astroid.policies.createPolicy({
   *   name: 'Max 500 USDC',
   *   type: 'MAX_AMOUNT',
   *   configuration: { maxAmount: 500 },
   *   priority: 1,
   *   enabled: true,
   * });
   * ```
   */
  async createPolicy(input: PolicyCreateInput, options?: RequestOptionsExtras): Promise<Policy> {
    return this.create(input, options);
  }

  /**
   * Retrieve a policy by ID (`getPolicy` spelling).
   *
   * Identical to {@link PolicyResource.get}.
   *
   * @param id The policy id.
   * @returns  The policy record.
   * @throws   `NotFoundError` when no policy has that id.
   *
   * @example
   * ```ts
   * const policy = await astroid.policies.getPolicy('pol_1');
   * ```
   */
  async getPolicy(id: string, options?: RequestOptionsExtras): Promise<Policy> {
    return this.get(id, options);
  }

  /**
   * List policies with optional filtering (`listPolicies` spelling).
   *
   * Identical to {@link PolicyResource.list}.
   *
   * @param params Filters — `enabled`, `type`, `agentId`, `walletId`.
   * @returns      The matching policies plus pagination metadata.
   *
   * @example
   * ```ts
   * const { data: policies } = await astroid.policies.listPolicies({ enabled: true });
   * ```
   */
  async listPolicies(
    params: PolicyListParams = {},
    options?: RequestOptionsExtras,
  ): Promise<Paginated<Policy>> {
    return this.list(params, options);
  }

  /**
   * Update an existing policy (`updatePolicy` spelling).
   *
   * Identical to {@link PolicyResource.update}.
   *
   * @param id    The policy id.
   * @param input The fields to change — a {@link PolicyUpdateInput}.
   * @returns     The updated policy record.
   * @throws      `NotFoundError` when no policy has that id, `ValidationError`
   *              when the API rejects the patch.
   *
   * @example
   * ```ts
   * const updated = await astroid.policies.updatePolicy('pol_1', { enabled: false });
   * ```
   */
  async updatePolicy(
    id: string,
    input: PolicyUpdateInput,
    options?: RequestOptionsExtras,
  ): Promise<Policy> {
    return this.update(id, input, options);
  }

  /**
   * Delete a policy (`deletePolicy` spelling).
   *
   * Identical to {@link PolicyResource.delete}.
   *
   * @param id The policy id.
   * @throws   `NotFoundError` when no policy has that id.
   *
   * @example
   * ```ts
   * await astroid.policies.deletePolicy('pol_1');
   * ```
   */
  async deletePolicy(id: string, options?: RequestOptionsExtras): Promise<void> {
    await this.delete(id, options);
  }
  /**
   * Simulate a proposed transaction against the organization's policy rules on
   * the server, **without committing it**.
   *
   * The request combines the transaction payload (`asset`, `amount`,
   * `recipientAddress`, …) with the rules to evaluate: pass `policyIds` to check
   * specific policies, or `walletId` / `agentId` to evaluate every enabled policy
   * in scope. The endpoint returns a {@link PolicySimulationResult} describing
   * whether the transaction is allowed, which rules were breached, any required
   * approvals, the risk assessment and the budget impact.
   *
   * A blocked transaction is **not** an error — `allowed` is `false` and
   * `violations` lists the breaches. Only a transport/API failure rejects.
   *
   * @param input The transaction payload plus the policy rules to evaluate against.
   * @returns     The dry-run decision and its supporting detail.
   * @throws      `NetworkError` / typed API errors when the request itself fails.
   *
   * @example
   * ```ts
   * const result = await astroid.policies.simulatePolicy({
   *   walletId: 'w_1',
   *   asset: 'USDC',
   *   amount: '250',
   *   recipientAddress: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW',
   * });
   *
   * if (!result.allowed) {
   *   throw new Error(result.explanation);
   * }
   * ```
   */
  async simulatePolicy(input: PolicySimulationRequest): Promise<PolicySimulationResult>;
  async simulatePolicy(
    policyId: string,
    input: PolicySimulationInput,
  ): Promise<PolicySimulationEvaluation>;
  /**
   * Simulate a proposed policy rule against a target transaction payload.
   *
   * @param rule        The proposed policy rule to evaluate.
   * @param transaction The target transaction/transfer payload.
   * @returns           The simulation result indicating if it was allowed/denied.
   */
  async simulatePolicy(
    rule: PolicyRule,
    transaction: TransactionDetails,
  ): Promise<PolicyRuleSimulationResult>;
  async simulatePolicy(
    policyOrRequest: string | PolicySimulationRequest | PolicyRule,
    input?: PolicySimulationInput | TransactionDetails,
  ): Promise<PolicySimulationResult | PolicySimulationEvaluation | PolicyRuleSimulationResult> {
    if (typeof policyOrRequest === 'string') {
      return this.simulatePolicyAgainst(policyOrRequest, input as PolicySimulationInput);
    }
    if (input) {
      const res = await this.client.post<PolicyRuleSimulationResult>('/policies/simulate-rule', {
        rule: policyOrRequest,
        transaction: input,
      });
      return res.data;
    }
    return simulatePolicy(
      this.client,
      assertPolicySimulationRequest(policyOrRequest) as PolicySimulationRequest,
    );
  }

  /**
   * Simulate a proposed transaction against a **single** policy, without
   * committing it.
   *
   * @param policyId The policy to evaluate the transaction against.
   * @param input    The proposed transaction payload.
   * @returns        The decision, violated rules, risk score and budget impact.
   */
  async simulatePolicyAgainst(
    policyId: string,
    input: PolicySimulationInput,
  ): Promise<PolicySimulationEvaluation> {
    return simulatePolicyEvaluation(this.client, policyId, input);
  }

  /**
   * Validate a proposed policy rule change against historical transaction
   * payloads before persisting the update (issue #249).
   *
   * The proposed rule is replayed against each historical transaction so the
   * caller sees, up front, exactly which transactions the change would reject,
   * which rule checks pass, and the estimated impact — all without committing
   * anything.
   *
   * An unsafe change is **not** an error — `valid` is `false` and
   * `violatedConstraints` / `estimatedImpact` describe the damage. Only a
   * transport/API failure rejects.
   *
   * @param input The policy id, the proposed rule and the historical transactions.
   * @returns     The verdict, per-transaction outcomes, aggregate impact and a
   *              human-readable explanation.
   * @throws      `ValidationError` when the request payload is malformed;
   *              `NetworkError` / typed API errors when the request itself fails.
   *
   * @example
   * ```ts
   * const result = await astroid.policies.simulatePolicyUpdate({
   *   policyId: 'pol_max',
   *   proposedRule: { name: 'max-250', allowedRecipients: ['GABCD…'] },
   *   transactions: [{ asset: 'USDC', amount: '150' }],
   * });
   *
   * if (!result.valid) {
   *   throw new Error(result.explanation);
   * }
   * await astroid.policies.update('pol_max', { /* the validated change *\/ });
   * ```
   */
  async simulatePolicyUpdate(
    input: PolicyUpdateSimulationRequest,
  ): Promise<PolicyUpdateSimulationResult> {
    return simulatePolicyUpdate(this.client, input);
  }

  /**
   * Perform a pre-flight server-side policy simulation.
   *
   * @deprecated Use {@link PolicyResource.simulatePolicy} instead; behaviour is
   * identical.
   */
  async simulate(
    input: PolicySimulationRequest,
    options?: RequestOptionsExtras,
  ): Promise<PolicySimulationResult> {
    return simulatePolicy(this.client, input, options);
  }

  /**
   * Pre-flight check a proposed transaction against an agent's configured
   * spending and security policies before execution.
   *
   * This is the high-level simulation wrapper: it fetches the active policies
   * for the given agent (or wallet), converts the proposed transaction into a
   * {@link SimulatedTransaction}, and evaluates it client-side with the local
   * policy engine (`evaluatePolicyRules`). The result tells the caller whether
   * the transaction may proceed and, if not, exactly which rules were breached —
   * all without spending network fees on a transaction that would be rejected.
   *
   * @param options.agentId     Agent whose policies apply (mutually exclusive with `walletId`).
   * @param options.walletId    Wallet whose policies apply (mutually exclusive with `agentId`).
   * @param options.transaction The proposed transaction to evaluate.
   * @param requestOptions      Extra request options (e.g. `signal`, `timeoutMs`) applied to
   *                            the policy-listing request.
   * @returns                   A structured report with a `passed` flag and per-rule violations.
   * @throws                    If neither `agentId` nor `walletId` is provided.
   */
  async simulateTransaction(
    options: {
      agentId?: string;
      walletId?: string;
      transaction: SimulatedTransaction;
    },
    requestOptions?: RequestOptionsExtras,
  ): Promise<PolicySimulationReport> {
    const { agentId, walletId, transaction } = options;

    if (!agentId && !walletId) {
      throw new Error(
        'simulateTransaction requires an `agentId` or `walletId` to scope the policy check.',
      );
    }

    const params: PolicyListParams = { enabled: true };
    if (agentId) params.agentId = agentId;
    if (walletId) params.walletId = walletId;

    const { data: policies } = await this.list(params, requestOptions);

    return evaluatePolicyRules(policies, transaction);
  }
}

/** Alias of {@link PolicyResource} matching the `*sResource` client naming. */
export const PoliciesResource = PolicyResource;

export * from './simulator.js';
export * from './builder.js';

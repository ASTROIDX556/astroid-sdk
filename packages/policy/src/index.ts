import { Resource } from '@astroid/core';
import type {
  Paginated,
  Policy,
  PolicySimulationEvaluation,
  PolicySimulationInput,
  PolicySimulationRequest,
  PolicySimulationResult,
  PolicyType,
} from '@astroid/types';

import { simulatePolicy as evaluatePolicyRules } from './simulator.js';
import type { PolicySimulationReport, SimulatedTransaction } from './simulator.js';
import { simulatePolicy } from './simulate-policy.js';
import { simulatePolicyEvaluation } from './simulation.js';

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
    const res = await this.client.post<Policy>('/policies', input);
    return res.data;
  }

  /**
   * Retrieve a policy by ID.
   *
   * @param id The policy id.
   * @throws `NotFoundError` when no policy has that id.
   */
  async get(id: string): Promise<Policy> {
    return this.getData<Policy>(`/policies/${encodeURIComponent(id)}`);
  }

  /**
   * List policies with optional filtering.
   *
   * @param params Filters — `enabled`, `type`, `agentId`, `walletId`.
   * @returns       The matching policies plus pagination metadata.
   */
  async list(params: PolicyListParams = {}): Promise<Paginated<Policy>> {
    return this.listData<Policy>('/policies', { ...params });
  }

  /**
   * Update an existing policy.
   *
   * @param id    The policy id.
   * @param input The fields to change — a {@link PolicyUpdateInput}.
   * @throws      `NotFoundError` when no policy has that id.
   */
  async update(id: string, input: PolicyUpdateInput): Promise<Policy> {
    const res = await this.client.patch<Policy>(`/policies/${encodeURIComponent(id)}`, input);
    return res.data;
  }

  /**
   * Delete a policy.
   *
   * @param id The policy id.
   * @throws   `NotFoundError` when no policy has that id.
   */
  async delete(id: string): Promise<void> {
    await this.client.delete<void>(`/policies/${encodeURIComponent(id)}`);
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
  async createPolicy(input: PolicyCreateInput): Promise<Policy> {
    return this.create(input);
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
  async getPolicy(id: string): Promise<Policy> {
    return this.get(id);
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
  async listPolicies(params: PolicyListParams = {}): Promise<Paginated<Policy>> {
    return this.list(params);
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
  async updatePolicy(id: string, input: PolicyUpdateInput): Promise<Policy> {
    return this.update(id, input);
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
  async deletePolicy(id: string): Promise<void> {
    await this.delete(id);
  }
  /**
   * Simulate a proposed transaction against policy rules on the server,
   * **without committing it**.
   *
   * Two forms are supported:
   *
   * - **Organization-wide** — `simulatePolicy(request)` posts the transaction
   *   payload plus the rules to evaluate (`policyIds`, or `walletId` / `agentId`
   *   to cover every enabled policy in scope) to `/policies/simulate` and
   *   resolves with a {@link PolicySimulationResult}.
   * - **Per policy** — `simulatePolicy(policyId, input)` dry-runs the payload
   *   against one policy via `/policies/{id}/simulate` and resolves with a
   *   {@link PolicySimulationEvaluation} (decision, violated rules, risk score).
   *   Equivalent to {@link PolicyResource.simulatePolicyAgainst}.
   *
   * A blocked transaction is **not** an error — `allowed` is `false` and
   * `violations` / `violatedRules` lists the breaches. Only a transport/API
   * failure, or a response carrying no decision at all, rejects.
   *
   * @param input The transaction payload plus the policy rules to evaluate against.
   * @returns     The dry-run decision and its supporting detail.
   * @throws      `NetworkError` / typed API errors when the request itself fails.
   *
   * @example
   * ```ts
   * // Every policy in scope for a wallet:
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
   *
   * // Just one policy, before signing:
   * const evaluation = await astroid.policies.simulatePolicy('pol_1', {
   *   asset: 'USDC',
   *   amount: '250',
   *   recipientAddress: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW',
   * });
   * ```
   */
  async simulatePolicy(input: PolicySimulationRequest): Promise<PolicySimulationResult>;
  async simulatePolicy(
    policyId: string,
    input: PolicySimulationInput,
  ): Promise<PolicySimulationEvaluation>;
  async simulatePolicy(
    policyOrRequest: string | PolicySimulationRequest,
    input?: PolicySimulationInput,
  ): Promise<PolicySimulationResult | PolicySimulationEvaluation> {
    if (typeof policyOrRequest === 'string') {
      // A missing payload is a local `ValidationError` from
      // `validatePolicySimulationInput`, raised before any request is built.
      return this.simulatePolicyAgainst(policyOrRequest, input as PolicySimulationInput);
    }
    return simulatePolicy(this.client, policyOrRequest);
  }

  /**
   * Simulate a proposed transaction against a **single** policy, without
   * committing it.
   *
   * The transaction payload is validated locally (a blank asset, a non-positive
   * amount or a malformed field costs a local exception rather than a round
   * trip), POSTed verbatim to `/policies/{id}/simulate`, and the response is
   * parsed into a strict {@link PolicySimulationEvaluation}: the allow/deny
   * decision, every violated rule with its limit and actual value, the 0..1 risk
   * score and band, the required approvals and the budget impact.
   *
   * A denial is **not** an error: it resolves with `allowed: false` and the
   * breaches in `violatedRules`. Only a transport/API failure, or a response
   * carrying no decision at all, rejects — the check fails closed rather than
   * reporting an unparseable answer as an allow.
   *
   * @param policyId The policy to evaluate the transaction against.
   * @param input    The proposed transaction payload.
   * @returns        The decision, violated rules, risk score and budget impact.
   * @throws         `ValidationError` for a blank id or malformed payload (no
   *                 request is sent), `NetworkError` / typed API errors when the
   *                 request fails, and a `ValidationError` with code
   *                 `MALFORMED_RESPONSE` when the response carries no decision.
   *
   * @example
   * ```ts
   * const evaluation = await astroid.policies.simulatePolicyAgainst('pol_max_500', {
   *   asset: 'USDC',
   *   amount: '750',
   *   recipientAddress: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW',
   * });
   *
   * if (!evaluation.allowed) {
   *   for (const rule of evaluation.violatedRules) {
   *     console.warn(`${rule.rule}: ${rule.message}`); // MAX_AMOUNT: exceeds…
   *   }
   * }
   *
   * if (evaluation.riskScore > 0.8) requestHumanApproval();
   * ```
   */
  async simulatePolicyAgainst(
    policyId: string,
    input: PolicySimulationInput,
  ): Promise<PolicySimulationEvaluation> {
    return simulatePolicyEvaluation(this.client, policyId, input);
  }

  /**
   * Perform a pre-flight server-side policy simulation against every policy in
   * scope.
   *
   * @deprecated Use {@link PolicyResource.simulatePolicy} instead; behaviour is
   * identical. This alias only covers the request-object form — the per-policy
   * overload is available on {@link PolicyResource.simulatePolicy} and
   * {@link PolicyResource.simulatePolicyAgainst}.
   */
  async simulate(input: PolicySimulationRequest): Promise<PolicySimulationResult> {
    return this.simulatePolicy(input);
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
      throw new Error(
        'simulateTransaction requires an `agentId` or `walletId` to scope the policy check.',
      );
    }

    const params: PolicyListParams = { enabled: true };
    if (agentId) params.agentId = agentId;
    if (walletId) params.walletId = walletId;

    const { data: policies } = await this.list(params);

    return evaluatePolicyRules(policies, transaction);
  }
}

/** Alias of {@link PolicyResource} matching the `*sResource` client naming. */
export const PoliciesResource = PolicyResource;

export * from './simulator.js';
export * from './builder.js';

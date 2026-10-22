/**
 * Policy simulation and risk-assessment payloads.
 *
 * The canonical {@link Policy} entity lives in `./entities.ts` and the
 * {@link PolicyType} enum in `./enums.ts`; this module only adds the
 * simulation request/response shapes.
 */

import type { PolicyType } from './enums.js';

/* -------------------------------------------------------------------------- */
/* Policy conditions and decision reasons                                      */
/* -------------------------------------------------------------------------- */

/**
 * The condition families a {@link PolicyCondition} can express.
 *
 * These mirror the API's {@link PolicyType} values and add the local-evaluation
 * families (`ALLOWED_HOURS`, `REQUIRED_SIGNATURES`). Descriptive aliases such as
 * `MAX_AMOUNT_PER_TRANSACTION` and `ALLOWED_DESTINATION_ACCOUNTS` are accepted
 * as well so payloads written against the REST documentation type-check
 * verbatim alongside the canonical enum values.
 */
export type PolicyConditionType =
  | PolicyType
  | 'MAX_AMOUNT_PER_TRANSACTION'
  | 'MIN_AMOUNT_PER_TRANSACTION'
  | 'ALLOWED_DESTINATION_ACCOUNTS'
  | 'BLOCKED_DESTINATION_ACCOUNTS'
  | 'ALLOWED_HOURS'
  | 'REQUIRED_SIGNATURES';

/** Comparison operators accepted by numeric policy conditions. */
export type PolicyConditionOperator =
  | 'EQ'
  | 'NEQ'
  | 'GT'
  | 'GTE'
  | 'LT'
  | 'LTE'
  | 'IN'
  | 'NOT_IN'
  | 'BETWEEN';

/** An absolute date range during which a {@link PolicyCondition} applies. */
export interface PolicyConditionTimeWindow {
  /** Inclusive start, as an ISO-8601 date-time string. */
  start: string;
  /** Exclusive end, as an ISO-8601 date-time string. */
  end: string;
  /** IANA timezone used to interpret the window. Defaults to UTC. */
  timezone?: string;
}

/**
 * A single matcher inside a {@link PolicyRule}.
 *
 * A condition combines a `type` with the fields relevant to that family:
 *
 * - **Spend limits** — `maxAmount` / `minAmount` (per transaction),
 *   `dailyLimit` / `weeklyLimit` / `monthlyLimit` (rolling windows).
 * - **Destination accounts** — `allowedRecipients` / `blockedRecipients`
 *   (aliases: `allowedDestinationAccounts` / `blockedDestinationAccounts`).
 * - **Time windows** — `timeWindow` for an absolute range, or `allowedHours`
 *   for a recurring time-of-day window with an optional timezone.
 * - **Assets and signatures** — `allowedAssets` / `blockedAssets` and
 *   `requiredSignatures`.
 *
 * Fields are optional so the same shape can describe every condition family
 * and forward-compatible API extensions. Consumers should switch on `type`
 * before reading family-specific fields.
 *
 * @example
 * ```ts
 * const maxPerTransaction: PolicyCondition = {
 *   type: 'MAX_AMOUNT',
 *   maxAmount: '250.00',
 *   asset: 'USDC',
 * };
 *
 * const destinations: PolicyCondition = {
 *   type: 'ALLOWED_RECIPIENTS',
 *   allowedRecipients: ['GABC…', 'GDEF…'],
 * };
 * ```
 */
export interface PolicyCondition {
  /** The condition family this matcher belongs to. */
  type: PolicyConditionType;
  /** Stable identifier used to correlate violations back to the matcher. */
  id?: string;
  /** Human-readable description surfaced in simulation explanations. */
  description?: string;
  /** Comparison operator for numeric or set-based matchers. */
  operator?: PolicyConditionOperator;
  /** Maximum amount allowed per transaction (decimal string or number). */
  maxAmount?: number | string;
  /** Alias for {@link PolicyCondition.maxAmount}. */
  amount?: number | string;
  /** Minimum amount required per transaction (decimal string or number). */
  minAmount?: number | string;
  /** Asset identifier the limit applies to (`XLM`, `USDC`, `CODE:ISSUER`). */
  asset?: string;
  /** Asset identifiers the transaction may use. */
  allowedAssets?: string[];
  /** Asset identifiers the transaction may not use. */
  blockedAssets?: string[];
  /** Case-insensitive destination allowlist (Stellar or federated addresses). */
  allowedRecipients?: string[];
  /** Alias for {@link PolicyCondition.allowedRecipients}. */
  allowedDestinationAccounts?: string[];
  /** Case-insensitive destination denylist (Stellar or federated addresses). */
  blockedRecipients?: string[];
  /** Alias for {@link PolicyCondition.blockedRecipients}. */
  blockedDestinationAccounts?: string[];
  /** Absolute date range during which the action is permitted. */
  timeWindow?: PolicyConditionTimeWindow;
  /** Recurring time-of-day window during which the action is permitted. */
  allowedHours?: PolicyAllowedHours;
  /** Rolling daily spend cap (decimal string or number). */
  dailyLimit?: number | string;
  /** Rolling weekly spend cap (decimal string or number). */
  weeklyLimit?: number | string;
  /** Rolling monthly spend cap (decimal string or number). */
  monthlyLimit?: number | string;
  /** Minimum total signing weight required for the action. */
  requiredSignatures?: number;
  /** Arbitrary caller/API metadata attached to the condition. */
  metadata?: Record<string, unknown>;
}

/**
 * The machine-readable reason codes returned by a policy simulation.
 *
 * A decision is allowed (`ALLOWED`) or denied with one or more specific
 * reasons, so an autonomous agent can branch without parsing prose.
 */
export const POLICY_REASON_CODE_VALUES = [
  'ALLOWED',
  'POLICY_DISABLED',
  'EMERGENCY_LOCK',
  'MAX_AMOUNT_EXCEEDED',
  'MIN_AMOUNT_NOT_MET',
  'ASSET_NOT_ALLOWED',
  'ASSET_BLOCKED',
  'RECIPIENT_NOT_ALLOWED',
  'RECIPIENT_BLOCKED',
  'OUTSIDE_TIME_WINDOW',
  'DAILY_LIMIT_EXCEEDED',
  'WEEKLY_LIMIT_EXCEEDED',
  'MONTHLY_LIMIT_EXCEEDED',
  'BUDGET_EXCEEDED',
  'INSUFFICIENT_SIGNATURES',
  'APPROVAL_REQUIRED',
  'RISK_THRESHOLD_EXCEEDED',
  'VALIDATION_FAILED',
  'UNKNOWN',
] as const;

/** A machine-readable policy decision reason code. */
export type PolicyReasonCode = (typeof POLICY_REASON_CODE_VALUES)[number];

/** The headline outcome of a policy simulation. */
export type PolicySimulationDecision = 'ALLOWED' | 'DENIED';

/**
 * Non-throwing type guard for {@link PolicyReasonCode}.
 *
 * @param value The value to check.
 * @returns     `true` when `value` is a known reason code.
 */
export function isPolicyReasonCode(value: unknown): value is PolicyReasonCode {
  return (
    typeof value === 'string' && (POLICY_REASON_CODE_VALUES as readonly string[]).includes(value)
  );
}

/**
 * Whether a simulation result represents a denied transaction.
 *
 * Prefers the explicit `denied` flag when the API supplied one and otherwise
 * falls back to negating `allowed`, so the helper is safe for payloads produced
 * by older API versions.
 *
 * @param result A simulation result (or any `{ allowed, denied? }` payload).
 * @returns      `true` when the transaction was denied.
 */
export function isPolicySimulationDenied(
  result: Pick<PolicySimulationResult, 'allowed' | 'denied'>,
): boolean {
  return result.denied ?? !result.allowed;
}

/** A single policy rule breach reported by a client-side simulation. */
export interface PolicyViolation {
  policyId: string;
  policyName: string;
  policyType: PolicyType;
  message: string;
  /** Machine-readable reason for the breach. */
  reasonCode?: PolicyReasonCode;
  /** The configured limit that was breached, when applicable. */
  limit?: number | string;
  /** The actual value that breached the limit, when applicable. */
  actual?: number | string;
}

/**
 * A pre-flight policy simulation request.
 *
 * Combines the **transaction payload** to evaluate (`asset`, `amount`,
 * `recipientAddress`, …) with the **policy rules** it should be checked
 * against. When `policyIds` is omitted the server resolves every enabled policy
 * in scope for `walletId` / `agentId`; when it is supplied, only those rules are
 * evaluated. Nothing is committed — the endpoint is a pure dry-run.
 */
export interface PolicySimulationRequest {
  /** Wallet whose active policies apply. Mutually exclusive with `agentId`. */
  walletId?: string;
  /** Agent whose active policies apply. Mutually exclusive with `walletId`. */
  agentId?: string;
  /** Asset identifier: `XLM`, `USDC`, or `USDC:G...Issuer`. */
  asset: string;
  /** Amount to transfer (decimal string or number). */
  amount: string | number;
  /** Destination Stellar account, required by recipient rules. */
  recipientAddress?: string;
  /** Source Stellar account the spend is attributed to. */
  senderAddress?: string;
  /** Optional transaction memo. */
  memo?: string;
  /**
   * Amount already spent within the active budget window (day/week/month), used
   * by the rolling-limit rules. Decimal string or number.
   */
  spentInWindow?: string | number;
  /**
   * Restrict the evaluation to these policy rule ids. Defaults to every enabled
   * policy in scope for `walletId` / `agentId`.
   */
  policyIds?: string[];
  /** Arbitrary caller metadata, echoed back by the API. */
  metadata?: Record<string, unknown>;
}

export interface PolicyViolationDetail {
  policyId: string;
  policyType: PolicyType;
  message: string;
  /** Machine-readable reason for the breach (e.g. `MAX_AMOUNT_EXCEEDED`). */
  reasonCode?: PolicyReasonCode;
  limit?: number | string;
  actual?: number | string;
}

export interface PolicyRiskFactor {
  factor: string;
  score: number;
  description: string;
}

export interface PolicyRiskAssessment {
  score: number;
  band: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  factors: PolicyRiskFactor[];
}

export interface PolicyBudgetImpact {
  budgetId: string;
  beforeRemaining: string;
  afterRemaining: string;
}

/**
 * The outcome of a server-side policy simulation (`PolicyResource.simulatePolicy`).
 *
 * A blocked transaction is **not** an error: `allowed` is `false` and
 * `violations` explains exactly which rules were breached, so callers can
 * surface a precise message instead of catching an exception.
 */
export interface PolicySimulationResult {
  /** Whether the transaction complies with every evaluated rule. */
  allowed: boolean;
  /**
   * Whether the transaction was denied.
   *
   * The API always reports a decision; this is optional on the TypeScript
   * interface so payloads from older API versions remain assignable. Use
   * {@link isPolicySimulationDenied} when you need a guaranteed boolean.
   */
  denied?: boolean;
  /** The headline decision in enum form (`ALLOWED` or `DENIED`). */
  decision?: PolicySimulationDecision;
  /**
   * The primary machine-readable reason for the decision.
   *
   * `ALLOWED` for an allow; the first blocking violation's reason code for a
   * denial. Detailed codes are also available on each violation.
   */
  reasonCode?: PolicyReasonCode;
  /** The rule breaches that blocked the transaction (empty when `allowed`). */
  violations: PolicyViolationDetail[];
  /** Roles whose approval is required before the transaction may proceed. */
  requiredApprovals: string[];
  /** A 0..1 risk score and its contributing factors. */
  risk: PolicyRiskAssessment;
  /** How the transaction would move each affected budget. */
  budgetImpact: PolicyBudgetImpact[];
  /** Human-readable summary of the decision. */
  explanation: string;
}

export interface SimulatePolicyRequest {
  walletId?: string;
  asset: string;
  amount: string | number;
  recipientAddress?: string;
  spentInWindow?: string;
}

export interface PolicyRuleSimulationRequest {
  rule: PolicyRule;
  transaction: TransactionDetails;
}

export interface PolicyRuleSimulationResult {
  allowed: boolean;
  denied: boolean;
  triggeredRuleIds: string[];
}

/* -------------------------------------------------------------------------- */
/* Policy rule evaluation (issue #401)                                         */
/* -------------------------------------------------------------------------- */

/**
 * A request to evaluate a **single policy rule** against a proposed
 * transaction (issue #401).
 *
 * This is the pre-flight check an autonomous agent runs before it signs: "if
 * this rule were in force, would this action be allowed?". The rule and the
 * transaction payload are both sent verbatim — amounts stay decimal strings so
 * no precision is lost on the way to the policy engine.
 *
 * @example
 * ```ts
 * const request: PolicyEvaluationRequest = {
 *   rule: {
 *     name: 'treasury-only',
 *     allowedRecipients: ['GABC…'],
 *     requiredSignatures: 2,
 *   },
 *   transaction: {
 *     asset: 'USDC',
 *     amount: '250.00',
 *     recipientAddress: 'GABC…',
 *   },
 * };
 * ```
 */
export interface PolicyEvaluationRequest {
  /** The policy rule to evaluate. */
  rule: PolicyRule;
  /** The proposed transaction the rule is evaluated against. */
  transaction: TransactionDetails;
  /** The policy the rule belongs to, when the caller knows it. */
  policyId?: string;
  /** Arbitrary caller metadata, echoed back by the API. */
  metadata?: Record<string, unknown>;
}

/**
 * The outcome of evaluating a policy rule against a transaction (issue #401).
 *
 * A violation is **not** an error: the evaluation resolves normally with
 * `allowed: false` and the failed checks listed in `violatedRules`, so an agent
 * can branch on a machine-readable reason instead of catching an exception.
 */
export interface PolicyEvaluationOutcome {
  /** The policy the evaluation was scoped to, when the API reported one. */
  policyId?: string;
  /** Whether the transaction satisfies the evaluated rule. */
  allowed: boolean;
  /** Alias of {@link PolicyEvaluationOutcome.allowed} (deny/allow wording). */
  denied: boolean;
  /** The names of the rules the transaction triggered. */
  triggeredRuleIds: string[];
  /** The individual checks that failed, each with a human-readable reason. */
  violatedRules: PolicyRuleEvaluation[];
  /** The 0..1 risk score reported by the API; `0` when none was reported. */
  riskScore: number;
  /** Human-readable summary of the evaluation. */
  explanation: string;
}

/* -------------------------------------------------------------------------- */
/* Policy update simulation (issue #249)                                       */
/* -------------------------------------------------------------------------- */

/**
 * A dry-run validation of a proposed policy rule change (issue #249).
 *
 * The proposed rule is replayed against historical transaction payloads so a
 * policy update can be tested before it is persisted — without risking
 * unintended transaction rejections on the Stellar network. Sent to the
 * `POST /policies/simulate-update` endpoint.
 */
export interface PolicyUpdateSimulationRequest {
  /** The policy whose update is being validated. */
  policyId: string;
  /** The proposed replacement rule to validate before persisting. */
  proposedRule: PolicyRule;
  /**
   * Historical transaction payloads to replay against the proposed rule.
   * At least one transaction is required — simulating against an empty
   * history proves nothing.
   */
  transactions: TransactionDetails[];
  /** Optional scope narrowing: agent whose context the rule applies to. */
  agentId?: string;
  /** Optional scope narrowing: wallet whose context the rule applies to. */
  walletId?: string;
  /** Arbitrary caller metadata, echoed back by the API. */
  metadata?: Record<string, unknown>;
}

/** The replay of one historical transaction against the proposed rule. */
export interface PolicyUpdateSimulationOutcome {
  /** Zero-based index of the historical transaction in the request. */
  transactionIndex: number;
  /** Whether the proposed rule permits this historical transaction. */
  allowed: boolean;
  /** Names of the proposed rules this transaction complies with. */
  passedRules: string[];
  /** The checks this transaction failed under the proposed rule. */
  violatedConstraints: PolicyRuleEvaluation[];
}

/** The estimated effect of persisting the proposed policy change. */
export interface PolicyUpdateSimulationImpact {
  /** Number of historical transactions evaluated. */
  evaluatedTransactionCount: number;
  /** Number of historical transactions the proposed rule would reject. */
  blockedTransactionCount: number;
  /** Fraction of evaluated transactions blocked, between `0` and `1`. */
  blockedRatio: number;
}

/**
 * The outcome of a policy update simulation (`PolicyResource.simulatePolicyUpdate`).
 *
 * An invalid proposed rule is **not** an error: `valid` is `false` and
 * `violatedConstraints` / `estimatedImpact` explain exactly which historical
 * transactions the change would have rejected, so callers can surface a
 * precise message instead of catching an exception.
 */
export interface PolicyUpdateSimulationResult {
  /** Whether the proposed change is safe: no historical transaction would be blocked. */
  valid: boolean;
  /** Alias of {@link PolicyUpdateSimulationResult.valid} using pass/fail terminology. */
  passed: boolean;
  /** One outcome per replayed historical transaction, in request order. */
  outcomes: PolicyUpdateSimulationOutcome[];
  /** Names of the proposed rules that passed against every historical transaction. */
  passedRules: string[];
  /** Every failed check across the replay, in first-failure order. */
  violatedConstraints: PolicyRuleEvaluation[];
  /** Aggregate effect of persisting the change. */
  estimatedImpact: PolicyUpdateSimulationImpact;
  /** Human-readable summary of the simulation. */
  explanation: string;
}

/* -------------------------------------------------------------------------- */
/* Single-policy simulation (POST /policies/{id}/simulate)                     */
/* -------------------------------------------------------------------------- */

/**
 * The transaction payload evaluated against one specific policy.
 *
 * Unlike {@link PolicySimulationRequest}, which scopes the evaluation to an
 * organization (`walletId` / `agentId`) and optionally a set of rules, this
 * request targets a single policy by id — the policy itself supplies the rules
 * and the scope. Amounts are decimal strings (or numbers) and are never
 * re-parsed client-side, so precision is preserved end to end.
 */
export interface PolicySimulationInput {
  /** Asset identifier: `XLM`, `USDC`, or `USDC:G…Issuer`. */
  asset: string;
  /** Amount to transfer. Must be a positive finite number or decimal string. */
  amount: string | number;
  /** Destination account, required by recipient rules. */
  recipientAddress?: string;
  /** Source account the spend is attributed to. */
  senderAddress?: string;
  /** Optional transaction memo. */
  memo?: string;
  /**
   * Amount already spent within the active budget window (day/week/month), used
   * by the rolling-limit rules. Decimal string or number; `0` is valid.
   */
  spentInWindow?: string | number;
  /** Arbitrary caller metadata, echoed back by the API. */
  metadata?: Record<string, unknown>;
}

/**
 * A single rule breached by a policy simulation.
 *
 * A breach is reported, never thrown: an agent can read `rule` to branch on a
 * machine-readable reason and `message` to surface a human-readable one.
 */
export interface PolicyRuleBreach {
  /** The policy the breach belongs to; defaults to the simulated policy id. */
  policyId: string;
  /** The policy's display name, when the API reported it. */
  policyName?: string;
  /** The policy rule type, when the API reported a known type. */
  policyType?: PolicyType;
  /**
   * Machine-readable reason for the breach (a rule name or code, e.g.
   * `MAX_AMOUNT`). Falls back to the policy type, then `POLICY_RULE`.
   */
  rule: string;
  /** Machine-readable reason code, when the API reported one. */
  reasonCode?: PolicyReasonCode;
  /** Human-readable explanation of the breach. */
  message: string;
  /** The configured limit that was breached, when applicable. */
  limit?: number | string;
  /** The actual value that breached the limit, when applicable. */
  actual?: number | string;
}

/**
 * The detailed outcome of simulating a transaction against a single policy
 * (`PolicyResource.simulatePolicy(policyId, input)`).
 *
 * The decision is fail-closed: a denial resolves normally with
 * `allowed: false` and the breaches listed in `violatedRules`, while a response
 * that carries no decision at all is rejected as malformed rather than being
 * reported as an allow.
 */
export interface PolicySimulationEvaluation {
  /** The policy that was simulated. */
  policyId: string;
  /** Whether the transaction complies with the policy. */
  allowed: boolean;
  /** Alias of {@link PolicySimulationEvaluation.allowed} (pass/fail wording). */
  passed: boolean;
  /** The breached rules, in the order the API reported them. */
  violatedRules: PolicyRuleBreach[];
  /**
   * The 0..1 risk score reported by the API, clamped to the `0`–`1` range.
   * `0` when the API reported no risk assessment.
   */
  riskScore: number;
  /** The full risk assessment: score, band and contributing factors. */
  risk: PolicyRiskAssessment;
  /** Roles whose approval is required before the transaction may proceed. */
  requiredApprovals: string[];
  /** How the transaction would move each affected budget. */
  budgetImpact: PolicyBudgetImpact[];
  /** Human-readable summary of the decision. */
  explanation: string;
}

/* -------------------------------------------------------------------------- */
/* Local evaluation engine                                                     */
/* -------------------------------------------------------------------------- */

/**
 * A time-of-day window during which a policy rule permits an action.
 *
 * Unlike a policy's absolute `timeWindow`, this restricts the *hour of the
 * day* and is evaluated locally by `evaluatePolicy` in `@astroid/policy`.
 */
export interface PolicyAllowedHours {
  /** Inclusive start hour in 24-hour time (`0`–`23`). */
  startHour: number;
  /**
   * Exclusive end hour (`0`–`23`). A value less than or equal to `startHour`
   * describes a window that wraps past midnight (e.g. `22` → `6` permits
   * 22:00–23:59 and 00:00–05:59).
   */
  endHour: number;
  /**
   * IANA timezone used to resolve the hour (e.g. `"America/New_York"`).
   * Defaults to UTC; an unrecognised zone falls back to UTC rather than
   * throwing.
   */
  timezone?: string;
  /** Allowed weekdays (`0` = Sunday … `6` = Saturday). Omit to allow every day. */
  days?: number[];
}

/**
 * A signature already attached to a proposed transaction.
 *
 * `weight` mirrors Stellar account signing weights: it defaults to `1` so a
 * plain list of signers can be supplied without weights.
 */
export interface TransactionSignature {
  /** Signer identifier: a Stellar account (`G…`) or a federated address (`name*domain`). */
  signer: string;
  /** Signing weight contributed (defaults to `1`). */
  weight?: number;
}

/**
 * The transaction payload a {@link PolicySet} is evaluated against.
 *
 * Every field is optional except the asset/amount, so callers can evaluate the
 * constraints that are relevant to them without fabricating data.
 */
export interface TransactionDetails {
  /** Asset identifier: `XLM`, `USDC`, or `USDC:G…Issuer`. */
  asset: string;
  /** Transfer amount (decimal string or number). */
  amount: number | string;
  /** Destination account the action is addressed to. */
  recipientAddress?: string;
  /** Source account the action is attributed to. */
  senderAddress?: string;
  /**
   * When the action occurs, as an ISO-8601 string or `Date`. Defaults to the
   * evaluation clock (`options.now`, else the current time).
   */
  timestamp?: string | Date;
  /** Signatures already collected on the payload. */
  signatures?: TransactionSignature[];
  /**
   * Explicit total signing weight already collected. When present it takes
   * precedence over summing {@link TransactionDetails.signatures}.
   */
  signedWeight?: number;
}

/** The constraint families a {@link PolicyRule} can combine. */
export type PolicyRuleCheck = 'address' | 'time' | 'signatures' | 'none';

/**
 * A single locally-evaluated policy rule.
 *
 * A rule may combine any of the supported constraints; each configured
 * constraint is checked independently and reported separately.
 */
export interface PolicyRule {
  /** Stable rule name reported in the evaluation results. */
  name: string;
  /** Optional caller-owned identifier for the rule. */
  id?: string;
  /** Human-readable description of what the rule enforces. */
  description?: string;
  /** Whether the rule runs. Defaults to `true`; disabled rules are skipped. */
  enabled?: boolean;
  /** Evaluation priority (lower values run first), when scoped to a policy. */
  priority?: number;
  /** The policy family this rule belongs to, when known. */
  type?: PolicyType;
  /**
   * Structured condition matchers evaluated by the rule.
   *
   * Conditions are additive with the shorthand constraints below, so a rule can
   * mix API-style matchers (`maxAmount`, destination allowlists, time windows)
   * with the local-evaluation shorthand (`allowedRecipients`, `allowedHours`,
   * `requiredSignatures`).
   */
  conditions?: PolicyCondition[];
  /** Case-insensitive destination allowlist (Stellar or federated addresses). */
  allowedRecipients?: string[];
  /** Case-insensitive destination denylist (Stellar or federated addresses). */
  blockedRecipients?: string[];
  /** Time-of-day window during which the action is permitted. */
  allowedHours?: PolicyAllowedHours;
  /** Minimum total signing weight required for the action. */
  requiredSignatures?: number;
}

/** A named collection of rules evaluated in declaration order. */
export interface PolicySet {
  /** Optional human-readable label for the set. */
  name?: string;
  /** Rules to evaluate; every enabled rule is reported. */
  rules: PolicyRule[];
}

/** The outcome of one rule check. */
export interface PolicyRuleEvaluation {
  /** Rule name this result belongs to. */
  rule: string;
  /** Constraint family that produced this result. */
  check: PolicyRuleCheck;
  /** Whether the check passed. */
  success: boolean;
  /** Human-readable failure explanation; absent when `success` is `true`. */
  explanation?: string;
}

/**
 * The detailed report returned by `evaluatePolicy`.
 *
 * `allowed` is the headline decision; `results` explains it, holding one entry
 * per evaluated check so callers can surface exactly which rule failed and
 * why. A failed evaluation is not an error — the function never throws for a
 * policy breach.
 */
export interface PolicyEvaluationResult {
  /** Whether every evaluated rule passed. */
  allowed: boolean;
  /** Alias of {@link PolicyEvaluationResult.allowed} using pass/fail terminology. */
  passed: boolean;
  /** One entry per evaluated check, in rule declaration order. */
  results: PolicyRuleEvaluation[];
  /** Number of checks evaluated. */
  evaluatedRules: number;
  /** Number of checks that failed. */
  failedRules: number;
  /** Names of the rules that failed, de-duplicated and in first-failure order. */
  failedRuleNames: string[];
}

/**
 * Policy simulation and risk-assessment payloads.
 *
 * The canonical {@link Policy} entity lives in `./entities.ts` and the
 * {@link PolicyType} enum in `./enums.ts`; this module only adds the
 * simulation request/response shapes.
 */

import type { PolicyType } from './enums.js';

/** A single policy rule breach reported by a client-side simulation. */
export interface PolicyViolation {
  policyId: string;
  policyName: string;
  policyType: PolicyType;
  message: string;
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
  /** Whether the rule runs. Defaults to `true`; disabled rules are skipped. */
  enabled?: boolean;
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

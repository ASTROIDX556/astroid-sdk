/**
 * `@astroid/policy` — client-side policy simulation engine.
 *
 * Evaluates a hypothetical transaction against a set of policy rules
 * **synchronously** and locally, without network requests. The engine checks:
 *
 * - **Threshold rules** — max/min amount ceilings
 * - **Destination restrictions** — whitelist and blacklist Stellar addresses
 * - **Asset constraints** — allowed and blocked asset identifiers
 *
 * Every rule produces a structured `Violation` when the transaction fails the
 * check, and the aggregate result reports `allowed` as the bottom line.
 *
 * @module
 */

import type { PolicyType } from '@astroid/types';

/* -------------------------------------------------------------------------- */
/* Transaction model (local, not persisted)                                    */
/* -------------------------------------------------------------------------- */

/**
 * A minimal transaction representation used for local policy evaluation.
 * This is intentionally narrower than the full `Transaction` entity — it only
 * carries the fields policies actually inspect.
 */
export interface SimulatedTransaction {
  /** The asset code or identifier (e.g. `USDC`, `native`). */
  asset: string;
  /** The numeric amount to transfer. */
  amount: number;
  /** The destination Stellar address (G…). */
  recipientAddress?: string;
  /** The source Stellar address (G…). Optional — not checked by most rules. */
  senderAddress?: string;
}

/* -------------------------------------------------------------------------- */
/* Policy rule                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * A single policy rule to evaluate against a transaction.
 *
 * At minimum, each rule must declare its `type` and carry the relevant
 * configuration for that type.
 */
export interface PolicyRule {
  /** Unique identifier for this policy. */
  id: string;
  /** Human-readable name (used in violation messages). */
  name: string;
  /** The policy category. */
  type: PolicyType;
  /** Whether this rule is active. Inactive rules are skipped. */
  enabled?: boolean;
  /** Priority (higher = evaluated first). Default 0. */
  priority?: number;
  /** Configuration parameters — typed fields plus arbitrary extensions. */
  configuration: PolicyConfiguration;
}

/**
 * Configuration parameters for a policy rule. Mirrors `PolicyConfiguration`
 * from `@astroid/types` but scoped to what the local simulator needs.
 */
export interface PolicyConfiguration {
  /** Maximum allowed transfer amount (MAX_AMOUNT). */
  maxAmount?: number;
  /** Minimum required transfer amount (MIN_AMOUNT). */
  minAmount?: number;
  /** The asset code this rule applies to. If set, rule only fires when the transaction asset matches. */
  asset?: string;
  /** Assets that are permitted. Transaction asset must be in this list. */
  allowedAssets?: string[];
  /** Assets that are forbidden. Transaction asset must NOT be in this list. */
  blockedAssets?: string[];
  /** Allowed recipient addresses (whitelist). If non-empty, recipient must be in this list. */
  allowedRecipients?: string[];
  /** Blocked recipient addresses (blacklist). Recipient must NOT be in this list. */
  blockedRecipients?: string[];
  /** Whether this rule requires human approval when triggered. */
  requiresApproval?: boolean;
  [key: string]: unknown;
}

/* -------------------------------------------------------------------------- */
/* Violation                                                                   */
/* -------------------------------------------------------------------------- */

/** A single violation produced when a policy rule fails. */
export interface Violation {
  /** The policy rule that was violated. */
  policyId: string;
  /** Human-readable policy name. */
  policyName: string;
  /** The policy category that triggered the violation. */
  policyType: string;
  /** A human-readable message explaining why the check failed. */
  message: string;
  /** The limit/threshold that was breached, when applicable. */
  limit?: number;
  /** The actual value that breached it, when applicable. */
  actual?: number;
  /** Whether this violation requires approval to override. */
  requiresApproval: boolean;
}

/* -------------------------------------------------------------------------- */
/* Simulation result                                                           */
/* -------------------------------------------------------------------------- */

/** The complete result of evaluating a transaction against policy rules. */
export interface SimulationResult {
  /** Whether the transaction is allowed (no violations, or only approval-gated ones). */
  allowed: boolean;
  /** All violations produced by the rules. */
  violations: Violation[];
  /** Number of rules evaluated. */
  rulesEvaluated: number;
  /** Human-readable summary. */
  explanation: string;
}

/* -------------------------------------------------------------------------- */
/* Checker functions (one per policy category)                                  */
/* -------------------------------------------------------------------------- */

type Checker = (
  rule: PolicyRule,
  tx: SimulatedTransaction,
) => Violation | null;

/**
 * Check MAX_AMOUNT: transaction amount must be ≤ the configured ceiling.
 */
const checkMaxAmount: Checker = (rule, tx) => {
  const max = rule.configuration.maxAmount;
  if (max === undefined) return null;
  if (tx.amount > max) {
    return {
      policyId: rule.id,
      policyName: rule.name,
      policyType: rule.type,
      message: `Amount ${tx.amount} exceeds maximum of ${max}`,
      limit: max,
      actual: tx.amount,
      requiresApproval: rule.configuration.requiresApproval ?? false,
    };
  }
  return null;
};

/**
 * Check MIN_AMOUNT: transaction amount must be ≥ the configured floor.
 */
const checkMinAmount: Checker = (rule, tx) => {
  const min = rule.configuration.minAmount;
  if (min === undefined) return null;
  if (tx.amount < min) {
    return {
      policyId: rule.id,
      policyName: rule.name,
      policyType: rule.type,
      message: `Amount ${tx.amount} is below minimum of ${min}`,
      limit: min,
      actual: tx.amount,
      requiresApproval: rule.configuration.requiresApproval ?? false,
    };
  }
  return null;
};

/**
 * Check ALLOWED_ASSETS: transaction asset must be in the allowlist.
 */
const checkAllowedAssets: Checker = (rule, tx) => {
  const allowed = rule.configuration.allowedAssets;
  if (!allowed || allowed.length === 0) return null;
  if (!allowed.includes(tx.asset)) {
    return {
      policyId: rule.id,
      policyName: rule.name,
      policyType: rule.type,
      message: `Asset "${tx.asset}" is not in the allowed list [${allowed.join(', ')}]`,
      requiresApproval: rule.configuration.requiresApproval ?? false,
    };
  }
  return null;
};

/**
 * Check BLOCKED_ASSETS: transaction asset must NOT be in the blocklist.
 */
const checkBlockedAssets: Checker = (rule, tx) => {
  const blocked = rule.configuration.blockedAssets;
  if (!blocked || blocked.length === 0) return null;
  if (blocked.includes(tx.asset)) {
    return {
      policyId: rule.id,
      policyName: rule.name,
      policyType: rule.type,
      message: `Asset "${tx.asset}" is blocked [${blocked.join(', ')}]`,
      requiresApproval: rule.configuration.requiresApproval ?? false,
    };
  }
  return null;
};

/**
 * Check ALLOWED_RECIPIENTS: destination must be in the whitelist.
 */
const checkAllowedRecipients: Checker = (rule, tx) => {
  const allowed = rule.configuration.allowedRecipients;
  if (!allowed || allowed.length === 0) return null;
  if (!tx.recipientAddress) {
    return {
      policyId: rule.id,
      policyName: rule.name,
      policyType: rule.type,
      message: `Recipient address is required but not provided`,
      requiresApproval: rule.configuration.requiresApproval ?? false,
    };
  }
  if (!allowed.includes(tx.recipientAddress)) {
    return {
      policyId: rule.id,
      policyName: rule.name,
      policyType: rule.type,
      message: `Recipient "${tx.recipientAddress}" is not in the allowed whitelist`,
      requiresApproval: rule.configuration.requiresApproval ?? false,
    };
  }
  return null;
};

/**
 * Check BLOCKED_RECIPIENTS: destination must NOT be in the blacklist.
 */
const checkBlockedRecipients: Checker = (rule, tx) => {
  const blocked = rule.configuration.blockedRecipients;
  if (!blocked || blocked.length === 0) return null;
  if (tx.recipientAddress && blocked.includes(tx.recipientAddress)) {
    return {
      policyId: rule.id,
      policyName: rule.name,
      policyType: rule.type,
      message: `Recipient "${tx.recipientAddress}" is blocked`,
      requiresApproval: rule.configuration.requiresApproval ?? false,
    };
  }
  return null;
};

/* -------------------------------------------------------------------------- */
/* Checker dispatch table                                                      */
/* -------------------------------------------------------------------------- */

const CHECKERS: Partial<Record<PolicyType, Checker>> = {
  MAX_AMOUNT: checkMaxAmount,
  MIN_AMOUNT: checkMinAmount,
  ALLOWED_ASSETS: checkAllowedAssets,
  BLOCKED_ASSETS: checkBlockedAssets,
  ALLOWED_RECIPIENTS: checkAllowedRecipients,
  BLOCKED_RECIPIENTS: checkBlockedRecipients,
};

/* -------------------------------------------------------------------------- */
/* Public API                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Simulate a transaction against a list of policy rules.
 *
 * All evaluation is synchronous and local — no network requests are made.
 * Rules are sorted by priority (highest first) before evaluation.
 *
 * @param rules        The policy rules to evaluate.
 * @param transaction  The hypothetical transaction.
 * @returns A {@link SimulationResult} with all violations and an `allowed` flag.
 *
 * @example
 * ```ts
 * const result = simulatePolicies(
 *   [
 *     { id: 'p1', name: 'Max Transfer', type: 'MAX_AMOUNT', configuration: { maxAmount: 1000 } },
 *     { id: 'p2', name: 'USDC Only', type: 'ALLOWED_ASSETS', configuration: { allowedAssets: ['USDC'] } },
 *   ],
 *   { asset: 'USDC', amount: 500, recipientAddress: 'GABC...' },
 * );
 * // result.allowed === true
 * ```
 */
export function simulatePolicies(
  rules: PolicyRule[],
  transaction: SimulatedTransaction,
): SimulationResult {
  const violations: Violation[] = [];
  let rulesEvaluated = 0;

  // Sort by priority descending (higher = first)
  const sorted = [...rules].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

  for (const rule of sorted) {
    // Skip disabled rules
    if (rule.enabled === false) continue;

    // If the rule targets a specific asset and the transaction doesn't match, skip
    if (rule.configuration.asset && rule.configuration.asset !== transaction.asset) continue;

    const checker = CHECKERS[rule.type];
    if (!checker) continue; // Unknown policy type — skip gracefully

    rulesEvaluated++;
    const violation = checker(rule, transaction);
    if (violation) {
      violations.push(violation);
    }
  }

  // A transaction is "allowed" only if there are zero violations,
  // or every violation is approval-gated (requiresApproval).
  const hasBlockingViolation = violations.some((v) => !v.requiresApproval);
  const allowed = !hasBlockingViolation;

  const explanation = buildExplanation(allowed, violations, rulesEvaluated);

  return {
    allowed,
    violations,
    rulesEvaluated,
    explanation,
  };
}

/* -------------------------------------------------------------------------- */
/* Explanation builder                                                         */
/* -------------------------------------------------------------------------- */

function buildExplanation(
  allowed: boolean,
  violations: Violation[],
  rulesEvaluated: number,
): string {
  if (violations.length === 0) {
    return `Transaction passes all ${rulesEvaluated} policy checks.`;
  }

  const blocking = violations.filter((v) => !v.requiresApproval);
  const approvalRequired = violations.filter((v) => v.requiresApproval);

  const parts: string[] = [];

  if (blocking.length > 0) {
    parts.push(
      `Blocked by ${blocking.length} policy violation(s): ${blocking.map((v) => v.message).join('; ')}.`,
    );
  }

  if (approvalRequired.length > 0) {
    parts.push(
      `Requires approval for ${approvalRequired.length} policy rule(s): ${approvalRequired.map((v) => v.message).join('; ')}.`,
    );
  }

  if (allowed) {
    parts.push('Transaction can proceed with required approvals.');
  }

  return parts.join(' ');
}

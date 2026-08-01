/**
 * Result types for `policy.simulate` — the pre-flight evaluation that returns
 * violations, required approvals, estimated risk and budget impact without
 * creating a transaction (PRD Doc 8 & Doc 6 "AI Simulation Mode").
 */

import type { RiskBand } from './enums.js';
import type { DecimalString } from './entities.js';

/** A single policy that a simulated transaction would violate. */
export interface PolicyViolation {
  policyId: string;
  policyName: string;
  policyType: string;
  message: string;
  /** The limit that was breached, when applicable. */
  limit?: number;
  /** The value that breached it, when applicable. */
  actual?: number;
}

/** An approval that a simulated transaction would require before execution. */
export interface RequiredApproval {
  policyId?: string;
  approvalType: string;
  requiredApprovals: number;
  reason: string;
}

/** The risk assessment for a simulated transaction. */
export interface RiskAssessment {
  score: number;
  band: RiskBand;
  factors: string[];
}

/** How a simulated transaction would affect a budget. */
export interface BudgetImpact {
  budgetId: string;
  budgetName: string;
  currency: string;
  limit: DecimalString;
  spent: DecimalString;
  remainingBefore: DecimalString;
  remainingAfter: DecimalString;
  wouldExceed: boolean;
}

/**
 * The full result of a policy simulation. `allowed` is the bottom line: whether
 * the transaction could proceed (possibly after the listed approvals).
 */
export interface PolicySimulationResult {
  allowed: boolean;
  violations: PolicyViolation[];
  requiredApprovals: RequiredApproval[];
  risk: RiskAssessment;
  budgetImpact: BudgetImpact[];
  /** Human-readable explanation, useful for policy-aware AI reasoning. */
  explanation: string;
}

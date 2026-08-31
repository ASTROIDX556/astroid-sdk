/**
 * Policy simulation and risk-assessment payloads.
 *
 * The canonical {@link Policy} entity lives in `./entities.ts` and the
 * {@link PolicyType} enum in `./enums.ts`; this module only adds the
 * simulation request/response shapes.
 */

import type { PolicyType } from './enums.js';

export interface PolicySimulationRequest {
  walletId?: string;
  agentId?: string;
  asset: string;
  amount: string | number;
  recipientAddress?: string;
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

export interface PolicySimulationResult {
  allowed: boolean;
  violations: PolicyViolationDetail[];
  requiredApprovals: string[];
  risk: PolicyRiskAssessment;
  budgetImpact: PolicyBudgetImpact[];
  explanation: string;
}

export interface SimulatePolicyRequest {
  walletId?: string;
  asset: string;
  amount: string | number;
  recipientAddress?: string;
  spentInWindow?: string;
}

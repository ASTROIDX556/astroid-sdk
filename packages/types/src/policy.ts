export type PolicyType = 
  | 'MAX_AMOUNT'
  | 'DAILY_BUDGET'
  | 'WEEKLY_BUDGET'
  | 'MONTHLY_BUDGET'
  | 'BLOCKED_RECIPIENTS'
  | 'ALLOWED_RECIPIENTS'
  | 'BLOCKED_ASSETS'
  | 'ALLOWED_ASSETS';

export interface Policy {
  id: string;
  organizationId: string;
  name: string;
  type: PolicyType;
  configuration: Record<string, unknown>;
  priority: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

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

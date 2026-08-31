export type PolicyType =
  | 'MAX_AMOUNT'
  | 'DAILY_BUDGET'
  | 'WEEKLY_BUDGET'
  | 'MONTHLY_BUDGET'
  | 'BLOCKED_RECIPIENTS'
  | 'ALLOWED_RECIPIENTS'
  | 'BLOCKED_ASSETS'
  | 'ALLOWED_ASSETS';

export interface PolicyConfiguration {
  maxAmount?: number;
  dailyLimit?: number;
  weeklyLimit?: number;
  monthlyLimit?: number;
  blockedRecipients?: string[];
  allowedRecipients?: string[];
  blockedAssets?: string[];
  allowedAssets?: string[];
  [key: string]: unknown;
}

export interface Policy {
  id: string;
  organizationId: string;
  name: string;
  type: PolicyType;
  configuration: PolicyConfiguration;
  priority: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PolicyRisk {
  score: number;
  band: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  factors: string[];
}

export interface PolicyViolation {
  policyId: string;
  policyType: PolicyType;
  message: string;
  limit?: number;
  actual?: number;
}

export interface PolicySimulationResult {
  allowed: boolean;
  violations: PolicyViolation[];
  requiredApprovals: string[];
  risk: PolicyRisk;
  budgetImpact: Array<{ budgetId: string; delta: string; remainingAfter: string }>;
  explanation: string;
}

export interface SimulatePolicyRequest {
  walletId?: string;
  asset: string;
  amount: string | number;
  recipientAddress?: string;
  spentInWindow?: string;
}

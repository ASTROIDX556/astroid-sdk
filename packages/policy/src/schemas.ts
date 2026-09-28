import { z } from 'zod';
import type {
  PolicyCreateInput,
  PolicyUpdateInput,
} from './index.js';
import type {
  PolicySimulationRequest,
  SimulatePolicyRequest,
  PolicyAllowedHours,
  TransactionSignature,
  TransactionDetails,
  PolicyRule,
  PolicySet,
  PolicyViolationDetail,
  PolicyViolation,
  PolicyRiskFactor,
  PolicyRiskAssessment,
  PolicyBudgetImpact,
  PolicySimulationResult,
  PolicyRuleCheck,
  PolicyRuleEvaluation,
  PolicyEvaluationResult,
} from '@astroid/types';

// Enums
const PolicyTypeSchema = z.enum([
  'MAX_AMOUNT',
  'MIN_AMOUNT',
  'ALLOWED_ASSETS',
  'BLOCKED_ASSETS',
  'DAILY_BUDGET',
  'WEEKLY_BUDGET',
  'MONTHLY_BUDGET',
  'ALLOWED_RECIPIENTS',
  'BLOCKED_RECIPIENTS',
  'TIME_WINDOW',
  'DEPARTMENT_RULE',
  'AGENT_RULE',
  'EMERGENCY_LOCK',
  'COMPOSITE',
]);

export const PolicyAllowedHoursSchema: z.ZodType<PolicyAllowedHours> = z.object({
  startHour: z.number().int().min(0).max(23),
  endHour: z.number().int().min(0).max(23),
  timezone: z.string().optional(),
  days: z.array(z.number().int().min(0).max(6)).optional(),
});

export const PolicyConfigurationSchema = z
  .object({
    maxAmount: z.number().optional(),
    minAmount: z.number().optional(),
    asset: z.string().optional(),
    allowedAssets: z.array(z.string()).optional(),
    blockedAssets: z.array(z.string()).optional(),
    allowedRecipients: z.array(z.string()).optional(),
    blockedRecipients: z.array(z.string()).optional(),
    requiresApproval: z.boolean().optional(),
    dailyLimit: z.number().optional(),
    weeklyLimit: z.number().optional(),
    monthlyLimit: z.number().optional(),
    timeWindow: z
      .object({
        start: z.string(),
        end: z.string(),
        timezone: z.string().optional(),
      })
      .optional(),
    allowedHours: PolicyAllowedHoursSchema.optional(),
    requiredSignatures: z.number().positive().optional(),
  })
  .passthrough();

export const PolicyCreateInputSchema: z.ZodType<PolicyCreateInput> = z.object({
  name: z.string(),
  description: z.string().nullable().optional(),
  type: PolicyTypeSchema,
  configuration: PolicyConfigurationSchema,
  priority: z.number(),
  enabled: z.boolean(),
  agentId: z.string().nullable().optional(),
});

export const PolicyUpdateInputSchema: z.ZodType<PolicyUpdateInput> = z.object({
  name: z.string().optional(),
  description: z.string().nullable().optional(),
  type: PolicyTypeSchema.optional(),
  configuration: PolicyConfigurationSchema.optional(),
  priority: z.number().optional(),
  enabled: z.boolean().optional(),
  agentId: z.string().nullable().optional(),
});

export const PolicySimulationRequestSchema: z.ZodType<PolicySimulationRequest> = z.object({
  walletId: z.string().optional(),
  agentId: z.string().optional(),
  asset: z.string(),
  amount: z.union([z.number(), z.string()]),
  recipientAddress: z.string().optional(),
  senderAddress: z.string().optional(),
  memo: z.string().optional(),
  spentInWindow: z.union([z.number(), z.string()]).optional(),
  policyIds: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const SimulatePolicyRequestSchema: z.ZodType<SimulatePolicyRequest> = z.object({
  walletId: z.string().optional(),
  asset: z.string(),
  amount: z.union([z.number(), z.string()]),
  recipientAddress: z.string().optional(),
  spentInWindow: z.string().optional(),
});

export const TransactionSignatureSchema: z.ZodType<TransactionSignature> = z.object({
  signer: z.string(),
  weight: z.number().optional(),
});

export const TransactionDetailsSchema: z.ZodType<TransactionDetails> = z.object({
  asset: z.string(),
  amount: z.union([z.number(), z.string()]),
  recipientAddress: z.string().optional(),
  senderAddress: z.string().optional(),
  timestamp: z.union([z.string(), z.date()]).optional(),
  signatures: z.array(TransactionSignatureSchema).optional(),
  signedWeight: z.number().optional(),
});

export const PolicyRuleSchema: z.ZodType<PolicyRule> = z.object({
  name: z.string(),
  enabled: z.boolean().optional(),
  allowedRecipients: z.array(z.string()).optional(),
  blockedRecipients: z.array(z.string()).optional(),
  allowedHours: PolicyAllowedHoursSchema.optional(),
  requiredSignatures: z.number().optional(),
});

export const PolicySetSchema: z.ZodType<PolicySet> = z.object({
  name: z.string().optional(),
  rules: z.array(PolicyRuleSchema),
});

export const PolicyViolationDetailSchema: z.ZodType<PolicyViolationDetail> = z.object({
  policyId: z.string(),
  policyType: PolicyTypeSchema,
  message: z.string(),
  limit: z.union([z.number(), z.string()]).optional(),
  actual: z.union([z.number(), z.string()]).optional(),
});

export const PolicyViolationSchema: z.ZodType<PolicyViolation> = z.object({
  policyId: z.string(),
  policyName: z.string(),
  policyType: PolicyTypeSchema,
  message: z.string(),
  limit: z.union([z.number(), z.string()]).optional(),
  actual: z.union([z.number(), z.string()]).optional(),
});

export const PolicyRiskFactorSchema: z.ZodType<PolicyRiskFactor> = z.object({
  factor: z.string(),
  score: z.number(),
  description: z.string(),
});

export const PolicyRiskAssessmentSchema: z.ZodType<PolicyRiskAssessment> = z.object({
  score: z.number(),
  band: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
  factors: z.array(PolicyRiskFactorSchema),
});

export const PolicyBudgetImpactSchema: z.ZodType<PolicyBudgetImpact> = z.object({
  budgetId: z.string(),
  beforeRemaining: z.string(),
  afterRemaining: z.string(),
});

export const PolicySimulationResultSchema: z.ZodType<PolicySimulationResult> = z.object({
  allowed: z.boolean(),
  violations: z.array(PolicyViolationDetailSchema),
  requiredApprovals: z.array(z.string()),
  risk: PolicyRiskAssessmentSchema,
  budgetImpact: z.array(PolicyBudgetImpactSchema),
  explanation: z.string(),
});

export const PolicyRuleCheckSchema: z.ZodType<PolicyRuleCheck> = z.enum(['address', 'time', 'signatures', 'none']);

export const PolicyRuleEvaluationSchema: z.ZodType<PolicyRuleEvaluation> = z.object({
  rule: z.string(),
  check: PolicyRuleCheckSchema,
  success: z.boolean(),
  explanation: z.string().optional(),
});

export const PolicyEvaluationResultSchema: z.ZodType<PolicyEvaluationResult> = z.object({
  allowed: z.boolean(),
  passed: z.boolean(),
  results: z.array(PolicyRuleEvaluationSchema),
  evaluatedRules: z.number(),
  failedRules: z.number(),
  failedRuleNames: z.array(z.string()),
});

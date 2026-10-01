import { z } from 'zod';
import { ValidationError } from '@astroid/errors';
import type { PolicyCreateInput, PolicyUpdateInput } from './index.js';
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

/**
 * Validates the required fields of a policy-create payload.
 *
 * Declared with `.passthrough()` on purpose: the resource is a thin transport
 * that forwards the caller's payload verbatim (stripping server-owned fields
 * is left to the type system), so runtime validation must check the known
 * fields without dropping any extra keys.
 */
export const PolicyCreateInputSchema: z.ZodType<PolicyCreateInput> = z
  .object({
    name: z.string(),
    description: z.string().nullable().optional(),
    type: PolicyTypeSchema,
    configuration: PolicyConfigurationSchema,
    priority: z.number(),
    enabled: z.boolean(),
    agentId: z.string().nullable().optional(),
  })
  .passthrough();

export const PolicyUpdateInputSchema: z.ZodType<PolicyUpdateInput> = z.object({
  name: z.string().optional(),
  description: z.string().nullable().optional(),
  type: PolicyTypeSchema.optional(),
  configuration: PolicyConfigurationSchema.optional(),
  priority: z.number().optional(),
  enabled: z.boolean().optional(),
  agentId: z.string().nullable().optional(),
});

/** Validates a simulation request; passthrough so unknown keys are forwarded verbatim. */
export const PolicySimulationRequestSchema: z.ZodType<PolicySimulationRequest> = z
  .object({
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
  })
  .passthrough();

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

export const PolicyRuleCheckSchema: z.ZodType<PolicyRuleCheck> = z.enum([
  'address',
  'time',
  'signatures',
  'none',
]);

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

/* -------------------------------------------------------------------------- */
/* Client-side payload validation                                              */
/* -------------------------------------------------------------------------- */

/** Flatten a Zod failure into `{ field: [messages] }` for `ValidationError.fieldErrors`. */
function toFieldErrors(error: z.ZodError): Record<string, string[]> {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.map(String).join('.') : 'input';
    (fieldErrors[key] ??= []).push(issue.message);
  }
  return fieldErrors;
}

/** Throw a structured `ValidationError` when `input` fails `schema`. */
function assertSchema<T>(schema: z.ZodType<T>, input: unknown, context: string): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ValidationError(`${context} failed schema validation.`, {
      code: 'POLICY_INPUT_VALIDATION_FAILED',
      status: 400,
      details: { fields: toFieldErrors(result.error) },
    });
  }
  return result.data;
}

/**
 * Validate a policy-create payload against {@link PolicyCreateInputSchema}
 * before any network call.
 *
 * @param input The draft policy payload to check.
 * @returns The parsed payload.
 * @throws {ValidationError} With `fieldErrors` naming every offending field.
 */
export function assertPolicyCreateInput(input: unknown): PolicyCreateInput {
  return assertSchema(PolicyCreateInputSchema, input, 'Policy create input');
}

/**
 * Validate a policy-simulation request against {@link PolicySimulationRequestSchema}
 * before any network call.
 *
 * @param input The simulation request to check.
 * @returns The parsed request.
 * @throws {ValidationError} With `fieldErrors` naming every offending field.
 */
export function assertPolicySimulationRequest(input: unknown): PolicySimulationRequest {
  return assertSchema(PolicySimulationRequestSchema, input, 'Policy simulation request');
}

import { z } from 'zod';
import { PolicyType } from '@astroid/types';

export const PolicyAllowedHoursSchema = z.object({
  startHour: z.number().int().min(0).max(23),
  endHour: z.number().int().min(0).max(23),
  timezone: z.string().optional(),
  days: z.array(z.number().int().min(0).max(6)).optional(),
});

export const PolicyConfigurationSchema = z.object({
  maxAmount: z.number().positive().optional(),
  minAmount: z.number().positive().optional(),
  asset: z.string().optional(),
  allowedAssets: z.array(z.string()).optional(),
  blockedAssets: z.array(z.string()).optional(),
  allowedRecipients: z.array(z.string()).optional(),
  blockedRecipients: z.array(z.string()).optional(),
  requiresApproval: z.boolean().optional(),
  dailyLimit: z.number().positive().optional(),
  weeklyLimit: z.number().positive().optional(),
  monthlyLimit: z.number().positive().optional(),
  timeWindow: z
    .object({
      start: z.string(),
      end: z.string(),
      timezone: z.string().optional(),
    })
    .optional(),
  allowedHours: PolicyAllowedHoursSchema.optional(),
  requiredSignatures: z.number().int().positive().optional(),
}).catchall(z.unknown());

export const PolicyCreateInputSchema = z.object({
  agentId: z.string().nullable().optional(),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  type: z.nativeEnum(PolicyType),
  configuration: PolicyConfigurationSchema,
  priority: z.number().int(),
  enabled: z.boolean(),
});

export const PolicyUpdateInputSchema = PolicyCreateInputSchema.partial();

export const PolicySimulationRequestSchema = z.object({
  walletId: z.string().optional(),
  agentId: z.string().optional(),
  asset: z.string(),
  amount: z.union([z.string(), z.number()]),
  recipientAddress: z.string().optional(),
  senderAddress: z.string().optional(),
  memo: z.string().optional(),
  spentInWindow: z.union([z.string(), z.number()]).optional(),
  policyIds: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});


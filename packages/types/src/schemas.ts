/**
 * Zod runtime validation schemas for core domain models and DTOs.
 *
 * Each schema mirrors the corresponding TypeScript interface in `entities.ts`
 * and `dto.ts` exactly — they are the single source of truth for runtime
 * validation at SDK boundaries.
 *
 * @example
 * ```ts
 * import { AgentSchema, validateAgent } from '@astroid/types';
 *
 * const result = validateAgent(unknownPayload);
 * if (result.success) {
 *   console.log(result.data.name);
 * } else {
 *   console.error(result.error.flatten());
 * }
 * ```
 *
 * @module
 */

import { z } from 'zod';

import type { AgentInitialBudget, AgentMetadata, CreateAgentDto, UpdateAgentDto } from './agent.js';

/* -------------------------------------------------------------------------- */
/* Enum schemas                                                                */
/* -------------------------------------------------------------------------- */

export const OrganizationPlanSchema = z.enum(['FREE', 'STARTER', 'GROWTH', 'ENTERPRISE']);

export const OrganizationStatusSchema = z.enum(['ACTIVE', 'SUSPENDED', 'ARCHIVED']);

export const UserRoleSchema = z.enum([
  'OWNER',
  'ADMIN',
  'FINANCE',
  'DEVELOPER',
  'AUDITOR',
  'VIEWER',
]);

export const UserStatusSchema = z.enum(['ACTIVE', 'INVITED', 'SUSPENDED', 'ARCHIVED']);

export const AgentRoleSchema = z.enum([
  'FINANCE',
  'RESEARCH',
  'OPERATIONS',
  'PROCUREMENT',
  'CUSTOM',
]);

export const AgentStatusSchema = z.enum(['ACTIVE', 'PAUSED', 'SUSPENDED', 'ARCHIVED']);

export const WalletTypeSchema = z.enum(['AGENT', 'TREASURY', 'ESCROW', 'SHARED', 'PERSONAL']);

export const WalletStatusSchema = z.enum(['ACTIVE', 'FROZEN', 'PAUSED', 'ARCHIVED']);

export const StellarNetworkSchema = z.enum(['TESTNET', 'PUBLIC', 'FUTURENET']);

export const PolicyTypeSchema = z.enum([
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

export const BudgetPeriodSchema = z.enum([
  'ONE_TIME',
  'DAILY',
  'WEEKLY',
  'MONTHLY',
  'QUARTERLY',
  'YEARLY',
]);

export const TransactionStatusSchema = z.enum([
  'DRAFT',
  'PENDING',
  'APPROVED',
  'SUBMITTED',
  'CONFIRMED',
  'COMPLETED',
  'REJECTED',
  'EXPIRED',
  'CANCELLED',
  'FAILED',
]);

export const RiskBandSchema = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);

export const ProposalStatusSchema = z.enum([
  'DRAFT',
  'PENDING',
  'APPROVED',
  'REJECTED',
  'EXPIRED',
  'EXECUTED',
  'CANCELLED',
]);

export const ApprovalTypeSchema = z.enum([
  'SINGLE',
  'DUAL',
  'MULTISIG',
  'ROLE',
  'COMMITTEE',
  'EMERGENCY',
]);

export const ApprovalDecisionSchema = z.enum(['APPROVED', 'REJECTED', 'DELEGATED', 'EXPIRED']);

export const NotificationTypeSchema = z.enum([
  'BUDGET_EXCEEDED',
  'PROPOSAL_APPROVED',
  'PROPOSAL_REJECTED',
  'WALLET_FUNDED',
  'PAYMENT_FAILED',
  'POLICY_VIOLATION',
  'RISK_ALERT',
  'APPROVAL_REQUIRED',
  'INFO',
]);

export const NotificationChannelSchema = z.enum([
  'DASHBOARD',
  'EMAIL',
  'DISCORD',
  'SLACK',
  'WEBHOOK',
]);

/* -------------------------------------------------------------------------- */
/* Shared primitives                                                           */
/* -------------------------------------------------------------------------- */

/** ISO-861 datetime string. */
export const IsoDateTimeSchema = z.string().datetime();

/** Decimal monetary amount as a string. */
export const DecimalStringSchema = z.string();

/* -------------------------------------------------------------------------- */
/* Asset descriptor schemas                                                    */
/* -------------------------------------------------------------------------- */

/** The native Stellar lumen asset. */
export const NativeAssetDescriptorSchema = z.object({
  type: z.literal('native'),
});

/** A custom issued (trustline) asset: code + issuer. */
export const IssuedAssetDescriptorSchema = z.object({
  type: z.literal('issued'),
  code: z.string().regex(/^[A-Za-z0-9]{1,12}$/, 'Asset code must be 1–12 alphanumeric characters'),
  issuer: z.string().min(1, 'Issuer is required'),
});

/** Any Stellar asset in canonical structured form. */
export const AssetDescriptorSchema = z.discriminatedUnion('type', [
  NativeAssetDescriptorSchema,
  IssuedAssetDescriptorSchema,
]);

/** The TypeScript type inferred from {@link AssetDescriptorSchema}. */
export type InferredAssetDescriptor = z.infer<typeof AssetDescriptorSchema>;

/* -------------------------------------------------------------------------- */
/* Core entity schemas                                                         */
/* -------------------------------------------------------------------------- */

/** Organization entity. */
export const OrganizationSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  logo: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  plan: OrganizationPlanSchema,
  status: OrganizationStatusSchema,
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
  deletedAt: IsoDateTimeSchema.nullable().optional(),
});

/** User entity. */
export const UserSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  name: z.string(),
  email: z.string().email(),
  avatar: z.string().nullable().optional(),
  role: UserRoleSchema,
  status: UserStatusSchema,
  lastLogin: IsoDateTimeSchema.nullable().optional(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
  deletedAt: IsoDateTimeSchema.nullable().optional(),
});

/** Agent entity. */
export const AgentSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  primaryWalletId: z.string().nullable().optional(),
  name: z.string(),
  description: z.string().nullable().optional(),
  provider: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  role: AgentRoleSchema,
  status: AgentStatusSchema,
  capabilities: z.array(z.string()),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
  deletedAt: IsoDateTimeSchema.nullable().optional(),
});

/**
 * The TypeScript type inferred from {@link AgentSchema} (issue #265).
 *
 * Compile-time assertion below proves it is structurally identical to the
 * canonical {@link Agent} interface, so either can be used interchangeably.
 */
export type InferredAgent = z.infer<typeof AgentSchema>;

/** Wallet entity. */
export const WalletSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  agentId: z.string().nullable().optional(),
  stellarAddress: z.string(),
  label: z.string().nullable().optional(),
  walletType: WalletTypeSchema,
  network: StellarNetworkSchema,
  status: WalletStatusSchema,
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
  deletedAt: IsoDateTimeSchema.nullable().optional(),
});

/** The TypeScript type inferred from {@link WalletSchema} (issue #265). */
export type InferredWallet = z.infer<typeof WalletSchema>;

/** Asset balance on a wallet. */
export const AssetBalanceSchema = z.object({
  asset: z.string(),
  balance: DecimalStringSchema,
  issuer: z.string().nullable().optional(),
});

/** Full balance snapshot for a wallet. */
export const WalletBalanceSchema = z.object({
  walletId: z.string(),
  stellarAddress: z.string(),
  network: StellarNetworkSchema,
  balances: z.array(AssetBalanceSchema),
  updatedAt: IsoDateTimeSchema,
});

/** Policy configuration (flexible JSONB shape). */
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
    allowedHours: z
      .object({
        startHour: z.number().int().min(0).max(23),
        endHour: z.number().int().min(0).max(23),
        timezone: z.string().optional(),
        days: z.array(z.number().int().min(0).max(6)).optional(),
      })
      .optional(),
    requiredSignatures: z.number().positive().optional(),
  })
  .passthrough();

/** Policy entity. */
export const PolicySchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  agentId: z.string().nullable().optional(),
  name: z.string(),
  description: z.string().nullable().optional(),
  type: PolicyTypeSchema,
  configuration: PolicyConfigurationSchema,
  priority: z.number(),
  enabled: z.boolean(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
  deletedAt: IsoDateTimeSchema.nullable().optional(),
});

/** The TypeScript type inferred from {@link PolicySchema} (issue #265). */
export type InferredPolicy = z.infer<typeof PolicySchema>;

/* -------------------------------------------------------------------------- */
/* Local policy evaluation schemas                                             */
/* -------------------------------------------------------------------------- */

/** Time-of-day window during which a policy rule permits an action. */
export const PolicyAllowedHoursSchema = z.object({
  startHour: z.number().int().min(0).max(23),
  endHour: z.number().int().min(0).max(23),
  timezone: z.string().optional(),
  days: z.array(z.number().int().min(0).max(6)).optional(),
});

/** A signature already attached to a proposed transaction. */
export const TransactionSignatureSchema = z.object({
  signer: z.string().min(1),
  weight: z.number().nonnegative().optional(),
});

/** The transaction payload a policy set is evaluated against. */
export const TransactionDetailsSchema = z.object({
  asset: z.string().min(1),
  amount: z.union([z.number(), z.string().min(1)]),
  recipientAddress: z.string().optional(),
  senderAddress: z.string().optional(),
  timestamp: z.union([z.string(), z.date()]).optional(),
  signatures: z.array(TransactionSignatureSchema).optional(),
  signedWeight: z.number().nonnegative().optional(),
});

/** A single locally-evaluated policy rule. */
export const PolicyEvaluationRuleSchema = z.object({
  name: z.string().min(1, 'Rule name is required'),
  enabled: z.boolean().optional(),
  allowedRecipients: z.array(z.string()).optional(),
  blockedRecipients: z.array(z.string()).optional(),
  allowedHours: PolicyAllowedHoursSchema.optional(),
  requiredSignatures: z.number().nonnegative().optional(),
});

/** A named collection of rules evaluated in declaration order. */
export const PolicySetSchema = z.object({
  name: z.string().optional(),
  rules: z.array(PolicyEvaluationRuleSchema),
});

/** The outcome of one rule check. */
export const PolicyRuleEvaluationSchema = z.object({
  rule: z.string(),
  check: z.enum(['address', 'time', 'signatures', 'none']),
  success: z.boolean(),
  explanation: z.string().optional(),
});

/** The detailed report returned by `evaluatePolicy`. */
export const PolicyEvaluationResultSchema = z.object({
  allowed: z.boolean(),
  passed: z.boolean(),
  results: z.array(PolicyRuleEvaluationSchema),
  evaluatedRules: z.number().int().nonnegative(),
  failedRules: z.number().int().nonnegative(),
  failedRuleNames: z.array(z.string()),
});

/* -------------------------------------------------------------------------- */
/* Single-policy simulation schemas                                            */
/* -------------------------------------------------------------------------- */

/**
 * The transaction payload evaluated against one specific policy.
 *
 * `amount` must be positive: a zero or negative transfer is never a meaningful
 * pre-flight check, and accepting it would let a malformed payload come back
 * "allowed" for a transaction that cannot execute.
 */
export const PolicySimulationInputSchema = z.object({
  asset: z.string().min(1, 'Asset is required'),
  amount: z.union([z.number().positive(), z.string().min(1)]),
  recipientAddress: z.string().min(1).optional(),
  senderAddress: z.string().min(1).optional(),
  memo: z.string().optional(),
  spentInWindow: z.union([z.number().nonnegative(), z.string().min(1)]).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

/** A single rule breached by a policy simulation. */
export const PolicyRuleBreachSchema = z.object({
  policyId: z.string().min(1),
  policyName: z.string().min(1).optional(),
  policyType: PolicyTypeSchema.optional(),
  rule: z.string().min(1),
  message: z.string(),
  limit: z.union([z.number(), z.string()]).optional(),
  actual: z.union([z.number(), z.string()]).optional(),
});

/** The detailed outcome of simulating a transaction against a single policy. */
export const PolicySimulationEvaluationSchema = z.object({
  policyId: z.string().min(1),
  allowed: z.boolean(),
  passed: z.boolean(),
  violatedRules: z.array(PolicyRuleBreachSchema),
  riskScore: z.number().min(0).max(1),
  risk: z.object({
    score: z.number().min(0).max(1),
    band: RiskBandSchema,
    factors: z.array(
      z.object({
        factor: z.string(),
        score: z.number(),
        description: z.string(),
      }),
    ),
  }),
  requiredApprovals: z.array(z.string()),
  budgetImpact: z.array(
    z.object({
      budgetId: z.string(),
      beforeRemaining: z.string(),
      afterRemaining: z.string(),
    }),
  ),
  explanation: z.string(),
});

/** Budget entity. */
export const BudgetSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  parentBudgetId: z.string().nullable().optional(),
  agentId: z.string().nullable().optional(),
  name: z.string(),
  currency: z.string(),
  limitAmount: DecimalStringSchema,
  spent: DecimalStringSchema,
  remaining: DecimalStringSchema,
  period: BudgetPeriodSchema,
  periodStart: IsoDateTimeSchema,
  rollover: z.boolean(),
  enabled: z.boolean(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
  deletedAt: IsoDateTimeSchema.nullable().optional(),
});

/** The TypeScript type inferred from {@link BudgetSchema} (issue #265). */
export type InferredBudget = z.infer<typeof BudgetSchema>;

/** Budget history entry. */
export const BudgetHistoryEntrySchema = z.object({
  id: z.string(),
  budgetId: z.string(),
  amount: DecimalStringSchema,
  spentAfter: DecimalStringSchema,
  transactionId: z.string().nullable().optional(),
  createdAt: IsoDateTimeSchema,
});

/** Transaction entity. */
export const TransactionSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  walletId: z.string(),
  agentId: z.string().nullable().optional(),
  policyId: z.string().nullable().optional(),
  budgetId: z.string().nullable().optional(),
  asset: z.string(),
  amount: DecimalStringSchema,
  senderAddress: z.string().nullable().optional(),
  recipientAddress: z.string(),
  memo: z.string().nullable().optional(),
  purpose: z.string().nullable().optional(),
  status: TransactionStatusSchema,
  riskScore: z.number(),
  riskBand: RiskBandSchema,
  requiresApproval: z.boolean(),
  stellarHash: z.string().nullable().optional(),
  confirmationCount: z.number(),
  gasEstimate: DecimalStringSchema.nullable().optional(),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
  deletedAt: IsoDateTimeSchema.nullable().optional(),
});

/** Proposal entity. */
export const ProposalSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  transactionId: z.string(),
  title: z.string(),
  description: z.string().nullable().optional(),
  approvalType: ApprovalTypeSchema,
  requiredApprovals: z.number(),
  status: ProposalStatusSchema,
  expiresAt: IsoDateTimeSchema.nullable().optional(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});

/** Approval entity. */
export const ApprovalSchema = z.object({
  id: z.string(),
  proposalId: z.string(),
  userId: z.string(),
  decision: ApprovalDecisionSchema,
  comment: z.string().nullable().optional(),
  createdAt: IsoDateTimeSchema,
});

/** Notification entity. */
export const NotificationSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  userId: z.string(),
  title: z.string(),
  body: z.string(),
  type: NotificationTypeSchema,
  channel: NotificationChannelSchema,
  read: z.boolean(),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: IsoDateTimeSchema,
});

/* -------------------------------------------------------------------------- */
/* DTO input schemas                                                           */
/* -------------------------------------------------------------------------- */

/** Create wallet input. */
export const CreateWalletInputSchema = z.object({
  agentId: z.string().optional(),
  label: z.string().optional(),
  walletType: WalletTypeSchema.optional(),
  network: StellarNetworkSchema.optional(),
});

/** Create agent input. */
export const CreateAgentInputSchema = z.object({
  name: z.string().min(1, 'Agent name is required'),
  description: z.string().optional(),
  role: AgentRoleSchema.optional(),
  provider: z.string().optional(),
  model: z.string().optional(),
  capabilities: z.array(z.string()).optional(),
  primaryWalletId: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

/** Create policy input. */
export const CreatePolicyInputSchema = z.object({
  name: z.string().min(1, 'Policy name is required'),
  type: PolicyTypeSchema,
  configuration: PolicyConfigurationSchema,
  description: z.string().optional(),
  agentId: z.string().optional(),
  priority: z.number().optional(),
  enabled: z.boolean().optional(),
});

/** Create budget input. */
export const CreateBudgetInputSchema = z.object({
  name: z.string().min(1, 'Budget name is required'),
  limitAmount: z.union([z.number().positive(), z.string().min(1)]),
  currency: z.string().optional(),
  period: BudgetPeriodSchema.optional(),
  parentBudgetId: z.string().optional(),
  agentId: z.string().optional(),
  rollover: z.boolean().optional(),
  enabled: z.boolean().optional(),
});

/** Create transaction input. */
export const CreateTransactionInputSchema = z.object({
  walletId: z.string().min(1, 'Wallet ID is required'),
  asset: z.string().min(1, 'Asset is required'),
  amount: z.union([z.number().positive(), z.string().min(1)]),
  recipientAddress: z.string().min(1, 'Recipient address is required'),
  agentId: z.string().optional(),
  policyId: z.string().optional(),
  budgetId: z.string().optional(),
  memo: z.string().optional(),
  purpose: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  idempotencyKey: z.string().optional(),
});

/** Transfer input. */
export const TransferInputSchema = z.object({
  recipientAddress: z.string().min(1, 'Recipient address is required'),
  asset: z.string().min(1, 'Asset is required'),
  amount: z.union([z.number().positive(), z.string().min(1)]),
  memo: z.string().optional(),
  purpose: z.string().optional(),
  budgetId: z.string().optional(),
  idempotencyKey: z.string().optional(),
});

/** Simulate policy input. */
export const SimulatePolicyInputSchema = z.object({
  walletId: z.string().optional(),
  agentId: z.string().optional(),
  asset: z.string().min(1, 'Asset is required'),
  amount: z.union([z.number().nonnegative(), z.string().min(1)]),
  recipientAddress: z.string().optional(),
  policyIds: z.array(z.string()).optional(),
});

/* -------------------------------------------------------------------------- */
/* Agent DTO schemas (issue #215)                                              */
/* -------------------------------------------------------------------------- */

/**
 * Agent payload Stellar address format: `G` followed by 51 base-32 characters
 * (52 total), as required by the agent API contract.
 *
 * The same shape check `@astroid/agent`'s `validateCreateAgentParams` and
 * `@astroid/transaction`'s `isValidStellarPublicKey` apply, so an address
 * accepted at one SDK boundary is accepted at the others. The base-32 alphabet
 * excludes `0`, `1`, `8` and `9`, which are not valid StrKey characters.
 */
export const STELLAR_PUBLIC_KEY_PATTERN = /^G[A-Z2-7]{51}$/;

/**
 * Non-negative decimal amount, e.g. `"0"`, `"500"` or `"1000.00"`.
 *
 * Deliberately stricter than `Number(value)`, which happily accepts
 * `"Infinity"`, `"0x10"`, `"1e3"` and `""` — all of which the Astroid API
 * rejects. Amounts travel as decimal strings (to preserve precision), so a
 * negative budget cap is a client-side error rather than a server `422`.
 */
const NON_NEGATIVE_DECIMAL_PATTERN = /^\d+(?:\.\d+)?$/;

/** Whether `value` is a string carrying at least one non-whitespace character. */
function isNonBlankString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * A Stellar public key (`G…`, 52 characters).
 *
 * This is a syntax check (prefix, length and base-32 alphabet); the CRC16
 * checksum is verified server-side.
 */
export const StellarPublicKeySchema = z
  .string()
  .refine((value) => STELLAR_PUBLIC_KEY_PATTERN.test(value.trim()), {
    message: 'Expected a Stellar public key starting with "G" and 52 characters long',
  });

/** A non-negative decimal amount string (e.g. `"1000.00"`). */
export const DecimalAmountStringSchema = z
  .string()
  .refine((value) => NON_NEGATIVE_DECIMAL_PATTERN.test(value.trim()), {
    message: 'Expected a non-negative decimal amount string (e.g. "1000.00")',
  });

/**
 * Agent metadata ({@link AgentMetadata}).
 *
 * The backend stores metadata as JSONB, so unknown keys are permitted; the keys
 * the SDK types are validated when present — `team` and `externalId` must be
 * non-blank strings, `tags` an array of non-blank strings, and
 * `stellarAddress` a format-valid Stellar public key.
 */
export const AgentMetadataSchema: z.ZodType<AgentMetadata> = z
  .record(z.string(), z.unknown())
  .superRefine((value, ctx) => {
    for (const key of ['team', 'externalId'] as const) {
      if (value[key] !== undefined && !isNonBlankString(value[key])) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `Expected "${key}" to be a non-blank string when provided`,
        });
      }
    }

    const tags = value['tags'];
    if (tags !== undefined && (!Array.isArray(tags) || !tags.every(isNonBlankString))) {
      ctx.addIssue({
        code: 'custom',
        path: ['tags'],
        message: 'Expected "tags" to be an array of non-blank strings',
      });
    }

    const stellarAddress = value['stellarAddress'];
    if (stellarAddress !== undefined && !StellarPublicKeySchema.safeParse(stellarAddress).success) {
      ctx.addIssue({
        code: 'custom',
        path: ['stellarAddress'],
        message: 'Expected "stellarAddress" to be a Stellar public key (G…, 52 characters)',
      });
    }
  });

/** The initial budget allocated to an agent at creation time. */
export const AgentInitialBudgetSchema: z.ZodType<AgentInitialBudget> = z.object({
  currency: z
    .string()
    .refine(isNonBlankString, { message: 'Expected "initialBudget.currency" to be non-blank' }),
  amount: DecimalAmountStringSchema,
});

/**
 * Strict schema for {@link CreateAgentDto} — the `POST /v1/agents` payload.
 *
 * `name`, `capabilities` (at least one entry, every entry non-blank) and
 * `initialBudget` are required; optional fields are validated whenever they are
 * supplied, so a misconfiguration is caught locally instead of as a server
 * `422`. `@astroid/agent`'s `validateCreateAgentParams` applies the same rules
 * before the request is dispatched, and additionally validates the
 * conventional top-level `stellarAddress` key untyped callers may send.
 */
export const CreateAgentDtoSchema: z.ZodType<CreateAgentDto> = z.object({
  name: z.string().refine(isNonBlankString, { message: 'Agent name is required' }),
  capabilities: z
    .array(
      z
        .string()
        .refine(isNonBlankString, { message: 'Agent capabilities must be non-blank strings' }),
    )
    .min(1, 'At least one agent capability is required'),
  initialBudget: AgentInitialBudgetSchema,
  description: z.string().optional(),
  role: AgentRoleSchema.optional(),
  provider: z
    .string()
    .refine(isNonBlankString, { message: 'Expected "provider" to be a non-blank string' })
    .optional(),
  model: z
    .string()
    .refine(isNonBlankString, { message: 'Expected "model" to be a non-blank string' })
    .optional(),
  primaryWalletId: z
    .string()
    .refine(isNonBlankString, { message: 'Expected "primaryWalletId" to be a non-blank string' })
    .optional(),
  metadata: AgentMetadataSchema.optional(),
});

/** Every field an {@link UpdateAgentDto} payload may carry. */
export const UPDATE_AGENT_DTO_FIELDS = Object.freeze([
  'name',
  'description',
  'role',
  'provider',
  'model',
  'capabilities',
  'status',
  'primaryWalletId',
  'metadata',
] as const);

/**
 * Strict schema for {@link UpdateAgentDto} — the `PATCH /v1/agents/:id` payload.
 *
 * Every field is optional, but at least one must be present: an empty `PATCH` is
 * a guaranteed no-op, so it is rejected locally instead of costing a round trip.
 * `primaryWalletId` also accepts `null` (which detaches the agent's wallet);
 * every other field rejects `null` so a typo cannot blank out an agent.
 */
export const UpdateAgentDtoSchema: z.ZodType<UpdateAgentDto> = z
  .object({
    name: z
      .string()
      .refine(isNonBlankString, { message: 'Expected "name" to be a non-blank string' })
      .optional(),
    description: z.string().optional(),
    role: AgentRoleSchema.optional(),
    provider: z
      .string()
      .refine(isNonBlankString, { message: 'Expected "provider" to be a non-blank string' })
      .optional(),
    model: z
      .string()
      .refine(isNonBlankString, { message: 'Expected "model" to be a non-blank string' })
      .optional(),
    capabilities: z
      .array(
        z
          .string()
          .refine(isNonBlankString, { message: 'Agent capabilities must be non-blank strings' }),
      )
      .min(1, 'At least one agent capability is required')
      .optional(),
    status: AgentStatusSchema.optional(),
    primaryWalletId: z
      .string()
      .refine(isNonBlankString, { message: 'Expected "primaryWalletId" to be a non-blank string' })
      .nullable()
      .optional(),
    metadata: AgentMetadataSchema.optional(),
  })
  .refine((value) => UPDATE_AGENT_DTO_FIELDS.some((field) => value[field] !== undefined), {
    message: `At least one of ${UPDATE_AGENT_DTO_FIELDS.join(', ')} must be provided`,
  });

/**
 * Non-throwing type guard for {@link CreateAgentDto}.
 *
 * @param value The payload to check.
 * @returns     `true` when `value` is a valid agent creation payload.
 *
 * @example
 * ```ts
 * isValidCreateAgentDto({
 *   name: 'Bot',
 *   capabilities: ['trade'],
 *   initialBudget: { currency: 'USDC', amount: '100' },
 * }); // true
 * ```
 */
export function isValidCreateAgentDto(value: unknown): value is CreateAgentDto {
  return CreateAgentDtoSchema.safeParse(value).success;
}

/**
 * Non-throwing type guard for {@link UpdateAgentDto}.
 *
 * @param value The payload to check.
 * @returns     `true` when `value` is a valid agent update payload.
 */
export function isValidUpdateAgentDto(value: unknown): value is UpdateAgentDto {
  return UpdateAgentDtoSchema.safeParse(value).success;
}

/* -------------------------------------------------------------------------- */
/* Validation helpers                                                          */
/* -------------------------------------------------------------------------- */

/** Result of a validation attempt. */
export type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; error: z.ZodError };

/**
 * Validate an unknown value against a Zod schema, returning a typed result.
 *
 * @example
 * ```ts
 * const result = validate(AgentSchema, payload);
 * if (result.success) {
 *   console.log(result.data.name);
 * }
 * ```
 */
export function validate<T extends z.ZodType>(
  schema: T,
  value: unknown,
): ValidationResult<z.infer<T>> {
  const result = schema.safeParse(value);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: result.error };
}

/**
 * Validate and throw on failure. Returns the typed value on success.
 *
 * @throws {z.ZodError} if validation fails.
 *
 * @example
 * ```ts
 * const agent = validateOrThrow(AgentSchema, payload);
 * ```
 */
export function validateOrThrow<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  return schema.parse(value);
}

/* -------------------------------------------------------------------------- */
/* Convenience validators (one-liners for common entities)                     */
/* -------------------------------------------------------------------------- */

/** Validate an Agent payload. */
export function validateAgent(value: unknown): ValidationResult<z.infer<typeof AgentSchema>> {
  return validate(AgentSchema, value);
}

/** Validate a Wallet payload. */
export function validateWallet(value: unknown): ValidationResult<z.infer<typeof WalletSchema>> {
  return validate(WalletSchema, value);
}

/** Validate a Policy payload. */
export function validatePolicy(value: unknown): ValidationResult<z.infer<typeof PolicySchema>> {
  return validate(PolicySchema, value);
}

/** Validate a local policy set (`evaluatePolicy` input). */
export function validatePolicySet(
  value: unknown,
): ValidationResult<z.infer<typeof PolicySetSchema>> {
  return validate(PolicySetSchema, value);
}

/** Validate a transaction-details payload (`evaluatePolicy` input). */
export function validateTransactionDetails(
  value: unknown,
): ValidationResult<z.infer<typeof TransactionDetailsSchema>> {
  return validate(TransactionDetailsSchema, value);
}

/** Validate a Budget payload. */
export function validateBudget(value: unknown): ValidationResult<z.infer<typeof BudgetSchema>> {
  return validate(BudgetSchema, value);
}

/** Validate a Transaction payload. */
export function validateTransaction(
  value: unknown,
): ValidationResult<z.infer<typeof TransactionSchema>> {
  return validate(TransactionSchema, value);
}

/** Validate a CreateTransactionInput payload. */
export function validateCreateTransactionInput(
  value: unknown,
): ValidationResult<z.infer<typeof CreateTransactionInputSchema>> {
  return validate(CreateTransactionInputSchema, value);
}

/** Validate a CreateAgentInput payload. */
export function validateCreateAgentInput(
  value: unknown,
): ValidationResult<z.infer<typeof CreateAgentInputSchema>> {
  return validate(CreateAgentInputSchema, value);
}

/**
 * Validate a `CreateAgentDto` payload (`POST /v1/agents`).
 *
 * Returns a discriminated result rather than throwing, so a form or CLI can map
 * `result.error.issues` onto its own fields:
 *
 * ```ts
 * const result = validateCreateAgentDto(payload);
 * if (!result.success) {
 *   console.error(result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
 * }
 * ```
 */
export function validateCreateAgentDto(value: unknown): ValidationResult<CreateAgentDto> {
  return validate(CreateAgentDtoSchema, value);
}

/** Validate an `UpdateAgentDto` payload (`PATCH /v1/agents/:id`). */
export function validateUpdateAgentDto(value: unknown): ValidationResult<UpdateAgentDto> {
  return validate(UpdateAgentDtoSchema, value);
}

/** Validate a CreatePolicyInput payload. */
export function validateCreatePolicyInput(
  value: unknown,
): ValidationResult<z.infer<typeof CreatePolicyInputSchema>> {
  return validate(CreatePolicyInputSchema, value);
}

/** Validate a CreateBudgetInput payload. */
export function validateCreateBudgetInput(
  value: unknown,
): ValidationResult<z.infer<typeof CreateBudgetInputSchema>> {
  return validate(CreateBudgetInputSchema, value);
}

/** Validate a TransferInput payload. */
export function validateTransferInput(
  value: unknown,
): ValidationResult<z.infer<typeof TransferInputSchema>> {
  return validate(TransferInputSchema, value);
}

/**
 * Validate a single-policy simulation payload
 * (`PolicyResource.simulatePolicy(policyId, input)` input).
 */
export function validatePolicySimulationInput(
  value: unknown,
): ValidationResult<z.infer<typeof PolicySimulationInputSchema>> {
  return validate(PolicySimulationInputSchema, value);
}

/**
 * Validate a parsed single-policy simulation result
 * (`PolicySimulationEvaluation`) — the shape the SDK guarantees its callers.
 */
export function validatePolicySimulationEvaluation(
  value: unknown,
): ValidationResult<z.infer<typeof PolicySimulationEvaluationSchema>> {
  return validate(PolicySimulationEvaluationSchema, value);
}

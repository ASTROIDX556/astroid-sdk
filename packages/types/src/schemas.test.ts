import { describe, it, expect } from 'vitest';
import {
  AgentSchema,
  WalletSchema,
  PolicySchema,
  BudgetSchema,
  TransactionSchema,
  CreateAgentInputSchema,
  CreateWalletInputSchema,
  CreatePolicyInputSchema,
  CreateBudgetInputSchema,
  CreateTransactionInputSchema,
  TransferInputSchema,
  validate,
  validateOrThrow,
  validateAgent,
  validateWallet,
  validatePolicy,
  validateBudget,
  validateTransaction,
  validateCreateTransactionInput,
  validateCreateAgentInput,
  validateCreatePolicyInput,
  validateCreateBudgetInput,
  validateTransferInput,
  PolicyConfigurationSchema,
  PolicySetSchema,
  TransactionDetailsSchema,
  PolicySimulationInputSchema,
  PolicySimulationEvaluationSchema,
  validatePolicySimulationInput,
  validatePolicySimulationEvaluation,
  validatePolicySet,
  validateTransactionDetails,
  // Agent DTO schemas (issue #215)
  CreateAgentDtoSchema,
  UpdateAgentDtoSchema,
  AgentMetadataSchema,
  AgentInitialBudgetSchema,
  StellarPublicKeySchema,
  DecimalAmountStringSchema,
  UPDATE_AGENT_DTO_FIELDS,
  isValidCreateAgentDto,
  isValidUpdateAgentDto,
  validateCreateAgentDto,
  validateUpdateAgentDto,
  type InferredAgent,
  type InferredWallet,
  type InferredPolicy,
  type InferredBudget,
} from './schemas.js';
import type { Agent, Wallet, Policy, Budget } from './entities.js';
import type { CreateAgentDto, UpdateAgentDto } from './agent.js';

/* -------------------------------------------------------------------------- */
/* Inferred-type exports (issue #265)                                          */
/* -------------------------------------------------------------------------- */

/**
 * Compile-time structural-equality proof between an inferred schema type and
 * the canonical interface: both directions of assignability must hold.
 */
type SameStructure<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

// The inferred types must be structurally identical to the canonical
// interfaces — if a schema drifts from its entity, these fail to compile.
type _AgentMatches = SameStructure<InferredAgent, Agent>;
type _WalletMatches = SameStructure<InferredWallet, Wallet>;
type _PolicyMatches = SameStructure<InferredPolicy, Policy>;
type _BudgetMatches = SameStructure<InferredBudget, Budget>;
const _assertAgentMatches: _AgentMatches = true;
const _assertWalletMatches: _WalletMatches = true;
const _assertPolicyMatches: _PolicyMatches = true;
const _assertBudgetMatches: _BudgetMatches = true;
void _assertAgentMatches;
void _assertWalletMatches;
void _assertPolicyMatches;
void _assertBudgetMatches;

/* -------------------------------------------------------------------------- */
/* Valid payloads — should pass                                                */
/* -------------------------------------------------------------------------- */

describe('Zod schemas — inferred type exports (issue #265)', () => {
  it('exports InferredAgent/InferredWallet/InferredPolicy/InferredBudget from the package root', async () => {
    const mod = await import('./index.js');
    expect(mod.AgentSchema).toBeDefined();
    expect(mod.WalletSchema).toBeDefined();
    expect(mod.PolicySchema).toBeDefined();
    expect(mod.BudgetSchema).toBeDefined();
    // Type-only exports: compile-time presence is proven by the import above
    // and the structural assertions; this guard keeps the test honest about
    // the schemas being runtime values too.
    expect(typeof mod.validateAgent).toBe('function');
  });

  it('produces an InferredAgent usable as the canonical Agent interface', async () => {
    const result = AgentSchema.safeParse({
      id: 'agt_inf',
      organizationId: 'org_1',
      name: 'Inferred Bot',
      role: 'FINANCE',
      status: 'ACTIVE',
      capabilities: ['trade'],
      metadata: {},
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      const agent: InferredAgent = result.data;
      // Bidirectional assignability proves runtime/compile-time parity.
      const canonical: Agent = agent;
      const roundTripped: InferredAgent = canonical;
      expect(roundTripped.name).toBe('Inferred Bot');
    }
  });

  it('produces an InferredBudget usable as the canonical Budget interface', async () => {
    const result = BudgetSchema.safeParse({
      id: 'bud_inf',
      organizationId: 'org_1',
      name: 'Ops',
      currency: 'USDC',
      limitAmount: '1000.00',
      spent: '250.00',
      remaining: '750.00',
      period: 'MONTHLY',
      periodStart: '2026-09-01T00:00:00.000Z',
      rollover: false,
      enabled: true,
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      const budget: InferredBudget = result.data;
      const canonical: Budget = budget;
      const roundTripped: InferredBudget = canonical;
      expect(roundTripped.limitAmount).toBe('1000.00');
    }
  });

  it('keeps InferredWallet and InferredPolicy assignable in both directions', () => {
    // Compile-time proof; the runtime assertions below guard the harness.
    const walletAssigns = (w: InferredWallet): Wallet => w;
    const policyAssigns = (p: InferredPolicy): Policy => p;
    expect(walletAssigns).toBeDefined();
    expect(policyAssigns).toBeDefined();
  });
});

describe('Zod schemas — valid payloads', () => {
  const validAgent = {
    id: 'agt_1',
    organizationId: 'org_1',
    name: 'Finance Bot',
    role: 'FINANCE',
    status: 'ACTIVE',
    capabilities: ['payments', 'budgets'],
    metadata: { version: 2 },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  const validWallet = {
    id: 'wlt_1',
    organizationId: 'org_1',
    stellarAddress: 'GABC1234567890ABCDEF',
    walletType: 'TREASURY',
    network: 'TESTNET',
    status: 'ACTIVE',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  const validPolicy = {
    id: 'pol_1',
    organizationId: 'org_1',
    name: 'Daily Limit',
    type: 'MAX_AMOUNT',
    configuration: { maxAmount: 1000 },
    priority: 1,
    enabled: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  const validBudget = {
    id: 'bud_1',
    organizationId: 'org_1',
    name: 'Monthly Ops',
    currency: 'USDC',
    limitAmount: '10000',
    spent: '2500',
    remaining: '7500',
    period: 'MONTHLY',
    periodStart: '2026-01-01T00:00:00.000Z',
    rollover: false,
    enabled: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  const validTransaction = {
    id: 'txn_1',
    organizationId: 'org_1',
    walletId: 'wlt_1',
    asset: 'USDC',
    amount: '100.50',
    recipientAddress: 'GDEF1234567890ABCDEF',
    status: 'COMPLETED',
    riskScore: 0.2,
    riskBand: 'LOW',
    requiresApproval: false,
    confirmationCount: 3,
    metadata: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  it('AgentSchema validates a correct agent', () => {
    const result = AgentSchema.safeParse(validAgent);
    expect(result.success).toBe(true);
  });

  it('WalletSchema validates a correct wallet', () => {
    const result = WalletSchema.safeParse(validWallet);
    expect(result.success).toBe(true);
  });

  it('PolicySchema validates a correct policy', () => {
    const result = PolicySchema.safeParse(validPolicy);
    expect(result.success).toBe(true);
  });

  it('BudgetSchema validates a correct budget', () => {
    const result = BudgetSchema.safeParse(validBudget);
    expect(result.success).toBe(true);
  });

  it('TransactionSchema validates a correct transaction', () => {
    const result = TransactionSchema.safeParse(validTransaction);
    expect(result.success).toBe(true);
  });

  it('AgentSchema allows optional fields to be missing', () => {
    const minimal = {
      id: 'agt_2',
      organizationId: 'org_1',
      name: 'Minimal Bot',
      role: 'FINANCE',
      status: 'ACTIVE',
      capabilities: [],
      metadata: {},
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    expect(AgentSchema.safeParse(minimal).success).toBe(true);
  });

  it('TransactionSchema allows nullable optional fields', () => {
    const tx = {
      ...validTransaction,
      agentId: null,
      policyId: null,
      memo: null,
    };
    expect(TransactionSchema.safeParse(tx).success).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Invalid payloads — should fail with descriptive errors                      */
/* -------------------------------------------------------------------------- */

describe('Zod schemas — invalid payloads', () => {
  it('AgentSchema rejects missing required fields', () => {
    const result = AgentSchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      const issues = result.error.issues.map((i) => i.path.join('.'));
      expect(issues).toContain('id');
      expect(issues).toContain('name');
      expect(issues).toContain('role');
      expect(issues).toContain('status');
      expect(issues).toContain('capabilities');
    }
  });

  it('AgentSchema rejects invalid enum values', () => {
    const result = AgentSchema.safeParse({
      id: 'agt_1',
      organizationId: 'org_1',
      name: 'Bot',
      role: 'INVALID_ROLE',
      status: 'ACTIVE',
      capabilities: [],
      metadata: {},
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain('Invalid');
    }
  });

  it('WalletSchema rejects missing stellarAddress', () => {
    const result = WalletSchema.safeParse({
      id: 'wlt_1',
      organizationId: 'org_1',
      walletType: 'TREASURY',
      network: 'TESTNET',
      status: 'ACTIVE',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(result.success).toBe(false);
  });

  it('PolicySchema rejects invalid policy type', () => {
    const result = PolicySchema.safeParse({
      id: 'pol_1',
      organizationId: 'org_1',
      name: 'Test',
      type: 'INVALID_TYPE',
      configuration: {},
      priority: 1,
      enabled: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(result.success).toBe(false);
  });

  it('BudgetSchema rejects missing limitAmount', () => {
    const result = BudgetSchema.safeParse({
      id: 'bud_1',
      organizationId: 'org_1',
      name: 'Test',
      currency: 'USDC',
      spent: '0',
      remaining: '100',
      period: 'MONTHLY',
      periodStart: '2026-01-01T00:00:00.000Z',
      rollover: false,
      enabled: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(result.success).toBe(false);
  });

  it('TransactionSchema rejects invalid status', () => {
    const result = TransactionSchema.safeParse({
      id: 'txn_1',
      organizationId: 'org_1',
      walletId: 'wlt_1',
      asset: 'USDC',
      amount: '100',
      recipientAddress: 'GABC',
      status: 'INVALID_STATUS',
      riskScore: 0,
      riskBand: 'LOW',
      requiresApproval: false,
      confirmationCount: 0,
      metadata: {},
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(result.success).toBe(false);
  });

  it('TransactionSchema rejects non-numeric riskScore', () => {
    const result = TransactionSchema.safeParse({
      id: 'txn_1',
      organizationId: 'org_1',
      walletId: 'wlt_1',
      asset: 'USDC',
      amount: '100',
      recipientAddress: 'GABC',
      status: 'COMPLETED',
      riskScore: 'high',
      riskBand: 'LOW',
      requiresApproval: false,
      confirmationCount: 0,
      metadata: {},
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(result.success).toBe(false);
  });

  it('AgentSchema rejects completely invalid input types', () => {
    expect(AgentSchema.safeParse('not an object').success).toBe(false);
    expect(AgentSchema.safeParse(null).success).toBe(false);
    expect(AgentSchema.safeParse(undefined).success).toBe(false);
    expect(AgentSchema.safeParse(42).success).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* DTO input schemas                                                           */
/* -------------------------------------------------------------------------- */

describe('Zod schemas — DTO inputs', () => {
  it('CreateAgentInputSchema requires name', () => {
    expect(CreateAgentInputSchema.safeParse({}).success).toBe(false);
    expect(CreateAgentInputSchema.safeParse({ name: '' }).success).toBe(false);
    expect(CreateAgentInputSchema.safeParse({ name: 'Bot' }).success).toBe(true);
  });

  it('CreateWalletInputSchema accepts empty input (all optional)', () => {
    expect(CreateWalletInputSchema.safeParse({}).success).toBe(true);
  });

  it('CreatePolicyInputSchema requires name and type', () => {
    expect(CreatePolicyInputSchema.safeParse({}).success).toBe(false);
    expect(
      CreatePolicyInputSchema.safeParse({ name: 'Test', type: 'MAX_AMOUNT', configuration: {} })
        .success,
    ).toBe(true);
  });

  it('CreateBudgetInputSchema requires name and limitAmount', () => {
    expect(CreateBudgetInputSchema.safeParse({}).success).toBe(false);
    expect(CreateBudgetInputSchema.safeParse({ name: 'Budget', limitAmount: 1000 }).success).toBe(
      true,
    );
    expect(CreateBudgetInputSchema.safeParse({ name: 'Budget', limitAmount: '1000' }).success).toBe(
      true,
    );
  });

  it('CreateTransactionInputSchema requires walletId, asset, amount, recipientAddress', () => {
    const result = CreateTransactionInputSchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.'));
      expect(paths).toContain('walletId');
      expect(paths).toContain('asset');
      expect(paths).toContain('amount');
      expect(paths).toContain('recipientAddress');
    }
  });

  it('CreateTransactionInputSchema validates a complete input', () => {
    const result = CreateTransactionInputSchema.safeParse({
      walletId: 'wlt_1',
      asset: 'USDC',
      amount: '100',
      recipientAddress: 'GABC',
    });
    expect(result.success).toBe(true);
  });

  it('TransferInputSchema requires recipientAddress, asset, amount', () => {
    expect(TransferInputSchema.safeParse({}).success).toBe(false);
    expect(
      TransferInputSchema.safeParse({
        recipientAddress: 'GABC',
        asset: 'USDC',
        amount: 50,
      }).success,
    ).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Validation helpers                                                          */
/* -------------------------------------------------------------------------- */

describe('Zod schemas — validation helpers', () => {
  const validAgent = {
    id: 'agt_1',
    organizationId: 'org_1',
    name: 'Finance Bot',
    role: 'FINANCE',
    status: 'ACTIVE',
    capabilities: [],
    metadata: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  it('validate returns success for valid data', () => {
    const result = validate(AgentSchema, validAgent);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('Finance Bot');
    }
  });

  it('validate returns error for invalid data', () => {
    const result = validate(AgentSchema, {});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.length).toBeGreaterThan(0);
    }
  });

  it('validateOrThrow returns data for valid input', () => {
    const data = validateOrThrow(AgentSchema, validAgent);
    expect(data.name).toBe('Finance Bot');
  });

  it('validateOrThrow throws ZodError for invalid input', () => {
    expect(() => validateOrThrow(AgentSchema, {})).toThrow();
  });

  it('validateAgent works for agents', () => {
    expect(validateAgent(validAgent).success).toBe(true);
    expect(validateAgent({}).success).toBe(false);
  });

  it('validateWallet works for wallets', () => {
    const wallet = {
      id: 'wlt_1',
      organizationId: 'org_1',
      stellarAddress: 'GABC',
      walletType: 'TREASURY',
      network: 'TESTNET',
      status: 'ACTIVE',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    expect(validateWallet(wallet).success).toBe(true);
    expect(validateWallet({}).success).toBe(false);
  });

  it('validatePolicy works for policies', () => {
    const policy = {
      id: 'pol_1',
      organizationId: 'org_1',
      name: 'Limit',
      type: 'MAX_AMOUNT',
      configuration: { maxAmount: 100 },
      priority: 1,
      enabled: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    expect(validatePolicy(policy).success).toBe(true);
    expect(validatePolicy({}).success).toBe(false);
  });

  it('validateBudget works for budgets', () => {
    const budget = {
      id: 'bud_1',
      organizationId: 'org_1',
      name: 'Monthly',
      currency: 'USDC',
      limitAmount: '1000',
      spent: '0',
      remaining: '1000',
      period: 'MONTHLY',
      periodStart: '2026-01-01T00:00:00.000Z',
      rollover: false,
      enabled: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    expect(validateBudget(budget).success).toBe(true);
    expect(validateBudget({}).success).toBe(false);
  });

  it('validateTransaction works for transactions', () => {
    const tx = {
      id: 'txn_1',
      organizationId: 'org_1',
      walletId: 'wlt_1',
      asset: 'USDC',
      amount: '100',
      recipientAddress: 'GABC',
      status: 'COMPLETED',
      riskScore: 0.1,
      riskBand: 'LOW',
      requiresApproval: false,
      confirmationCount: 1,
      metadata: {},
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    expect(validateTransaction(tx).success).toBe(true);
    expect(validateTransaction({}).success).toBe(false);
  });

  it('validateCreateTransactionInput works for transaction inputs', () => {
    const input = {
      walletId: 'wlt_1',
      asset: 'USDC',
      amount: '100',
      recipientAddress: 'GABC',
    };
    expect(validateCreateTransactionInput(input).success).toBe(true);
    expect(validateCreateTransactionInput({}).success).toBe(false);
  });

  it('validateCreateAgentInput works for agent inputs', () => {
    expect(validateCreateAgentInput({ name: 'Bot' }).success).toBe(true);
    expect(validateCreateAgentInput({}).success).toBe(false);
  });

  it('validateCreatePolicyInput works for policy inputs', () => {
    expect(
      validateCreatePolicyInput({ name: 'Test', type: 'MAX_AMOUNT', configuration: {} }).success,
    ).toBe(true);
    expect(validateCreatePolicyInput({}).success).toBe(false);
  });

  it('validateCreateBudgetInput works for budget inputs', () => {
    expect(validateCreateBudgetInput({ name: 'Budget', limitAmount: 1000 }).success).toBe(true);
    expect(validateCreateBudgetInput({}).success).toBe(false);
  });

  it('validateTransferInput works for transfer inputs', () => {
    expect(
      validateTransferInput({ recipientAddress: 'GABC', asset: 'USDC', amount: 50 }).success,
    ).toBe(true);
    expect(validateTransferInput({}).success).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Forward compatibility — unknown extra properties must not break parsing    */
/* -------------------------------------------------------------------------- */

describe('Zod schemas — forward compatibility', () => {
  const timestamps = {
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  it('AgentSchema strips unknown extra properties without failing', () => {
    const result = AgentSchema.safeParse({
      id: 'agt_1',
      organizationId: 'org_1',
      name: 'Bot',
      role: 'FINANCE',
      status: 'ACTIVE',
      capabilities: [],
      metadata: {},
      ...timestamps,
      someFutureField: 'new-api-value',
      nestedFuture: { a: 1 },
    });
    expect(result.success).toBe(true);
  });

  it('WalletSchema strips unknown extra properties without failing', () => {
    const result = WalletSchema.safeParse({
      id: 'wlt_1',
      organizationId: 'org_1',
      stellarAddress: 'GABC',
      walletType: 'TREASURY',
      network: 'TESTNET',
      status: 'ACTIVE',
      ...timestamps,
      futureField: 123,
    });
    expect(result.success).toBe(true);
  });

  it('PolicySchema strips unknown extra properties without failing', () => {
    const result = PolicySchema.safeParse({
      id: 'pol_1',
      organizationId: 'org_1',
      name: 'Limit',
      type: 'MAX_AMOUNT',
      configuration: { maxAmount: 100 },
      priority: 1,
      enabled: true,
      ...timestamps,
      futureField: true,
    });
    expect(result.success).toBe(true);
  });

  it('BudgetSchema strips unknown extra properties without failing', () => {
    const result = BudgetSchema.safeParse({
      id: 'bud_1',
      organizationId: 'org_1',
      name: 'Monthly',
      currency: 'USDC',
      limitAmount: '1000',
      spent: '0',
      remaining: '1000',
      period: 'MONTHLY',
      periodStart: '2026-01-01T00:00:00.000Z',
      rollover: false,
      enabled: true,
      ...timestamps,
      futureField: ['x'],
    });
    expect(result.success).toBe(true);
  });

  it('TransactionSchema strips unknown extra properties without failing', () => {
    const result = TransactionSchema.safeParse({
      id: 'txn_1',
      organizationId: 'org_1',
      walletId: 'wlt_1',
      asset: 'USDC',
      amount: '100',
      recipientAddress: 'GABC',
      status: 'COMPLETED',
      riskScore: 0.1,
      riskBand: 'LOW',
      requiresApproval: false,
      confirmationCount: 1,
      metadata: {},
      ...timestamps,
      futureField: 'forward-compat',
    });
    expect(result.success).toBe(true);
  });

  it('validators accept payloads with unknown extra properties', () => {
    const agent = {
      id: 'agt_1',
      organizationId: 'org_1',
      name: 'Bot',
      role: 'FINANCE',
      status: 'ACTIVE',
      capabilities: [],
      metadata: {},
      ...timestamps,
      extra: 'ignored',
    };
    expect(validateAgent(agent).success).toBe(true);
    expect(() => validateOrThrow(AgentSchema, agent)).not.toThrow();
  });
});

/* -------------------------------------------------------------------------- */
/* Schema type compatibility with TypeScript interfaces                        */
/* -------------------------------------------------------------------------- */

describe('Zod schemas — type compatibility', () => {
  it('AgentSchema output type matches the entity interface', () => {
    type SchemaType = typeof AgentSchema._output;
    // Verify key fields exist
    const agent: SchemaType = {
      id: '1',
      organizationId: '1',
      name: 'Bot',
      role: 'FINANCE',
      status: 'ACTIVE',
      capabilities: [],
      metadata: {},
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    expect(agent.id).toBe('1');
  });

  it('WalletSchema output type has all required fields', () => {
    type SchemaType = typeof WalletSchema._output;
    const wallet: SchemaType = {
      id: '1',
      organizationId: '1',
      stellarAddress: 'GABC',
      walletType: 'TREASURY',
      network: 'TESTNET',
      status: 'ACTIVE',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    expect(wallet.stellarAddress).toBe('GABC');
  });

  it('TransactionSchema output type has all required fields', () => {
    type SchemaType = typeof TransactionSchema._output;
    const tx: SchemaType = {
      id: '1',
      organizationId: '1',
      walletId: '1',
      asset: 'USDC',
      amount: '100',
      recipientAddress: 'GABC',
      status: 'COMPLETED',
      riskScore: 0,
      riskBand: 'LOW',
      requiresApproval: false,
      confirmationCount: 0,
      metadata: {},
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    expect(tx.status).toBe('COMPLETED');
  });
});

/* -------------------------------------------------------------------------- */
/* Local policy evaluation schemas (issue #17)                                 */
/* -------------------------------------------------------------------------- */

describe('PolicySetSchema', () => {
  it('accepts a set with allow/deny lists, hours and a signature threshold', () => {
    const result = PolicySetSchema.safeParse({
      name: 'Treasury',
      rules: [
        {
          name: 'Allowlist',
          allowedRecipients: ['GABC'],
          blockedRecipients: ['GDEF'],
          allowedHours: { startHour: 9, endHour: 17, timezone: 'UTC', days: [1, 2, 3] },
          requiredSignatures: 2,
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects a rule without a name', () => {
    expect(PolicySetSchema.safeParse({ rules: [{ allowedRecipients: ['GABC'] }] }).success).toBe(
      false,
    );
  });

  it('rejects out-of-range allowed hours', () => {
    expect(
      PolicySetSchema.safeParse({
        rules: [{ name: 'Hours', allowedHours: { startHour: 24, endHour: 5 } }],
      }).success,
    ).toBe(false);
  });
});

describe('TransactionDetailsSchema', () => {
  it('accepts a payload with signatures and an explicit weight', () => {
    const result = TransactionDetailsSchema.safeParse({
      asset: 'USDC',
      amount: '100',
      recipientAddress: 'GABC',
      timestamp: '2026-09-28T12:00:00.000Z',
      signatures: [{ signer: 'GONE', weight: 2 }, { signer: 'GTWO' }],
      signedWeight: 3,
    });
    expect(result.success).toBe(true);
  });

  it('rejects a payload without an asset', () => {
    expect(TransactionDetailsSchema.safeParse({ amount: '100' }).success).toBe(false);
  });
});

describe('policy evaluation validators', () => {
  it('validatePolicySet reports success and typed data', () => {
    const result = validatePolicySet({ rules: [{ name: 'Allowlist' }] });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.rules[0]?.name).toBe('Allowlist');
  });

  it('validateTransactionDetails surfaces structured failures', () => {
    const result = validateTransactionDetails({ asset: 'USDC' });
    expect(result.success).toBe(false);
  });

  it('PolicyConfigurationSchema accepts allowedHours and requiredSignatures', () => {
    const result = PolicyConfigurationSchema.safeParse({
      allowedHours: { startHour: 0, endHour: 0 },
      requiredSignatures: 2,
    });
    expect(result.success).toBe(true);
  });
});

describe('PolicySimulationInputSchema', () => {
  it('accepts a decimal-string or numeric amount with the optional fields', () => {
    for (const amount of ['750', '0.01', 1, 250.5]) {
      const result = PolicySimulationInputSchema.safeParse({
        asset: 'USDC',
        amount,
        recipientAddress: 'GDESTINATION',
        senderAddress: 'GSOURCE',
        memo: 'payout',
        spentInWindow: '0',
        metadata: { runId: 'run_1' },
      });
      expect(result.success).toBe(true);
    }
  });

  it('rejects a missing or blank asset', () => {
    expect(PolicySimulationInputSchema.safeParse({ amount: '10' }).success).toBe(false);
    expect(PolicySimulationInputSchema.safeParse({ asset: '', amount: '10' }).success).toBe(false);
  });

  it('rejects a non-positive amount', () => {
    for (const amount of [0, -1, -0.5]) {
      expect(PolicySimulationInputSchema.safeParse({ asset: 'XLM', amount }).success).toBe(false);
    }
  });

  it('rejects a negative spentInWindow but accepts zero', () => {
    expect(PolicySimulationInputSchema.safeParse({ asset: 'XLM', amount: '1', spentInWindow: -1 }).success).toBe(false);
    expect(PolicySimulationInputSchema.safeParse({ asset: 'XLM', amount: '1', spentInWindow: 0 }).success).toBe(true);
  });

  it('validatePolicySimulationInput reports success and typed data', () => {
    const result = validatePolicySimulationInput({ asset: 'USDC', amount: '10' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.asset).toBe('USDC');
  });

  it('validatePolicySimulationInput surfaces structured failures', () => {
    const result = validatePolicySimulationInput({ asset: 'USDC', amount: 0 });
    expect(result.success).toBe(false);
  });
});

describe('PolicySimulationEvaluationSchema', () => {
  const evaluation = {
    policyId: 'pol_1',
    allowed: false,
    passed: false,
    violatedRules: [
      {
        policyId: 'pol_1',
        policyName: 'Max 500 USDC',
        policyType: 'MAX_AMOUNT',
        rule: 'MAX_AMOUNT',
        message: 'Transfer amount 750 exceeds the maximum allowed limit of 500 USDC.',
        limit: 500,
        actual: '750',
      },
    ],
    riskScore: 0.82,
    risk: {
      score: 0.82,
      band: 'HIGH',
      factors: [{ factor: 'unusual_amount', score: 0.4, description: 'Above the rolling average.' }],
    },
    requiredApprovals: ['owner'],
    budgetImpact: [
      { budgetId: 'bdg_1', beforeRemaining: '1000.00', afterRemaining: '250.00' },
    ],
    explanation: 'Transfer is blocked by 1 active policy.',
  };

  it('accepts a parsed evaluation with breaches, risk and budget impact', () => {
    const result = PolicySimulationEvaluationSchema.safeParse(evaluation);
    expect(result.success).toBe(true);
  });

  it('rejects an out-of-range risk score', () => {
    expect(
      PolicySimulationEvaluationSchema.safeParse({ ...evaluation, riskScore: 82 }).success,
    ).toBe(false);
    expect(
      PolicySimulationEvaluationSchema.safeParse({ ...evaluation, risk: { ...evaluation.risk, score: -0.1 } })
        .success,
    ).toBe(false);
  });

  it('rejects an unknown policy type and risk band', () => {
    expect(
      PolicySimulationEvaluationSchema.safeParse({
        ...evaluation,
        violatedRules: [{ ...evaluation.violatedRules[0], policyType: 'NOT_A_TYPE' }],
      }).success,
    ).toBe(false);
    expect(
      PolicySimulationEvaluationSchema.safeParse({
        ...evaluation,
        risk: { ...evaluation.risk, band: 'SEVERE' },
      }).success,
    ).toBe(false);
  });

  it('rejects a breach without a rule name or a decision without a policy id', () => {
    const { rule: _rule, ...breachWithoutRule } = evaluation.violatedRules[0]!;
    expect(
      PolicySimulationEvaluationSchema.safeParse({
        ...evaluation,
        violatedRules: [breachWithoutRule],
      }).success,
    ).toBe(false);
    expect(
      PolicySimulationEvaluationSchema.safeParse({ ...evaluation, policyId: '' }).success,
    ).toBe(false);
  });

  it('validatePolicySimulationEvaluation accepts a parsed evaluation and rejects a denial', () => {
    expect(validatePolicySimulationEvaluation(evaluation).success).toBe(true);
    expect(validatePolicySimulationEvaluation({ allowed: false }).success).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Agent DTO schemas (issue #215)                                              */
/* -------------------------------------------------------------------------- */

describe('Agent DTO schemas (issue #215)', () => {
  /**
   * A format-valid Stellar public key: `G` plus 55 base-32 characters (56 in
   * total, as StrKey requires). The issue text mentions "52 characters", which
   * is shorter than any real Stellar address, so the schemas — like the rest of
   * the SDK — enforce the real StrKey length.
   */
  const STELLAR_ADDRESS = `G${'A'.repeat(55)}`;

  describe('StellarPublicKeySchema', () => {
    it('accepts a 56-character G-address, ignoring surrounding whitespace', () => {
      expect(StellarPublicKeySchema.safeParse(STELLAR_ADDRESS).success).toBe(true);
      expect(StellarPublicKeySchema.safeParse(`  ${STELLAR_ADDRESS}  `).success).toBe(true);
    });

    it('rejects short, lowercase, mis-prefixed and base-32-invalid addresses', () => {
      for (const address of [
        '',
        'GABC',
        `S${'A'.repeat(55)}`, // secret-key prefix
        `G${'a'.repeat(55)}`, // lowercase is not base-32
        `G${'1'.repeat(55)}`, // 1 is not in the base-32 alphabet
        'not-an-address',
      ]) {
        expect(StellarPublicKeySchema.safeParse(address).success, address).toBe(false);
      }
    });

    it('rejects non-strings', () => {
      expect(StellarPublicKeySchema.safeParse(42).success).toBe(false);
      expect(StellarPublicKeySchema.safeParse(null).success).toBe(false);
    });
  });

  describe('DecimalAmountStringSchema / AgentInitialBudgetSchema', () => {
    it('accepts non-negative decimal amount strings, including zero', () => {
      for (const amount of ['0', '500', '1000.00', '0.000001']) {
        expect(DecimalAmountStringSchema.safeParse(amount).success, amount).toBe(true);
      }
    });

    it('rejects a negative budget cap and anything that only coerces to a number', () => {
      for (const amount of [
        '-50',
        '-0.01',
        '',
        '  ',
        'Infinity',
        '0x10',
        '1e3',
        '5.',
        '.5',
        '+5',
      ]) {
        expect(DecimalAmountStringSchema.safeParse(amount).success, amount).toBe(false);
      }
    });

    it('requires both currency and amount on the initial budget', () => {
      expect(AgentInitialBudgetSchema.safeParse({ currency: 'USDC', amount: '100' }).success).toBe(
        true,
      );
      expect(AgentInitialBudgetSchema.safeParse({ amount: '100' }).success).toBe(false);
      expect(AgentInitialBudgetSchema.safeParse({ currency: 'USDC' }).success).toBe(false);
      expect(AgentInitialBudgetSchema.safeParse({ currency: '  ', amount: '100' }).success).toBe(
        false,
      );
    });
  });
});

describe('CreateAgentDtoSchema (issue #215)', () => {
  const STELLAR_ADDRESS = `G${'A'.repeat(55)}`;

  const VALID_CREATE_AGENT = {
    name: 'TradingBot',
    capabilities: ['swap', 'arbitrage'],
    initialBudget: { currency: 'USDC', amount: '500' },
  };

  const FULL_CREATE_AGENT = {
    ...VALID_CREATE_AGENT,
    description: 'Automated market maker on the Stellar DEX',
    role: 'FINANCE',
    provider: 'anthropic',
    model: 'claude-sonnet-5',
    primaryWalletId: 'wal_123',
    metadata: { team: 'trading', tags: ['prod'], stellarAddress: STELLAR_ADDRESS },
  };

  it('accepts a minimal and a fully-populated creation payload', () => {
    expect(CreateAgentDtoSchema.safeParse(VALID_CREATE_AGENT).success).toBe(true);
    expect(CreateAgentDtoSchema.safeParse(FULL_CREATE_AGENT).success).toBe(true);
  });

  it('accepts a payload typed as the canonical CreateAgentDto', () => {
    const typed: CreateAgentDto = { ...VALID_CREATE_AGENT, role: 'OPERATIONS' };
    expect(isValidCreateAgentDto(typed)).toBe(true);
    expect(CreateAgentDtoSchema.safeParse(typed).success).toBe(true);
  });

  it('requires a non-blank name', () => {
    for (const name of ['', '   ', 42, null, undefined]) {
      expect(
        CreateAgentDtoSchema.safeParse({ ...VALID_CREATE_AGENT, name }).success,
        JSON.stringify(name),
      ).toBe(false);
    }
  });

  it('requires at least one non-blank capability', () => {
    for (const capabilities of [[], ['  '], ['swap', 42], ['swap', ''], 'swap', undefined]) {
      expect(
        CreateAgentDtoSchema.safeParse({ ...VALID_CREATE_AGENT, capabilities }).success,
        JSON.stringify(capabilities),
      ).toBe(false);
    }
  });

  it('requires a valid initialBudget and rejects a negative budget cap', () => {
    for (const initialBudget of [
      undefined,
      {},
      { currency: 'USDC' },
      { amount: '100' },
      { currency: 'USDC', amount: '-100' },
      { currency: 'USDC', amount: '1e3' },
      { currency: '', amount: '100' },
      'USDC:100',
    ]) {
      expect(
        CreateAgentDtoSchema.safeParse({ ...VALID_CREATE_AGENT, initialBudget }).success,
        JSON.stringify(initialBudget),
      ).toBe(false);
    }

    expect(
      CreateAgentDtoSchema.safeParse({
        ...VALID_CREATE_AGENT,
        initialBudget: { currency: 'USDC', amount: '0' },
      }).success,
    ).toBe(true);
  });

  it('validates the optional agent role against the enum', () => {
    expect(CreateAgentDtoSchema.safeParse({ ...VALID_CREATE_AGENT, role: 'FINANCE' }).success).toBe(
      true,
    );
    expect(CreateAgentDtoSchema.safeParse({ ...VALID_CREATE_AGENT, role: 'finance' }).success).toBe(
      false,
    );
    expect(CreateAgentDtoSchema.safeParse({ ...VALID_CREATE_AGENT, role: 42 }).success).toBe(false);
  });

  it('rejects blank optional strings but allows an empty description', () => {
    for (const field of ['provider', 'model', 'primaryWalletId'] as const) {
      expect(
        CreateAgentDtoSchema.safeParse({ ...VALID_CREATE_AGENT, [field]: '' }).success,
        field,
      ).toBe(false);
    }
    expect(CreateAgentDtoSchema.safeParse({ ...VALID_CREATE_AGENT, description: '' }).success).toBe(
      true,
    );
    expect(CreateAgentDtoSchema.safeParse({ ...VALID_CREATE_AGENT, description: 42 }).success).toBe(
      false,
    );
  });

  it('reports the offending field path in the issues', () => {
    const result = CreateAgentDtoSchema.safeParse({ ...VALID_CREATE_AGENT, name: '' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path.join('.'))).toContain('name');
    }
  });
});

describe('UpdateAgentDtoSchema (issue #215)', () => {
  it('accepts a single-field partial update', () => {
    expect(UpdateAgentDtoSchema.safeParse({ status: 'PAUSED' }).success).toBe(true);
    expect(UpdateAgentDtoSchema.safeParse({ capabilities: ['transfer'] }).success).toBe(true);
  });

  it('accepts a fully-populated update payload', () => {
    const result = UpdateAgentDtoSchema.safeParse({
      name: 'Renamed Bot',
      description: 'Updated description',
      role: 'OPERATIONS',
      provider: 'anthropic',
      model: 'claude-sonnet-5',
      capabilities: ['trade', 'transfer'],
      status: 'ACTIVE',
      primaryWalletId: 'wal_456',
      metadata: { team: 'ops', tags: ['prod'] },
    });
    expect(result.success).toBe(true);
  });

  it('accepts null primaryWalletId (wallet detach) and still rejects blank ids', () => {
    expect(UpdateAgentDtoSchema.safeParse({ primaryWalletId: null }).success).toBe(true);
    expect(UpdateAgentDtoSchema.safeParse({ primaryWalletId: 'wal_1' }).success).toBe(true);
    expect(UpdateAgentDtoSchema.safeParse({ primaryWalletId: '' }).success).toBe(false);
    expect(UpdateAgentDtoSchema.safeParse({ primaryWalletId: 42 }).success).toBe(false);
  });

  it('rejects an empty or all-undefined patch', () => {
    expect(UpdateAgentDtoSchema.safeParse({}).success).toBe(false);
    expect(UpdateAgentDtoSchema.safeParse({ name: undefined }).success).toBe(false);

    const result = UpdateAgentDtoSchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain(UPDATE_AGENT_DTO_FIELDS[0]);
    }
  });

  it('accepts every field the DTO declares', () => {
    const validFields: Record<(typeof UPDATE_AGENT_DTO_FIELDS)[number], unknown> = {
      name: 'Bot',
      description: 'anything',
      role: 'FINANCE',
      provider: 'anthropic',
      model: 'claude-sonnet-5',
      capabilities: ['trade'],
      status: 'SUSPENDED',
      primaryWalletId: null,
      metadata: { team: 'ops' },
    };

    for (const field of UPDATE_AGENT_DTO_FIELDS) {
      expect(UpdateAgentDtoSchema.safeParse({ [field]: validFields[field] }).success, field).toBe(
        true,
      );
    }
  });

  it('rejects malformed values for the enum and string fields', () => {
    for (const payload of [
      { name: '' },
      { name: '   ' },
      { role: 'finance' },
      { status: 'active' },
      { provider: '' },
      { model: 42 },
      { capabilities: [] },
      { capabilities: [''] },
      { metadata: 'nope' },
      { metadata: { stellarAddress: 'GABC' } },
      { metadata: { tags: [1] } },
    ]) {
      expect(UpdateAgentDtoSchema.safeParse(payload).success, JSON.stringify(payload)).toBe(false);
    }
  });

  it('accepts a payload typed as the canonical UpdateAgentDto', () => {
    const typed: UpdateAgentDto = { status: 'ARCHIVED', primaryWalletId: null };
    expect(isValidUpdateAgentDto(typed)).toBe(true);
  });
});

describe('Agent DTO validation helpers (issue #215)', () => {
  const STELLAR_ADDRESS = `G${'A'.repeat(55)}`;

  const VALID_CREATE_AGENT = {
    name: 'TradingBot',
    capabilities: ['swap'],
    initialBudget: { currency: 'USDC', amount: '500' },
  };

  describe('validateCreateAgentDto', () => {
    it('returns typed data for a valid payload', () => {
      const result = validateCreateAgentDto({
        ...VALID_CREATE_AGENT,
        metadata: { stellarAddress: STELLAR_ADDRESS },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe('TradingBot');
        expect(result.data.initialBudget.amount).toBe('500');
      }
    });

    it('returns structured issues instead of throwing', () => {
      const result = validateCreateAgentDto({
        name: '',
        capabilities: [],
        initialBudget: { currency: 'USDC', amount: '-5' },
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map((issue) => issue.path.join('.'));
        expect(paths).toContain('name');
        expect(paths).toContain('capabilities');
        expect(paths).toContain('initialBudget.amount');
      }
    });

    it('treats non-object payloads as invalid', () => {
      for (const payload of [null, undefined, 'agent', 42, []]) {
        expect(validateCreateAgentDto(payload).success, JSON.stringify(payload)).toBe(false);
      }
    });
  });

  describe('validateUpdateAgentDto', () => {
    it('returns a success result for a valid partial update', () => {
      const result = validateUpdateAgentDto({ status: 'PAUSED' });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.status).toBe('PAUSED');
    });

    it('rejects an empty patch with an issue on the payload root', () => {
      const result = validateUpdateAgentDto({});
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.issues.length).toBeGreaterThan(0);
    });

    it('surfaces the path of a malformed field', () => {
      const result = validateUpdateAgentDto({ metadata: { stellarAddress: 'GABC' } });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.path.join('.')).toContain('metadata');
      }
    });
  });

  describe('isValidCreateAgentDto / isValidUpdateAgentDto', () => {
    it('narrows an unknown payload to the canonical DTO types', () => {
      const createPayload: unknown = { ...VALID_CREATE_AGENT };
      expect(isValidCreateAgentDto(createPayload)).toBe(true);
      if (isValidCreateAgentDto(createPayload)) {
        const name: CreateAgentDto['name'] = createPayload.name;
        expect(name).toBe('TradingBot');
      }

      const updatePayload: unknown = { status: 'PAUSED' };
      expect(isValidUpdateAgentDto(updatePayload)).toBe(true);
      if (isValidUpdateAgentDto(updatePayload)) {
        const status: UpdateAgentDto['status'] = updatePayload.status;
        expect(status).toBe('PAUSED');
      }
    });

    it('never throws for malformed input', () => {
      for (const payload of [null, undefined, 0, 'nope', [], { name: 'x' }]) {
        expect(isValidCreateAgentDto(payload)).toBe(false);
      }
      for (const payload of [null, undefined, 0, 'nope', [], {}]) {
        expect(isValidUpdateAgentDto(payload)).toBe(false);
      }
    });
  });

  describe('AgentMetadataSchema', () => {
    it('passes unknown keys through and accepts an empty bag', () => {
      expect(AgentMetadataSchema.safeParse({}).success).toBe(true);
      const result = AgentMetadataSchema.safeParse({ anything: [1, 2, 3], nested: { a: 1 } });
      expect(result.success).toBe(true);
    });

    it('validates the typed keys it declares', () => {
      expect(
        AgentMetadataSchema.safeParse({
          team: 'ops',
          externalId: 'ext_1',
          tags: ['prod'],
          stellarAddress: STELLAR_ADDRESS,
        }).success,
      ).toBe(true);

      for (const metadata of [
        { team: 42 },
        { externalId: '' },
        { tags: 'prod' },
        { tags: [1] },
        { tags: [''] },
        { stellarAddress: 'GABC' },
      ]) {
        expect(AgentMetadataSchema.safeParse(metadata).success, JSON.stringify(metadata)).toBe(
          false,
        );
      }
    });

    it('points at the offending metadata key', () => {
      const result = AgentMetadataSchema.safeParse({ stellarAddress: 'GABC' });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.path.join('.')).toBe('stellarAddress');
      }
    });
  });
});

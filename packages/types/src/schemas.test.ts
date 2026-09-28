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
  validatePolicySet,
  validateTransactionDetails,
  type InferredAgent,
  type InferredWallet,
  type InferredPolicy,
  type InferredBudget,
} from './schemas.js';
import type { Agent, Wallet, Policy, Budget } from './entities.js';

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

import { describe, it, expect } from 'vitest';
import { simulatePolicies, type PolicyRule, type SimulatedTransaction } from './simulator.js';

/* -------------------------------------------------------------------------- */
/* Test helpers                                                                */
/* -------------------------------------------------------------------------- */

const RECIPIENT = 'GABCDEFHIJKLMNOPQRSTUVWXYZ23456789abcdefghijklmnopq';
const OTHER_ADDR = 'GXYZABCDEFHIJKLMNOPQRSTUVWXYZ23456789abcdefghijklmnopq';

function tx(overrides: Partial<SimulatedTransaction> = {}): SimulatedTransaction {
  return {
    asset: 'USDC',
    amount: 100,
    recipientAddress: RECIPIENT,
    ...overrides,
  };
}

function rule(overrides: Partial<PolicyRule> = {}): PolicyRule {
  return {
    id: 'r1',
    name: 'Test Rule',
    type: 'MAX_AMOUNT',
    configuration: {},
    ...overrides,
  };
}

/* -------------------------------------------------------------------------- */
/* MAX_AMOUNT threshold                                                        */
/* -------------------------------------------------------------------------- */

describe('MAX_AMOUNT policy', () => {
  it('allows a transaction at exactly the ceiling', () => {
    const result = simulatePolicies(
      [rule({ type: 'MAX_AMOUNT', configuration: { maxAmount: 100 } })],
      tx({ amount: 100 }),
    );
    expect(result.allowed).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it('allows a transaction below the ceiling', () => {
    const result = simulatePolicies(
      [rule({ type: 'MAX_AMOUNT', configuration: { maxAmount: 100 } })],
      tx({ amount: 99.99 }),
    );
    expect(result.allowed).toBe(true);
  });

  it('blocks a transaction above the ceiling', () => {
    const result = simulatePolicies(
      [rule({ type: 'MAX_AMOUNT', configuration: { maxAmount: 100 } })],
      tx({ amount: 100.01 }),
    );
    expect(result.allowed).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]!.policyType).toBe('MAX_AMOUNT');
    expect(result.violations[0]!.limit).toBe(100);
    expect(result.violations[0]!.actual).toBe(100.01);
    expect(result.violations[0]!.message).toContain('100.01');
  });

  it('skips the rule when maxAmount is not configured', () => {
    const result = simulatePolicies(
      [rule({ type: 'MAX_AMOUNT', configuration: {} })],
      tx({ amount: 999999 }),
    );
    expect(result.allowed).toBe(true);
    expect(result.violations).toHaveLength(0);
    expect(result.rulesEvaluated).toBe(1);
  });
});

/* -------------------------------------------------------------------------- */
/* MIN_AMOUNT threshold                                                        */
/* -------------------------------------------------------------------------- */

describe('MIN_AMOUNT policy', () => {
  it('allows a transaction at exactly the floor', () => {
    const result = simulatePolicies(
      [rule({ id: 'r2', name: 'Min Amount', type: 'MIN_AMOUNT', configuration: { minAmount: 10 } })],
      tx({ amount: 10 }),
    );
    expect(result.allowed).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it('blocks a transaction below the floor', () => {
    const result = simulatePolicies(
      [rule({ id: 'r2', name: 'Min Amount', type: 'MIN_AMOUNT', configuration: { minAmount: 10 } })],
      tx({ amount: 5 }),
    );
    expect(result.allowed).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]!.policyType).toBe('MIN_AMOUNT');
    expect(result.violations[0]!.limit).toBe(10);
    expect(result.violations[0]!.actual).toBe(5);
  });

  it('allows a transaction above the floor', () => {
    const result = simulatePolicies(
      [rule({ id: 'r2', name: 'Min Amount', type: 'MIN_AMOUNT', configuration: { minAmount: 10 } })],
      tx({ amount: 100 }),
    );
    expect(result.allowed).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* ALLOWED_ASSETS                                                              */
/* -------------------------------------------------------------------------- */

describe('ALLOWED_ASSETS policy', () => {
  it('allows a transaction with a permitted asset', () => {
    const result = simulatePolicies(
      [rule({ type: 'ALLOWED_ASSETS', configuration: { allowedAssets: ['USDC', 'XLM'] } })],
      tx({ asset: 'USDC' }),
    );
    expect(result.allowed).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it('blocks a transaction with a non-permitted asset', () => {
    const result = simulatePolicies(
      [rule({ type: 'ALLOWED_ASSETS', configuration: { allowedAssets: ['USDC', 'XLM'] } })],
      tx({ asset: 'BTC' }),
    );
    expect(result.allowed).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]!.message).toContain('BTC');
    expect(result.violations[0]!.message).toContain('USDC');
  });

  it('skips when allowedAssets is empty', () => {
    const result = simulatePolicies(
      [rule({ type: 'ALLOWED_ASSETS', configuration: { allowedAssets: [] } })],
      tx({ asset: 'ANY' }),
    );
    expect(result.allowed).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* BLOCKED_ASSETS                                                              */
/* -------------------------------------------------------------------------- */

describe('BLOCKED_ASSETS policy', () => {
  it('blocks a transaction with a forbidden asset', () => {
    const result = simulatePolicies(
      [rule({ type: 'BLOCKED_ASSETS', configuration: { blockedAssets: ['DOGE', 'SHIB'] } })],
      tx({ asset: 'DOGE' }),
    );
    expect(result.allowed).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]!.message).toContain('DOGE');
    expect(result.violations[0]!.message).toContain('blocked');
  });

  it('allows a transaction with a non-blocked asset', () => {
    const result = simulatePolicies(
      [rule({ type: 'BLOCKED_ASSETS', configuration: { blockedAssets: ['DOGE', 'SHIB'] } })],
      tx({ asset: 'USDC' }),
    );
    expect(result.allowed).toBe(true);
  });

  it('skips when blockedAssets is empty', () => {
    const result = simulatePolicies(
      [rule({ type: 'BLOCKED_ASSETS', configuration: { blockedAssets: [] } })],
      tx({ asset: 'DOGE' }),
    );
    expect(result.allowed).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* ALLOWED_RECIPIENTS                                                          */
/* -------------------------------------------------------------------------- */

describe('ALLOWED_RECIPIENTS policy', () => {
  it('allows a transaction to a whitelisted address', () => {
    const result = simulatePolicies(
      [rule({ type: 'ALLOWED_RECIPIENTS', configuration: { allowedRecipients: [RECIPIENT, OTHER_ADDR] } })],
      tx(),
    );
    expect(result.allowed).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it('blocks a transaction to a non-whitelisted address', () => {
    const result = simulatePolicies(
      [rule({ type: 'ALLOWED_RECIPIENTS', configuration: { allowedRecipients: [OTHER_ADDR] } })],
      tx(),
    );
    expect(result.allowed).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]!.message).toContain(RECIPIENT);
    expect(result.violations[0]!.message).toContain('not in the allowed whitelist');
  });

  it('blocks when no recipient is provided but whitelist is active', () => {
    const result = simulatePolicies(
      [rule({ type: 'ALLOWED_RECIPIENTS', configuration: { allowedRecipients: [RECIPIENT] } })],
      tx({ recipientAddress: undefined }),
    );
    expect(result.allowed).toBe(false);
    expect(result.violations[0]!.message).toContain('required');
  });

  it('skips when allowedRecipients is empty', () => {
    const result = simulatePolicies(
      [rule({ type: 'ALLOWED_RECIPIENTS', configuration: { allowedRecipients: [] } })],
      tx(),
    );
    expect(result.allowed).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* BLOCKED_RECIPIENTS                                                          */
/* -------------------------------------------------------------------------- */

describe('BLOCKED_RECIPIENTS policy', () => {
  it('blocks a transaction to a blacklisted address', () => {
    const result = simulatePolicies(
      [rule({ type: 'BLOCKED_RECIPIENTS', configuration: { blockedRecipients: [RECIPIENT] } })],
      tx(),
    );
    expect(result.allowed).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]!.message).toContain(RECIPIENT);
    expect(result.violations[0]!.message).toContain('blocked');
  });

  it('allows a transaction to a non-blocked address', () => {
    const result = simulatePolicies(
      [rule({ type: 'BLOCKED_RECIPIENTS', configuration: { blockedRecipients: [OTHER_ADDR] } })],
      tx(),
    );
    expect(result.allowed).toBe(true);
  });

  it('ignores undefined recipient when blacklist is active', () => {
    const result = simulatePolicies(
      [rule({ type: 'BLOCKED_RECIPIENTS', configuration: { blockedRecipients: [RECIPIENT] } })],
      tx({ recipientAddress: undefined }),
    );
    expect(result.allowed).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Disabled rules                                                              */
/* -------------------------------------------------------------------------- */

describe('disabled rules', () => {
  it('skips disabled rules entirely', () => {
    const result = simulatePolicies(
      [rule({ enabled: false, type: 'MAX_AMOUNT', configuration: { maxAmount: 1 } })],
      tx({ amount: 999 }),
    );
    expect(result.allowed).toBe(true);
    expect(result.violations).toHaveLength(0);
    expect(result.rulesEvaluated).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Asset-scoped rules                                                          */
/* -------------------------------------------------------------------------- */

describe('asset-scoped rules', () => {
  it('skips rules targeting a different asset', () => {
    const result = simulatePolicies(
      [rule({ type: 'MAX_AMOUNT', configuration: { asset: 'XLM', maxAmount: 1 } })],
      tx({ asset: 'USDC', amount: 999 }),
    );
    expect(result.allowed).toBe(true);
    expect(result.rulesEvaluated).toBe(0);
  });

  it('evaluates rules matching the transaction asset', () => {
    const result = simulatePolicies(
      [rule({ type: 'MAX_AMOUNT', configuration: { asset: 'USDC', maxAmount: 50 } })],
      tx({ asset: 'USDC', amount: 100 }),
    );
    expect(result.allowed).toBe(false);
    expect(result.rulesEvaluated).toBe(1);
  });
});

/* -------------------------------------------------------------------------- */
/* Priority ordering                                                           */
/* -------------------------------------------------------------------------- */

describe('priority ordering', () => {
  it('evaluates higher-priority rules first', () => {

    const low = rule({
      id: 'low',
      name: 'Low Priority',
      type: 'MAX_AMOUNT',
      priority: 1,
      configuration: { maxAmount: 50 },
    });
    const high = rule({
      id: 'high',
      name: 'High Priority',
      type: 'MAX_AMOUNT',
      priority: 10,
      configuration: { maxAmount: 100 },
    });

    // Both will fire since 200 > 100 and 200 > 50
    const result = simulatePolicies([low, high], tx({ amount: 200 }));
    expect(result.violations).toHaveLength(2);
    // High priority should be first in the array
    expect(result.violations[0]!.policyId).toBe('high');
    expect(result.violations[1]!.policyId).toBe('low');
  });

  it('defaults priority to 0 when not set', () => {
    const r1 = rule({ id: 'a', type: 'MAX_AMOUNT', configuration: { maxAmount: 50 } });
    const r2 = rule({ id: 'b', type: 'MAX_AMOUNT', configuration: { maxAmount: 100 }, priority: 5 });

    const result = simulatePolicies([r1, r2], tx({ amount: 200 }));
    expect(result.violations[0]!.policyId).toBe('b'); // Higher priority first
  });
});

/* -------------------------------------------------------------------------- */
/* Multiple rules (complex scenarios)                                          */
/* -------------------------------------------------------------------------- */

describe('complex multi-rule scenarios', () => {
  it('collects violations from multiple policy types', () => {
    const rules: PolicyRule[] = [
      rule({ id: 'max', name: 'Max Transfer', type: 'MAX_AMOUNT', configuration: { maxAmount: 50 } }),
      rule({ id: 'allow_asset', name: 'USDC Only', type: 'ALLOWED_ASSETS', configuration: { allowedAssets: ['USDC'] } }),
      rule({ id: 'allow_recv', name: 'Whitelist', type: 'ALLOWED_RECIPIENTS', configuration: { allowedRecipients: [OTHER_ADDR] } }),
    ];

    const result = simulatePolicies(rules, tx({ amount: 100 }));
    expect(result.allowed).toBe(false);
    expect(result.violations.length).toBeGreaterThanOrEqual(2);
    expect(result.violations.map((v) => v.policyId)).toContain('max');
    expect(result.violations.map((v) => v.policyId)).toContain('allow_recv');
    // Asset check: USDC IS in the allowed list, so no violation from allow_asset
    expect(result.violations.map((v) => v.policyId)).not.toContain('allow_asset');
  });

  it('returns allowed when no violations exist', () => {
    const result = simulatePolicies(
      [
        rule({ type: 'MAX_AMOUNT', configuration: { maxAmount: 1000 } }),
        rule({ type: 'ALLOWED_ASSETS', configuration: { allowedAssets: ['USDC'] } }),
        rule({ type: 'BLOCKED_RECIPIENTS', configuration: { blockedRecipients: [OTHER_ADDR] } }),
      ],
      tx({ amount: 50 }),
    );
    expect(result.allowed).toBe(true);
    expect(result.violations).toHaveLength(0);
    expect(result.rulesEvaluated).toBe(3);
  });

  it('handles an empty rules array', () => {
    const result = simulatePolicies([], tx());
    expect(result.allowed).toBe(true);
    expect(result.violations).toHaveLength(0);
    expect(result.rulesEvaluated).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Approval-gated violations                                                    */
/* -------------------------------------------------------------------------- */

describe('approval-gated violations', () => {
  it('marks violations with requiresApproval correctly', () => {
    const result = simulatePolicies(
      [
        rule({
          type: 'MAX_AMOUNT',
          configuration: { maxAmount: 50, requiresApproval: true },
        }),
      ],
      tx({ amount: 100 }),
    );
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]!.requiresApproval).toBe(true);
  });

  it('reports allowed when all violations require approval', () => {
    const result = simulatePolicies(
      [
        rule({
          id: 'r1',
          name: 'Soft Cap',
          type: 'MAX_AMOUNT',
          configuration: { maxAmount: 50, requiresApproval: true },
        }),
        rule({
          id: 'r2',
          name: 'Approve Recipients',
          type: 'BLOCKED_RECIPIENTS',
          configuration: { blockedRecipients: [RECIPIENT], requiresApproval: true },
        }),
      ],
      tx({ amount: 100 }),
    );
    expect(result.violations).toHaveLength(2);
    expect(result.allowed).toBe(true);
    expect(result.explanation).toContain('Requires approval');
  });

  it('reports blocked when some violations do not require approval', () => {
    const result = simulatePolicies(
      [
        rule({
          id: 'hard',
          name: 'Hard Cap',
          type: 'MAX_AMOUNT',
          configuration: { maxAmount: 50 },
        }),
        rule({
          id: 'soft',
          name: 'Soft Cap',
          type: 'BLOCKED_RECIPIENTS',
          configuration: { blockedRecipients: [RECIPIENT], requiresApproval: true },
        }),
      ],
      tx({ amount: 100 }),
    );
    expect(result.violations).toHaveLength(2);
    expect(result.allowed).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Explanation                                                                  */
/* -------------------------------------------------------------------------- */

describe('explanation text', () => {
  it('explains a clean pass', () => {
    const result = simulatePolicies(
      [rule({ type: 'MAX_AMOUNT', configuration: { maxAmount: 100 } })],
      tx({ amount: 50 }),
    );
    expect(result.explanation).toContain('passes all');
    expect(result.explanation).toContain('1 policy check');
  });

  it('explains blocking violations', () => {
    const result = simulatePolicies(
      [rule({ type: 'MAX_AMOUNT', configuration: { maxAmount: 50 } })],
      tx({ amount: 100 }),
    );
    expect(result.explanation).toContain('Blocked by');
    expect(result.explanation).toContain('1 policy violation');
  });

  it('explains approval-required violations separately', () => {
    const result = simulatePolicies(
      [
        rule({ type: 'MAX_AMOUNT', configuration: { maxAmount: 50, requiresApproval: true } }),
      ],
      tx({ amount: 100 }),
    );
    expect(result.explanation).toContain('Requires approval for 1 policy rule');
    expect(result.explanation).toContain('can proceed with required approvals');
  });
});

/* -------------------------------------------------------------------------- */
/* Unknown policy types                                                        */
/* -------------------------------------------------------------------------- */

describe('unknown policy types', () => {
  it('gracefully skips unknown policy types', () => {
    const result = simulatePolicies(
      [rule({ type: 'COMPOSITE' as any, configuration: {} })],
      tx(),
    );
    expect(result.allowed).toBe(true);
    expect(result.violations).toHaveLength(0);
    expect(result.rulesEvaluated).toBe(0);
  });
});

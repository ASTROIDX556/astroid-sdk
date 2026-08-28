import { describe, expect, it } from 'vitest';

import type { Policy } from '@astroid/types';

import { simulatePolicy } from '../src/simulator.js';
import type { SimulatedTransaction } from '../src/simulator.js';

const NOW = '2026-08-28T12:00:00.000Z';

/** Build a minimal `Policy` fixture with the given overrides. */
function policy(overrides: Partial<Policy>): Policy {
  return {
    id: 'policy-1',
    organizationId: 'org-1',
    name: 'Test policy',
    type: 'MAX_AMOUNT',
    configuration: {},
    priority: 1,
    enabled: true,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

const baseTx: SimulatedTransaction = {
  asset: 'USDC',
  amount: '100',
  recipientAddress: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW',
};

describe('simulatePolicy — maximum transfer limit', () => {
  it('passes when the amount is within the maximum limit', () => {
    const result = simulatePolicy(
      [
        policy({
          id: 'p-max',
          name: 'Max 500 USDC',
          type: 'MAX_AMOUNT',
          configuration: { maxAmount: 500 },
        }),
      ],
      { ...baseTx, amount: '300' },
    );

    expect(result.passed).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it('fails when the amount exceeds the maximum limit, reporting limit and actual', () => {
    const result = simulatePolicy(
      [
        policy({
          id: 'p-max',
          name: 'Max 500 USDC',
          type: 'MAX_AMOUNT',
          configuration: { maxAmount: 500 },
        }),
      ],
      { ...baseTx, amount: '750' },
    );

    expect(result.passed).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toMatchObject({
      policyId: 'p-max',
      policyType: 'MAX_AMOUNT',
      limit: 500,
      actual: 750,
    });
  });

  it('treats numeric amounts correctly', () => {
    const result = simulatePolicy(
      [
        policy({
          type: 'MAX_AMOUNT',
          configuration: { maxAmount: 10 },
        }),
      ],
      { ...baseTx, amount: 10.5 },
    );

    expect(result.passed).toBe(false);
    expect(result.violations[0]?.actual).toBe(10.5);
  });
});

describe('simulatePolicy — daily / weekly / monthly limits', () => {
  it('fails when the transaction pushes the day over the daily limit', () => {
    const result = simulatePolicy(
      [
        policy({
          id: 'p-daily',
          name: 'Daily limit 1000',
          type: 'DAILY_BUDGET',
          configuration: { dailyLimit: 1000 },
        }),
      ],
      { ...baseTx, amount: '400', spentInWindow: '800' },
    );

    expect(result.passed).toBe(false);
    expect(result.violations[0]).toMatchObject({
      policyId: 'p-daily',
      policyType: 'DAILY_BUDGET',
      limit: 1000,
      actual: 1200,
    });
  });

  it('passes when daily spend stays within the limit', () => {
    const result = simulatePolicy(
      [
        policy({
          type: 'DAILY_BUDGET',
          configuration: { dailyLimit: 1000 },
        }),
      ],
      { ...baseTx, amount: '100', spentInWindow: '800' },
    );

    expect(result.passed).toBe(true);
  });

  it('fails for weekly and monthly limits', () => {
    const weekly = simulatePolicy(
      [policy({ type: 'WEEKLY_BUDGET', configuration: { weeklyLimit: 5000 } })],
      { ...baseTx, amount: '3000', spentInWindow: '3000' },
    );
    expect(weekly.passed).toBe(false);

    const monthly = simulatePolicy(
      [policy({ type: 'MONTHLY_BUDGET', configuration: { monthlyLimit: 10_000 } })],
      { ...baseTx, amount: '6000', spentInWindow: '6000' },
    );
    expect(monthly.passed).toBe(false);
    expect(monthly.violations[0]?.policyType).toBe('MONTHLY_BUDGET');
  });
});

describe('simulatePolicy — destination address restrictions', () => {
  const BLOCKED = 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW';
  const ALLOWED = 'GZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ';
  const OTHER = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

  it('blocks a recipient on the blocked-recipients list', () => {
    const result = simulatePolicy(
      [
        policy({
          id: 'p-block',
          name: 'Blocked addresses',
          type: 'BLOCKED_RECIPIENTS',
          configuration: { blockedRecipients: [BLOCKED] },
        }),
      ],
      { ...baseTx, recipientAddress: BLOCKED },
    );

    expect(result.passed).toBe(false);
    expect(result.violations[0]).toMatchObject({
      policyId: 'p-block',
      policyType: 'BLOCKED_RECIPIENTS',
    });
    expect(result.violations[0]?.message).toContain(BLOCKED);
  });

  it('passes when the recipient is not on the blocked list', () => {
    const result = simulatePolicy(
      [
        policy({
          type: 'BLOCKED_RECIPIENTS',
          configuration: { blockedRecipients: [BLOCKED] },
        }),
      ],
      { ...baseTx, recipientAddress: OTHER },
    );

    expect(result.passed).toBe(true);
  });

  it('fails when the recipient is missing from the allowed-recipients list', () => {
    const result = simulatePolicy(
      [
        policy({
          id: 'p-allow',
          name: 'Allowlist',
          type: 'ALLOWED_RECIPIENTS',
          configuration: { allowedRecipients: [ALLOWED] },
        }),
      ],
      { ...baseTx, recipientAddress: OTHER },
    );

    expect(result.passed).toBe(false);
    expect(result.violations[0]?.policyType).toBe('ALLOWED_RECIPIENTS');
  });

  it('passes when the recipient is on the allowed-recipients list', () => {
    const result = simulatePolicy(
      [
        policy({
          type: 'ALLOWED_RECIPIENTS',
          configuration: { allowedRecipients: [ALLOWED] },
        }),
      ],
      { ...baseTx, recipientAddress: ALLOWED },
    );

    expect(result.passed).toBe(true);
  });

  it('reports a missing recipient when an allowlist applies', () => {
    const result = simulatePolicy(
      [
        policy({
          type: 'ALLOWED_RECIPIENTS',
          configuration: { allowedRecipients: [ALLOWED] },
        }),
      ],
      { ...baseTx, recipientAddress: undefined },
    );

    expect(result.passed).toBe(false);
    expect(result.violations[0]?.message).toContain('recipient');
  });
});

describe('simulatePolicy — asset white/blacklists', () => {
  it('blocks an asset on the blocked-assets list', () => {
    const result = simulatePolicy(
      [
        policy({
          id: 'p-asset',
          name: 'No meme coins',
          type: 'BLOCKED_ASSETS',
          configuration: { blockedAssets: ['DOGE'] },
        }),
      ],
      { ...baseTx, asset: 'DOGE' },
    );

    expect(result.passed).toBe(false);
    expect(result.violations[0]).toMatchObject({
      policyId: 'p-asset',
      policyType: 'BLOCKED_ASSETS',
    });
    expect(result.violations[0]?.message).toContain('DOGE');
  });

  it('fails when the asset is not on the allowed-assets list', () => {
    const result = simulatePolicy(
      [
        policy({
          id: 'p-allow-asset',
          name: 'USDC only',
          type: 'ALLOWED_ASSETS',
          configuration: { allowedAssets: ['USDC'] },
        }),
      ],
      { ...baseTx, asset: 'BTC' },
    );

    expect(result.passed).toBe(false);
    expect(result.violations[0]?.policyType).toBe('ALLOWED_ASSETS');
  });

  it('passes when the asset is on the allowed-assets list, including code:issuer form', () => {
    const issuer = 'GBSTRH4QOTWNSVA6E4HFIRETXPB3DW4K3KX7A2Q7S3ZK5Z2H7Z6Q7K5J';
    const result = simulatePolicy(
      [
        policy({
          type: 'ALLOWED_ASSETS',
          configuration: { allowedAssets: ['USDC'] },
        }),
      ],
      { ...baseTx, asset: `USDC:${issuer}` },
    );

    expect(result.passed).toBe(true);
  });

  it('matches asset codes case-insensitively', () => {
    const result = simulatePolicy(
      [
        policy({
          type: 'ALLOWED_ASSETS',
          configuration: { allowedAssets: ['usdc'] },
        }),
      ],
      { ...baseTx, asset: 'USDC' },
    );

    expect(result.passed).toBe(true);
  });
});

describe('simulatePolicy — general behavior', () => {
  it('passes a valid transaction through the engine', () => {
    const result = simulatePolicy(
      [
        policy({ type: 'MAX_AMOUNT', configuration: { maxAmount: 1000 } }),
        policy({ type: 'ALLOWED_ASSETS', configuration: { allowedAssets: ['USDC'] } }),
        policy({
          type: 'BLOCKED_RECIPIENTS',
          configuration: {
            blockedRecipients: ['GZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ'],
          },
        }),
      ],
      { ...baseTx, amount: '250' },
    );

    expect(result.passed).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it('aggregates multiple violations across rules', () => {
    const result = simulatePolicy(
      [
        policy({ type: 'MAX_AMOUNT', configuration: { maxAmount: 100 } }),
        policy({
          type: 'ALLOWED_ASSETS',
          configuration: { allowedAssets: ['USDC'] },
        }),
      ],
      { ...baseTx, asset: 'DOGE', amount: '500' },
    );

    expect(result.passed).toBe(false);
    expect(result.violations.map((v) => v.policyType)).toEqual(['MAX_AMOUNT', 'ALLOWED_ASSETS']);
  });

  it('skips disabled policies', () => {
    const result = simulatePolicy(
      [
        policy({
          enabled: false,
          type: 'MAX_AMOUNT',
          configuration: { maxAmount: 1 },
        }),
      ],
      { ...baseTx, amount: '999' },
    );

    expect(result.passed).toBe(true);
  });

  it('does not throw for a failed simulation', () => {
    expect(() =>
      simulatePolicy([policy({ type: 'MAX_AMOUNT', configuration: { maxAmount: 1 } })], {
        ...baseTx,
        amount: '2',
      }),
    ).not.toThrow();
  });

  it('ignores policy types without a client-side evaluator', () => {
    const result = simulatePolicy([policy({ type: 'EMERGENCY_LOCK', configuration: {} })], {
      ...baseTx,
    });

    expect(result.passed).toBe(true);
  });
});

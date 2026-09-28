/**
 * Unit tests for the decoded-transaction policy simulation helper
 * (`simulatePolicyLocal`) exported by `@astroid/policy`.
 *
 * Complements the `PolicyResource.simulatePolicy` API tests in `policy.test.ts`
 * by covering the local, payload-based evaluation path used inside agent
 * pipelines.
 */

import { describe, expect, it } from 'vitest';

import type { Policy } from '@astroid/types';

import { simulatePolicyLocal } from '../src/simulator.js';
import type { DecodedTxPayload } from '../src/simulator.js';

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

function decoded(overrides: Partial<DecodedTxPayload> = {}): DecodedTxPayload {
  return {
    sourceAccount: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    operations: [
      {
        type: 'payment',
        destination: 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
        asset: 'USDC',
        amount: '100',
      },
    ],
    ...overrides,
  };
}

describe('simulatePolicyLocal — passing simulations', () => {
  it('passes a transaction that satisfies every active policy', () => {
    const result = simulatePolicyLocal(decoded(), [
      policy({ type: 'MAX_AMOUNT', configuration: { maxAmount: 500 } }),
      policy({ type: 'ALLOWED_ASSETS', configuration: { allowedAssets: ['USDC'] } }),
      policy({
        type: 'BLOCKED_RECIPIENTS',
        configuration: { blockedRecipients: ['GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC'] },
      }),
    ]);

    expect(result.passed).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it('skips disabled policies', () => {
    const result = simulatePolicyLocal(decoded({ operations: [{ type: 'payment', asset: 'DOGE', amount: '9999' }] }), [
      policy({ enabled: false, type: 'MAX_AMOUNT', configuration: { maxAmount: 1 } }),
      policy({ enabled: false, type: 'ALLOWED_ASSETS', configuration: { allowedAssets: ['USDC'] } }),
    ]);

    expect(result.passed).toBe(true);
  });
});

describe('simulatePolicyLocal — failing simulations', () => {
  it('flags an asset that is not on the allowlist', () => {
    const result = simulatePolicyLocal(
      decoded({ operations: [{ type: 'payment', asset: 'DOGE', amount: '10' }] }),
      [policy({ id: 'p-asset', type: 'ALLOWED_ASSETS', configuration: { allowedAssets: ['USDC', 'XLM'] } })],
    );

    expect(result.passed).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toMatchObject({ policyId: 'p-asset', policyType: 'ALLOWED_ASSETS' });
    expect(result.violations[0]?.message).toContain('DOGE');
  });

  it('flags an amount above the configured maximum, reporting limit and actual', () => {
    const result = simulatePolicyLocal(
      decoded({ operations: [{ type: 'payment', asset: 'USDC', amount: '750' }] }),
      [policy({ id: 'p-max', name: 'Max 500', type: 'MAX_AMOUNT', configuration: { maxAmount: 500 } })],
    );

    expect(result.passed).toBe(false);
    expect(result.violations[0]).toMatchObject({
      policyId: 'p-max',
      policyType: 'MAX_AMOUNT',
      limit: 500,
      actual: 750,
    });
  });

  it('flags a blocked destination', () => {
    const blocked = 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
    const result = simulatePolicyLocal(decoded(), [
      policy({
        id: 'p-block',
        type: 'BLOCKED_RECIPIENTS',
        configuration: { blockedRecipients: [blocked] },
      }),
    ]);

    expect(result.passed).toBe(false);
    expect(result.violations[0]).toMatchObject({ policyId: 'p-block', policyType: 'BLOCKED_RECIPIENTS' });
  });

  it('reports every breached rule across multiple policies', () => {
    const blocked = 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
    const result = simulatePolicyLocal(decoded(), [
      policy({ id: 'p-max', type: 'MAX_AMOUNT', configuration: { maxAmount: 50 } }),
      policy({
        id: 'p-block',
        type: 'BLOCKED_RECIPIENTS',
        configuration: { blockedRecipients: [blocked] },
      }),
    ]);

    expect(result.passed).toBe(false);
    expect(result.violations.map((v) => v.policyId)).toEqual(['p-max', 'p-block']);
  });
});

describe('simulatePolicyLocal — malformed input is tolerated', () => {
  it('returns a passing report for an empty operations array', () => {
    const result = simulatePolicyLocal(decoded({ operations: [] }), [
      policy({ type: 'MAX_AMOUNT', configuration: { maxAmount: 1 } }),
    ]);

    expect(result.passed).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it('does not throw when the payload is missing operations', () => {
    const result = simulatePolicyLocal({} as DecodedTxPayload, [
      policy({ type: 'MAX_AMOUNT', configuration: { maxAmount: 1 } }),
    ]);

    expect(result).toEqual({ passed: true, violations: [] });
  });
});

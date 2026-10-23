import { describe, expect, it, vi } from 'vitest';

import type { AstroidResponse } from '@astroid/core';
import { NetworkError } from '@astroid/errors';
import type { PolicySimulationRequest, PolicySimulationResult } from '@astroid/types';

import {
  POLICY_SIMULATE_PATH,
  simulatePolicy,
  type PolicySimulationHttpClient,
} from '../src/simulate-policy.js';

/** Build an `AstroidResponse` envelope around a data payload. */
function response<T>(data: T): AstroidResponse<T> {
  return { data, meta: undefined, requestId: undefined, status: 200, headers: new Headers() };
}

/**
 * A minimal `PolicySimulationHttpClient` mock that records every request it
 * receives, so tests can assert on the serialized path and body.
 */
function mockTransport(
  handler: (body: unknown) => Promise<unknown> | unknown,
): { client: PolicySimulationHttpClient; calls: Array<{ path: string; body?: unknown }> } {
  const calls: Array<{ path: string; body?: unknown }> = [];
  const client: PolicySimulationHttpClient = {
    async post<TData>(path: string, body?: unknown): Promise<AstroidResponse<TData>> {
      calls.push({ path, body });
      return response<TData>((await handler(body)) as TData);
    },
  };
  return { client, calls };
}

const ALLOWED: PolicySimulationResult = {
  allowed: true,
  violations: [],
  requiredApprovals: [],
  risk: { score: 0.04, band: 'LOW', factors: [] },
  budgetImpact: [],
  explanation: 'Transfer is within policy limits.',
};

const REJECTED: PolicySimulationResult = {
  allowed: false,
  violations: [
    {
      policyId: 'pol_max',
      policyType: 'MAX_AMOUNT',
      message: 'Transfer amount 750 exceeds the maximum allowed limit of 500 USDC.',
      limit: 500,
      actual: 750,
    },
  ],
  requiredApprovals: ['owner'],
  risk: { score: 0.82, band: 'HIGH', factors: [] },
  budgetImpact: [],
  explanation: 'Transfer is blocked by 1 active policy.',
};

describe('simulatePolicy — server-side endpoint helper', () => {
  it('POSTs the request body to /policies/simulate and returns the result', async () => {
    const { client, calls } = mockTransport(() => ALLOWED);

    const input: PolicySimulationRequest = {
      walletId: 'w_1',
      asset: 'USDC',
      amount: '150',
      recipientAddress: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW',
      policyIds: ['pol_max'],
      spentInWindow: '50',
    };

    const result = await simulatePolicy(client, input);

    expect(result).toEqual(ALLOWED);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.path).toBe('/policies/simulate');
    expect(calls[0]!.path).toBe(POLICY_SIMULATE_PATH);
    expect(calls[0]!.body).toEqual(input);
  });

  it('serializes the transaction payload and every policy-rule selector', async () => {
    const { client, calls } = mockTransport(() => ALLOWED);

    await simulatePolicy(client, {
      agentId: 'ag_1',
      asset: 'XLM',
      amount: 10,
      senderAddress: 'GSOURCE',
      memo: 'payout',
      policyIds: ['pol_a', 'pol_b'],
    });

    expect(calls[0]!.body).toEqual({
      agentId: 'ag_1',
      asset: 'XLM',
      amount: 10,
      senderAddress: 'GSOURCE',
      memo: 'payout',
      policyIds: ['pol_a', 'pol_b'],
    });
  });

  it('returns a rejection as a normal, structured result (allowed: false)', async () => {
    const { client } = mockTransport(() => REJECTED);

    const result = await simulatePolicy(client, { walletId: 'w_1', asset: 'USDC', amount: '750' });

    expect(result.allowed).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toMatchObject({
      policyId: 'pol_max',
      policyType: 'MAX_AMOUNT',
      limit: 500,
      actual: 750,
    });
    expect(result.requiredApprovals).toContain('owner');
  });

  it('propagates transport failures to the caller', async () => {
    const failing: PolicySimulationHttpClient = {
      post: vi.fn(async () => {
        throw new NetworkError('Failed to fetch', { code: 'NETWORK_ERROR' });
      }),
    };

    await expect(
      simulatePolicy(failing, { walletId: 'w_1', asset: 'XLM', amount: '1' }),
    ).rejects.toBeInstanceOf(NetworkError);
  });

  describe('single-policy overload (simulatePolicy(client, policyId, payload))', () => {
    it('POSTs payload to /policies/{id}/simulate and returns PolicySimulationEvaluation', async () => {
      const mockEvaluation = {
        policyId: 'pol_123',
        allowed: true,
        passed: true,
        violations: [],
        risk: { score: 0.1, band: 'LOW', factors: [] },
        budgetImpact: [],
        explanation: 'Transaction complies with the policy.',
      };

      const { client, calls } = mockTransport(() => mockEvaluation);

      const evaluation = await simulatePolicy(client, 'pol_123', {
        asset: 'USDC',
        amount: '100.00',
        recipientAddress: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW',
      });

      expect(calls).toHaveLength(1);
      expect(calls[0]!.path).toBe('/policies/pol_123/simulate');
      expect(evaluation.policyId).toBe('pol_123');
      expect(evaluation.allowed).toBe(true);
      expect(evaluation.passed).toBe(true);
    });

    it('handles rule breaches accurately on single-policy evaluation', async () => {
      const mockBreachedEvaluation = {
        policyId: 'pol_max',
        allowed: false,
        passed: false,
        violatedRules: [
          {
            policyId: 'pol_max',
            rule: 'MAX_AMOUNT',
            message: 'Amount 1000 exceeds limit of 500',
            limit: '500',
            actual: '1000',
          },
        ],
        risk: { score: 0.85, band: 'HIGH', factors: [] },
        requiredApprovals: ['admin'],
        explanation: 'Transaction blocked by MAX_AMOUNT rule',
      };

      const { client } = mockTransport(() => mockBreachedEvaluation);

      const evaluation = await simulatePolicy(client, 'pol_max', {
        asset: 'USDC',
        amount: '1000.00',
      });

      expect(evaluation.allowed).toBe(false);
      expect(evaluation.violatedRules).toHaveLength(1);
      expect(evaluation.violatedRules[0].rule).toBe('MAX_AMOUNT');
      expect(evaluation.requiredApprovals).toContain('admin');
      expect(evaluation.riskScore).toBe(0.85);
    });

    it('throws ValidationError when policyId is blank', async () => {
      const { client } = mockTransport(() => ALLOWED);

      await expect(
        simulatePolicy(client, '   ', { asset: 'USDC', amount: '100.00' }),
      ).rejects.toThrow('policyId is required');
    });

    it('throws ValidationError when transaction amount is invalid', async () => {
      const { client } = mockTransport(() => ALLOWED);

      await expect(
        simulatePolicy(client, 'pol_1', { asset: 'USDC', amount: -50 }),
      ).rejects.toThrow('positive finite number');
    });
  });
});

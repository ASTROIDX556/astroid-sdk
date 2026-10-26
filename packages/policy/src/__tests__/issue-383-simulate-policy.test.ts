import { describe, it, expect, vi } from 'vitest';
import {
  simulatePolicy,
  POLICY_SIMULATE_PATH,
  type PolicySimulationHttpClient,
} from '../simulate-policy.js';
import type { PolicySimulationRequest, PolicySimulationResult } from '@astroid/types';

describe('Issue #383 — Policy simulation endpoint helper in @astroid/policy', () => {
  it('calls simulatePolicy with client and typed request, returning allowance status and violations', async () => {
    const mockResult: PolicySimulationResult = {
      allowed: true,
      violations: [],
      requiredApprovals: [],
      risk: { score: 0.1, band: 'LOW', factors: [] },
      budgetImpact: [],
      explanation: 'Transfer is permitted.',
    };

    const mockClient: PolicySimulationHttpClient = {
      post: vi.fn().mockResolvedValue({
        status: 200,
        data: mockResult,
        headers: new Headers(),
      }),
    };

    const request: PolicySimulationRequest = {
      walletId: 'w_test_1',
      asset: 'XLM',
      amount: '100',
      recipientAddress: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
      policyIds: ['pol_test_1'],
    };

    const result = await simulatePolicy(mockClient, request);

    expect(mockClient.post).toHaveBeenCalledWith(POLICY_SIMULATE_PATH, request, undefined);
    expect(result.allowed).toBe(true);
    expect(result.explanation).toBe('Transfer is permitted.');
  });

  it('correctly handles policy simulation denials with rule violations', async () => {
    const mockResult: PolicySimulationResult = {
      allowed: false,
      violations: [
        {
          policyId: 'pol_test_2',
          policyType: 'MAX_AMOUNT',
          message: 'Transfer amount exceeds maximum allowed limit',
          limit: 100,
          actual: 500,
        },
      ],
      requiredApprovals: ['admin'],
      risk: { score: 0.85, band: 'HIGH', factors: [] },
      budgetImpact: [],
      explanation: 'Transfer rejected due to policy breach.',
    };

    const mockClient: PolicySimulationHttpClient = {
      post: vi.fn().mockResolvedValue({
        status: 200,
        data: mockResult,
        headers: new Headers(),
      }),
    };

    const request: PolicySimulationRequest = {
      walletId: 'w_test_1',
      asset: 'USDC',
      amount: '500',
      recipientAddress: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
      policyIds: ['pol_test_2'],
    };

    const result = await simulatePolicy(mockClient, request);

    expect(result.allowed).toBe(false);
    expect(result.violations.length).toBe(1);
    expect(result.violations[0]?.policyId).toBe('pol_test_2');
    expect(result.requiredApprovals).toContain('admin');
  });

  it('supports single-policy simulation via simulatePolicy(policyId, payload, client)', async () => {
    const mockEvaluation = {
      allowed: true,
      policyId: 'pol_123',
      risk: { score: 0.05, band: 'LOW', factors: [] },
      violatedRules: [],
      explanation: 'Single policy simulation permitted.',
    };

    const mockClient: PolicySimulationHttpClient = {
      post: vi.fn().mockResolvedValue({
        status: 200,
        data: mockEvaluation,
        headers: new Headers(),
      }),
    };

    const result = await simulatePolicy('pol_123', {
      asset: 'XLM',
      amount: '50',
      recipientAddress: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
    }, mockClient);

    expect(result.allowed).toBe(true);
    expect(mockClient.post).toHaveBeenCalledWith(
      '/policies/pol_123/simulate',
      expect.objectContaining({
        asset: 'XLM',
        amount: '50',
      }),
      undefined,
    );
  });
});

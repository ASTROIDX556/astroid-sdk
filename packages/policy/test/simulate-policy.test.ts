import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ValidationError } from '@astroid/errors';
import type { PolicySimulationInput } from '@astroid/types';
import { simulatePolicy } from '../src/index.js';

describe('simulatePolicy — policy evaluation helper (#459)', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const validPayload: PolicySimulationInput = {
    asset: 'USDC',
    amount: '100',
    recipientAddress: 'GBTYP6STUV6PLZX2WOBP2MASVABW72U3NLFUP7T5C5K5EIKQ6T7C6XUI',
  };

  it('exports simulatePolicy and evaluates an allowed transaction via mocked HTTP fetch', async () => {
    const mockAllowedResponse = {
      policyId: 'pol_123',
      allowed: true,
      violations: [],
      violatedRules: [],
      riskScore: 0.1,
      risk: {
        score: 0.1,
        band: 'LOW',
        factors: [],
      },
      requiredApprovals: [],
      budgetImpact: [
        {
          budgetId: 'bud_1',
          allocated: '1000',
          spentBefore: '200',
          spentAfter: '300',
        },
      ],
      explanation: 'Transfer complies with the policy.',
    };

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(mockAllowedResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    globalThis.fetch = fetchMock;

    const result = await simulatePolicy('pol_123', validPayload);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [requestUrl, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(requestUrl).toContain('/policies/pol_123/simulate');
    expect(requestInit.method).toBe('POST');
    expect(JSON.parse(requestInit.body as string)).toEqual(validPayload);

    expect(result.allowed).toBe(true);
    expect(result.passed).toBe(true);
    expect(result.violatedRules).toEqual([]);
    expect(result.riskScore).toBe(0.1);
    expect(result.risk.band).toBe('LOW');
    expect(result.policyId).toBe('pol_123');
  });

  it('evaluates rule violations and returns strongly-typed breach details', async () => {
    const mockViolatedResponse = {
      policyId: 'pol_limit_50',
      allowed: false,
      violations: [
        {
          rule: 'MAX_AMOUNT',
          policyId: 'pol_limit_50',
          policyType: 'MAX_AMOUNT',
          message: 'Requested amount 100 exceeds maximum per-transaction limit of 50 USDC.',
          limit: 50,
          actual: 100,
        },
      ],
      violatedRules: [
        {
          rule: 'MAX_AMOUNT',
          policyId: 'pol_limit_50',
          policyType: 'MAX_AMOUNT',
          message: 'Requested amount 100 exceeds maximum per-transaction limit of 50 USDC.',
          limit: 50,
          actual: 100,
        },
      ],
      riskScore: 0.85,
      risk: {
        score: 0.85,
        band: 'CRITICAL',
        factors: ['EXCEEDS_SINGLE_TX_LIMIT'],
      },
      requiredApprovals: ['compliance_officer'],
      explanation: 'Transaction is blocked by 1 policy rule.',
    };

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(mockViolatedResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    globalThis.fetch = fetchMock;

    const result = await simulatePolicy('pol_limit_50', validPayload);

    expect(result.allowed).toBe(false);
    expect(result.passed).toBe(false);
    expect(result.violatedRules).toHaveLength(1);
    expect(result.violatedRules[0]?.rule).toBe('MAX_AMOUNT');
    expect(result.violatedRules[0]?.message).toContain('Requested amount 100 exceeds');
    expect(result.violatedRules[0]?.limit).toBe(50);
    expect(result.violatedRules[0]?.actual).toBe(100);
    expect(result.requiredApprovals).toEqual(['compliance_officer']);
    expect(result.risk.band).toBe('CRITICAL');
  });

  it('supports passing custom PolicySimulationHttpClient transport', async () => {
    const customClient = {
      post: vi.fn().mockResolvedValue({
        data: {
          policyId: 'pol_custom',
          allowed: true,
          violations: [],
          violatedRules: [],
          risk: { score: 0.05, band: 'LOW', factors: [] },
          requiredApprovals: [],
        },
        status: 200,
        headers: new Headers(),
      }),
    };

    const result = await simulatePolicy('pol_custom', validPayload, customClient);

    expect(customClient.post).toHaveBeenCalledWith(
      '/policies/pol_custom/simulate',
      validPayload,
      undefined,
    );
    expect(result.allowed).toBe(true);
    expect(result.policyId).toBe('pol_custom');
  });

  it('throws ValidationError when policyId is missing or empty', async () => {
    await expect(simulatePolicy('', validPayload)).rejects.toThrow(ValidationError);
    await expect(simulatePolicy('   ', validPayload)).rejects.toThrow(ValidationError);
  });

  it('throws ValidationError when simulation payload contains invalid amount', async () => {
    const invalidPayload = {
      asset: 'USDC',
      amount: '-50', // Negative amounts not allowed
      recipientAddress: 'GBTYP6STUV6PLZX2WOBP2MASVABW72U3NLFUP7T5C5K5EIKQ6T7C6XUI',
    } as unknown as PolicySimulationInput;

    await expect(simulatePolicy('pol_123', invalidPayload)).rejects.toThrow(ValidationError);
  });
});

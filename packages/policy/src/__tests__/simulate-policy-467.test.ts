import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HttpClient } from '@astroid/core';
import { ValidationError } from '@astroid/errors';
import { simulatePolicy, PolicyResource } from '../index.js';
import type { PolicySimulationInput } from '@astroid/types';

describe('Policy Simulation and Input Validation Wrapper (Issue #467)', () => {
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

  it('exports strongly-typed simulatePolicy from @astroid/policy entrypoint', () => {
    expect(typeof simulatePolicy).toBe('function');
  });

  it('validates simulation request payloads and rejects malformed inputs with ValidationError before HTTP call', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;

    // Blank policyId
    await expect(simulatePolicy('', validPayload)).rejects.toThrow(ValidationError);
    await expect(simulatePolicy('   ', validPayload)).rejects.toThrow(ValidationError);

    // Negative / non-positive amount
    await expect(
      simulatePolicy('pol_1', {
        ...validPayload,
        amount: '-10',
      }),
    ).rejects.toThrow(ValidationError);

    // Empty asset
    await expect(
      simulatePolicy('pol_1', {
        ...validPayload,
        asset: '',
      }),
    ).rejects.toThrow(ValidationError);

    // Verify fetch was never called due to client-side validation
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('evaluates successful policy simulation via mocked fetch', async () => {
    const mockAllowedResponse = {
      policyId: 'pol_100',
      allowed: true,
      violations: [],
      violatedRules: [],
      riskScore: 0.1,
      risk: { score: 0.1, band: 'LOW', factors: [] },
      requiredApprovals: [],
    };

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(mockAllowedResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    globalThis.fetch = fetchMock;

    const result = await simulatePolicy('pol_100', validPayload);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.allowed).toBe(true);
    expect(result.passed).toBe(true);
    expect(result.violatedRules).toEqual([]);
    expect(result.risk.band).toBe('LOW');
  });

  it('evaluates policy violation response correctly', async () => {
    const mockViolationResponse = {
      policyId: 'pol_100',
      allowed: false,
      violations: [
        {
          rule: 'MAX_AMOUNT',
          policyId: 'pol_100',
          policyType: 'MAX_AMOUNT',
          message: 'Requested amount 100 exceeds limit of 50 USDC.',
          limit: 50,
          actual: 100,
        },
      ],
      violatedRules: [
        {
          rule: 'MAX_AMOUNT',
          policyId: 'pol_100',
          policyType: 'MAX_AMOUNT',
          message: 'Requested amount 100 exceeds limit of 50 USDC.',
          limit: 50,
          actual: 100,
        },
      ],
      riskScore: 0.9,
      risk: { score: 0.9, band: 'HIGH', factors: ['EXCEEDED_LIMIT'] },
      requiredApprovals: ['supervisor'],
    };

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(mockViolationResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    globalThis.fetch = fetchMock;

    const result = await simulatePolicy('pol_100', validPayload);

    expect(result.allowed).toBe(false);
    expect(result.passed).toBe(false);
    expect(result.violatedRules).toHaveLength(1);
    expect(result.violatedRules[0]!.rule).toBe('MAX_AMOUNT');
    expect(result.requiredApprovals).toContain('supervisor');
  });

  it('supports invocation through PolicyResource method', async () => {
    const client = new HttpClient({});
    const resource = new PolicyResource(client);

    const postSpy = vi.spyOn(client, 'post').mockResolvedValue({
      data: {
        policyId: 'pol_resource',
        allowed: true,
        violations: [],
        violatedRules: [],
        risk: { score: 0, band: 'LOW', factors: [] },
        requiredApprovals: [],
      },
      status: 200,
      headers: new Headers(),
      meta: {},
      requestId: 'req_123',
    });

    const result = await resource.simulatePolicy('pol_resource', validPayload);

    expect(postSpy).toHaveBeenCalledWith(
      '/policies/pol_resource/simulate',
      validPayload,
      undefined,
    );
    expect(result.allowed).toBe(true);
  });
});

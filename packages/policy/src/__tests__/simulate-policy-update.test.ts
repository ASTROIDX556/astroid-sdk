import { describe, expect, it, vi } from 'vitest';

import { HttpClient } from '@astroid/core';
import { NetworkError, ValidationError } from '@astroid/errors';
import type { PolicyUpdateSimulationRequest, PolicyUpdateSimulationResult } from '@astroid/types';

import { POLICY_SIMULATE_UPDATE_PATH } from '../simulate-policy-update.js';
import { PolicyResource } from '../index.js';

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

/** HTTP 200 response carrying an enveloped `data` payload. */
function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ success: true, data }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * Build a `PolicyResource` backed by the given fetch mock, mirroring the
 * helper used by `packages/policy/__tests__/policy.test.ts`. The resource's
 * own `simulatePolicyUpdate` method supplies the transport, which is exactly
 * how the helper is wired in production.
 */
function resource(fetchImpl: typeof fetch): {
  policies: PolicyResource;
  fetch: ReturnType<typeof vi.fn>;
} {
  const fetchMock = vi.fn(fetchImpl);
  const http = new HttpClient({
    apiKey: 'sk_test',
    baseUrl: 'https://api.example.test',
    retry: false,
    fetch: fetchMock as unknown as typeof fetch,
  });
  return { policies: new PolicyResource(http), fetch: fetchMock };
}

const REQUEST: PolicyUpdateSimulationRequest = {
  policyId: 'pol_max',
  proposedRule: {
    name: 'max-250',
    allowedRecipients: ['GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW'],
  },
  transactions: [
    {
      asset: 'USDC',
      amount: '150',
      recipientAddress: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW',
    },
    { asset: 'XLM', amount: 5 },
  ],
  walletId: 'w_1',
};

const VALID: PolicyUpdateSimulationResult = {
  valid: true,
  passed: true,
  outcomes: [
    {
      transactionIndex: 0,
      allowed: true,
      passedRules: ['max-250'],
      violatedConstraints: [],
    },
    {
      transactionIndex: 1,
      allowed: true,
      passedRules: ['max-250'],
      violatedConstraints: [],
    },
  ],
  passedRules: ['max-250'],
  violatedConstraints: [],
  estimatedImpact: {
    evaluatedTransactionCount: 2,
    blockedTransactionCount: 0,
    blockedRatio: 0,
  },
  explanation: 'Proposed rule passes every one of the 2 historical transactions.',
};

const INVALID: PolicyUpdateSimulationResult = {
  valid: false,
  passed: false,
  outcomes: [
    {
      transactionIndex: 0,
      allowed: true,
      passedRules: ['max-250'],
      violatedConstraints: [],
    },
    {
      transactionIndex: 1,
      allowed: false,
      passedRules: [],
      violatedConstraints: [
        {
          rule: 'max-250',
          check: 'address',
          success: false,
          explanation: 'Recipient GDESTINATION is not on the proposed allowlist of max-250.',
        },
      ],
    },
  ],
  passedRules: [],
  violatedConstraints: [
    {
      rule: 'max-250',
      check: 'address',
      success: false,
      explanation: 'Recipient GDESTINATION is not on the proposed allowlist of max-250.',
    },
  ],
  estimatedImpact: {
    evaluatedTransactionCount: 2,
    blockedTransactionCount: 1,
    blockedRatio: 0.5,
  },
  explanation: 'The proposed rule would have blocked 1 of 2 historical transactions.',
};

/* -------------------------------------------------------------------------- */
/* simulatePolicyUpdate — endpoint helper                                      */
/* -------------------------------------------------------------------------- */

describe('simulatePolicyUpdate — successful simulation (issue #249)', () => {
  it('POSTs the payload to /policies/simulate-update and returns the parsed result', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(VALID));
    const { policies } = resource(fetchMock as unknown as typeof fetch);

    const result = await policies.simulatePolicyUpdate(REQUEST);

    expect(result).toEqual(VALID);
    expect(result.valid).toBe(true);
    expect(result.passed).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.example.test/v1/policies/simulate-update');
    expect(JSON.parse(String(init.body))).toEqual(REQUEST);
  });

  it('exposes POLICY_SIMULATE_UPDATE_PATH matching the dispatched endpoint', () => {
    expect(POLICY_SIMULATE_UPDATE_PATH).toBe('/policies/simulate-update');
  });
});

describe('simulatePolicyUpdate — rule violation scenarios (issue #249)', () => {
  it('resolves with valid:false, violated constraints and estimated impact (not an error)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(INVALID));
    const { policies } = resource(fetchMock as unknown as typeof fetch);

    const result = await policies.simulatePolicyUpdate(REQUEST);

    expect(result.valid).toBe(false);
    expect(result.passed).toBe(false);
    expect(result.violatedConstraints).toHaveLength(1);
    expect(result.violatedConstraints[0]!.rule).toBe('max-250');
    expect(result.violatedConstraints[0]!.success).toBe(false);
    expect(result.estimatedImpact).toEqual({
      evaluatedTransactionCount: 2,
      blockedTransactionCount: 1,
      blockedRatio: 0.5,
    });
    expect(result.outcomes[1]!.violatedConstraints[0]!.explanation).toContain(
      'not on the proposed allowlist',
    );
  });

  it('propagates transport failures as typed errors', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('network down'));
    const { policies } = resource(fetchMock as unknown as typeof fetch);

    await expect(policies.simulatePolicyUpdate(REQUEST)).rejects.toBeInstanceOf(NetworkError);
  });
});

/* -------------------------------------------------------------------------- */
/* Strict input validation                                                     */
/* -------------------------------------------------------------------------- */

describe('simulatePolicyUpdate — strict input validation (issue #249)', () => {
  it.each([
    ['missing policyId', { ...REQUEST, policyId: undefined }],
    ['blank policyId', { ...REQUEST, policyId: '   ' }],
    ['missing proposedRule', { ...REQUEST, proposedRule: undefined }],
    ['proposedRule without a name', { ...REQUEST, proposedRule: { allowedRecipients: ['GABC'] } }],
    [
      'proposedRule with non-string allowlist entries',
      { ...REQUEST, proposedRule: { name: 'r', allowedRecipients: ['GABC', 42] } },
    ],
    [
      'proposedRule with a negative signature weight',
      { ...REQUEST, proposedRule: { name: 'r', requiredSignatures: -1 } },
    ],
    ['missing transactions', { ...REQUEST, transactions: undefined }],
    ['empty transactions', { ...REQUEST, transactions: [] }],
    ['transaction without an asset', { ...REQUEST, transactions: [{ amount: 5 }] }],
    [
      'transaction with a non-finite amount',
      { ...REQUEST, transactions: [{ asset: 'USDC', amount: Number.NaN }] },
    ],
    ['blank walletId', { ...REQUEST, walletId: '' }],
    ['blank agentId', { ...REQUEST, agentId: '  ' }],
    ['non-object metadata', { ...REQUEST, metadata: 'nope' }],
  ])('throws ValidationError for %s without contacting the API', async (_label, bad) => {
    const fetchMock = vi.fn();
    const { policies } = resource(fetchMock as unknown as typeof fetch);

    await expect(
      policies.simulatePolicyUpdate(bad as unknown as PolicyUpdateSimulationRequest),
    ).rejects.toBeInstanceOf(ValidationError);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('names the offending field in the error details', async () => {
    const { policies } = resource(vi.fn() as unknown as typeof fetch);

    const err = await policies
      .simulatePolicyUpdate({ ...REQUEST, policyId: '' })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).details).toMatchObject({ field: 'policyId' });
  });
});

/* -------------------------------------------------------------------------- */
/* Exports                                                                     */
/* -------------------------------------------------------------------------- */

describe('module exports (issue #249)', () => {
  it('exports the helper, validator and path constant from the package root', async () => {
    const mod = await import('../index.js');
    expect(typeof mod.simulatePolicyUpdate).toBe('function');
    expect(typeof mod.validatePolicyUpdateSimulationInput).toBe('function');
    expect(mod.POLICY_SIMULATE_UPDATE_PATH).toBe('/policies/simulate-update');
  });

  it('exports a working simulatePolicyUpdate resource method', async () => {
    const mod = await import('../index.js');
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(VALID));
    const { policies } = resource(fetchMock as unknown as typeof fetch);

    expect(typeof mod.PolicyResource.prototype.simulatePolicyUpdate).toBe('function');
    const result = await policies.simulatePolicyUpdate(REQUEST);
    expect(result.valid).toBe(true);
  });
});

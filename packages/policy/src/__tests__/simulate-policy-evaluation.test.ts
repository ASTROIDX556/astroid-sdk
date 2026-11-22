/**
 * Verification tests for the `simulatePolicyEvaluation` export (issue #547).
 *
 * `simulatePolicyEvaluation` is the single-policy server-side simulation helper
 * (`POST /policies/{id}/simulate`). These tests pin its public surface from
 * the `@astroid/policy` entrypoint: correct request payload, successful
 * response parsing, policy-rejection handling, missing-policy-id and
 * malformed-payload/response failures.
 */

import { describe, it, expect, vi } from 'vitest';
import { ValidationError } from '@astroid/errors';
import { simulatePolicyEvaluation } from '../index.js';
import type { PolicySimulationEvaluation, PolicySimulationInput } from '@astroid/types';
import type { PolicySimulationHttpClient } from '../simulate-policy.js';

/** A minimal, always-valid transaction payload. */
const VALID_INPUT: PolicySimulationInput = {
  asset: 'XLM',
  amount: '10',
  recipientAddress: 'GBTYP6STUV6PLZX2WOBP2MASVABW72U3NLFUP7T5C5K5EIKQ6T7C6XUI',
};

/** Build a mock transport satisfying {@link PolicySimulationHttpClient}. */
function mockClient(data: unknown) {
  return {
    post: vi.fn().mockResolvedValue({ status: 200, data, headers: new Headers() }),
  };
}

describe('simulatePolicyEvaluation (issue #547, @astroid/policy entrypoint)', () => {
  it('exports simulatePolicyEvaluation as a function', () => {
    expect(typeof simulatePolicyEvaluation).toBe('function');
  });

  it('posts the validated payload to /policies/{id}/simulate and parses a successful response', async () => {
    const data: PolicySimulationEvaluation = {
      policyId: 'pol_1',
      allowed: true,
      passed: true,
      violatedRules: [],
      riskScore: 0,
      risk: { score: 0, band: 'LOW', factors: [] },
      requiredApprovals: [],
      budgetImpact: [],
      explanation: 'Allowed.',
    };
    const client = mockClient(data);

    const result = await simulatePolicyEvaluation(
      client as PolicySimulationHttpClient,
      'pol_1',
      VALID_INPUT,
    );

    expect(client.post).toHaveBeenCalledWith('/policies/pol_1/simulate', VALID_INPUT, undefined);
    expect(result).toEqual(data);
    expect(result.policyId).toBe('pol_1');
    expect(result.allowed).toBe(true);
  });

  it('resolves a policy rejection (denial) instead of throwing', async () => {
    const client = mockClient({
      policyId: 'pol_2',
      allowed: false,
      passed: false,
      violatedRules: [{ policyId: 'pol_2', rule: 'MAX_AMOUNT', message: 'Too large.' }],
      riskScore: 0.9,
      risk: { score: 0.9, band: 'HIGH', factors: [] },
      requiredApprovals: [],
      budgetImpact: [],
      explanation: 'Denied.',
    });

    const result = await simulatePolicyEvaluation(
      client as PolicySimulationHttpClient,
      'pol_2',
      VALID_INPUT,
    );

    expect(result.allowed).toBe(false);
    expect(result.violatedRules[0]?.rule).toBe('MAX_AMOUNT');
  });

  it('rejects when the policy id is missing or blank, without a request', async () => {
    const client = mockClient({});

    await expect(
      simulatePolicyEvaluation(client as PolicySimulationHttpClient, '', VALID_INPUT),
    ).rejects.toThrow(ValidationError);
    await expect(
      simulatePolicyEvaluation(client as PolicySimulationHttpClient, '   ', VALID_INPUT),
    ).rejects.toThrow(ValidationError);
    expect(client.post).not.toHaveBeenCalled();
  });

  it('rejects a malformed request payload before any request is issued', async () => {
    const client = mockClient({});

    await expect(
      simulatePolicyEvaluation(client as PolicySimulationHttpClient, 'pol_1', {
        ...VALID_INPUT,
        amount: '-5',
      }),
    ).rejects.toThrow(ValidationError);
    expect(client.post).not.toHaveBeenCalled();
  });

  it('rejects a malformed response carrying no decision', async () => {
    const client = mockClient({});

    await expect(
      simulatePolicyEvaluation(client as PolicySimulationHttpClient, 'pol_1', VALID_INPUT),
    ).rejects.toMatchObject({ code: 'MALFORMED_RESPONSE' });
  });
});

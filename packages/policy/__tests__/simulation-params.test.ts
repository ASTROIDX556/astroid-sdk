import { describe, expect, it } from 'vitest';

import type { AstroidResponse } from '@astroid/core';
import { ValidationError } from '@astroid/errors';
import type { PolicySimulationResult } from '@astroid/types';

import { simulatePolicy } from '../src/simulate-policy.js';
import type { PolicySimulationHttpClient } from '../src/simulate-policy.js';
import {
  PolicySimulationBuilder,
  simulationParams,
  validatePolicySimulationParams,
} from '../src/simulation-params.js';

/** Build an `AstroidResponse` envelope around a data payload. */
function response<T>(data: T): AstroidResponse<T> {
  return { data, meta: undefined, requestId: undefined, status: 200, headers: new Headers() };
}

const RECIPIENT = 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW';

function deniedResult(asset: string, amount: string | number): PolicySimulationResult {
  return {
    allowed: false,
    violations: [
      {
        policyId: 'pol_max',
        policyType: 'MAX_AMOUNT',
        message: `Transfer amount ${amount} exceeds the maximum allowed limit of 500 ${asset}.`,
        limit: 500,
        actual: Number(amount),
      },
    ],
    requiredApprovals: ['owner'],
    risk: { score: 0.82, band: 'HIGH', factors: [] },
    budgetImpact: [],
    explanation: 'Transfer is blocked by 1 active policy.',
  };
}

describe('PolicySimulationBuilder — building a valid request', () => {
  it('assembles a fully-populated request from chained setters', () => {
    const params = PolicySimulationBuilder.create()
      .forWallet('w_1')
      .withAsset('USDC')
      .withAmount('250.50')
      .toRecipient(RECIPIENT)
      .fromSender('GSOURCE')
      .withMemo('invoice #42')
      .withSpentInWindow('50')
      .withPolicyIds('pol_1', 'pol_2')
      .withMetadata({ source: 'treasury' })
      .build();

    expect(params).toEqual({
      walletId: 'w_1',
      asset: 'USDC',
      amount: '250.50',
      recipientAddress: RECIPIENT,
      senderAddress: 'GSOURCE',
      memo: 'invoice #42',
      spentInWindow: '50',
      policyIds: ['pol_1', 'pol_2'],
      metadata: { source: 'treasury' },
    });
  });

  it('accepts numeric amounts and trims optional string fields', () => {
    const params = simulationParams()
      .forAgent('ag_1')
      .withAsset(' XLM ')
      .withAmount(10)
      .toRecipient(`  ${RECIPIENT}  `)
      .build();

    expect(params.agentId).toBe('ag_1');
    expect(params.walletId).toBeUndefined();
    expect(params.asset).toBe('XLM');
    expect(params.amount).toBe(10);
    expect(params.recipientAddress).toBe(RECIPIENT);
  });

  it('treats wallet and agent scoping as mutually exclusive, latest wins', () => {
    const params = simulationParams()
      .forWallet('w_1')
      .forAgent('ag_2')
      .withAsset('USDC')
      .withAmount('1')
      .build();

    expect(params.walletId).toBeUndefined();
    expect(params.agentId).toBe('ag_2');

    const reversed = simulationParams()
      .forAgent('ag_2')
      .forWallet('w_1')
      .withAsset('USDC')
      .withAmount('1')
      .build();

    expect(reversed.agentId).toBeUndefined();
    expect(reversed.walletId).toBe('w_1');
  });

  it('builds a code:issuer asset request unchanged', () => {
    const params = simulationParams()
      .withAsset('USDC:GBSTRH4QOTWNSVA6E4HFIRETXPB3DW4K3KX7A2Q7S3ZK5Z2H7Z6Q7K5J')
      .withAmount('0.0000001')
      .build();

    expect(params.asset).toBe('USDC:GBSTRH4QOTWNSVA6E4HFIRETXPB3DW4K3KX7A2Q7S3ZK5Z2H7Z6Q7K5J');
    expect(params.amount).toBe('0.0000001');
  });
});

describe('PolicySimulationBuilder — validation', () => {
  it('throws when asset is missing at build time', () => {
    expect(() => simulationParams().withAmount('10').build()).toThrow(ValidationError);
  });

  it('throws when asset is malformed', () => {
    expect(() =>
      simulationParams().withAsset('USDC:not-an-issuer').withAmount('10').build(),
    ).toThrow(ValidationError);
    expect(() => simulationParams().withAsset('').withAmount('10').build()).toThrow(
      ValidationError,
    );
  });

  it('throws when amount is missing, zero, negative, or not a plain decimal', () => {
    expect(() => simulationParams().withAsset('USDC').build()).toThrow(ValidationError);
    expect(() => simulationParams().withAsset('USDC').withAmount(0).build()).toThrow(
      ValidationError,
    );
    expect(() => simulationParams().withAsset('USDC').withAmount(-5).build()).toThrow(
      ValidationError,
    );
    expect(() => simulationParams().withAsset('USDC').withAmount('1e3').build()).toThrow(
      ValidationError,
    );
    expect(() => simulationParams().withAsset('USDC').withAmount('').build()).toThrow(
      ValidationError,
    );
  });

  it('throws on non-finite amounts', () => {
    expect(() => simulationParams().withAsset('USDC').withAmount(Number.NaN).build()).toThrow(
      ValidationError,
    );
    expect(() =>
      simulationParams().withAsset('USDC').withAmount(Number.POSITIVE_INFINITY).build(),
    ).toThrow(ValidationError);
  });

  it('throws on negative spentInWindow', () => {
    expect(() =>
      simulationParams().withAsset('USDC').withAmount('10').withSpentInWindow('-1').build(),
    ).toThrow(ValidationError);
  });

  it('throws on empty policyIds', () => {
    expect(() =>
      simulationParams().withAsset('USDC').withAmount('10').withPolicyIds().build(),
    ).toThrow(ValidationError);
    expect(() =>
      simulationParams().withAsset('USDC').withAmount('10').withPolicyIds('pol_1', '').build(),
    ).toThrow(ValidationError);
  });

  it('throws when both walletId and agentId are set on the same payload', () => {
    expect(() =>
      validatePolicySimulationParams({
        walletId: 'w_1',
        agentId: 'ag_1',
        asset: 'USDC',
        amount: '10',
      }),
    ).toThrow(ValidationError);
  });

  it('throws on non-object input', () => {
    expect(() => validatePolicySimulationParams(null)).toThrow(ValidationError);
    expect(() => validatePolicySimulationParams('USDC')).toThrow(ValidationError);
    expect(() => validatePolicySimulationParams([])).toThrow(ValidationError);
  });

  it('rejects an invalid metadata field', () => {
    expect(() =>
      validatePolicySimulationParams({ asset: 'USDC', amount: '10', metadata: ['nope'] }),
    ).toThrow(ValidationError);
  });
});

describe('simulationParams builder — endpoint integration', () => {
  it('POSTs the built request and returns an allowed result', async () => {
    const calls: Array<{ path: string; body?: unknown }> = [];
    const client: PolicySimulationHttpClient = {
      async post<TData>(path: string, body?: unknown): Promise<AstroidResponse<TData>> {
        calls.push({ path, body });
        return response<TData>({
          allowed: true,
          violations: [],
          requiredApprovals: [],
          risk: { score: 0.04, band: 'LOW', factors: [] },
          budgetImpact: [],
          explanation: 'Transfer is within policy limits.',
        } as TData);
      },
    };

    const result = await simulatePolicy(
      client,
      simulationParams()
        .forWallet('w_1')
        .withAsset('USDC')
        .withAmount('250')
        .toRecipient(RECIPIENT)
        .build(),
    );

    expect(result.allowed).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.path).toBe('/policies/simulate');
    expect(calls[0]!.body).toEqual({
      walletId: 'w_1',
      asset: 'USDC',
      amount: '250',
      recipientAddress: RECIPIENT,
    });
  });

  it('surfaces a denied response with the structured violation details', async () => {
    const client: PolicySimulationHttpClient = {
      async post<TData>(): Promise<AstroidResponse<TData>> {
        return response<TData>(deniedResult('USDC', '750') as TData);
      },
    };

    const result = await simulatePolicy(
      client,
      simulationParams().withAsset('USDC').withAmount('750').build(),
    );

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
});

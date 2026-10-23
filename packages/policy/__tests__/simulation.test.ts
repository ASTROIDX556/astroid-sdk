/**
 * Unit tests for the single-policy simulation helper (#84).
 *
 * Two layers are exercised against mocked API responses:
 *
 * - the transport/helper layer (`simulatePolicyEvaluation`, and the
 *   {@link PolicyResource} methods that delegate to it) — asserting the exact
 *   path, method and serialized payload;
 * - the pure parsing/validation helpers (`toPolicySimulationEvaluation`,
 *   `validatePolicySimulationInput`, the amount predicates) — covering the
 *   allow, deny and malformed-response paths.
 */

import { describe, expect, it, vi } from 'vitest';

import { HttpClient } from '@astroid/core';
import { NetworkError, NotFoundError, ValidationError } from '@astroid/errors';
import type { AstroidResponse } from '@astroid/core';
import type { PolicySimulationEvaluation, PolicySimulationInput } from '@astroid/types';

import {
  POLICY_SIMULATE_BY_ID_PATH,
  PolicyResource,
  isValidPolicySimulationAmount,
  isValidPolicySpentInWindow,
  policySimulationPath,
  riskBandForScore,
  simulatePolicyEvaluation,
  toPolicySimulationEvaluation,
  validatePolicySimulationInput,
  type PolicySimulationHttpClient,
} from '../src/index.js';

/* -------------------------------------------------------------------------- */
/* Fixtures and doubles                                                        */
/* -------------------------------------------------------------------------- */

/** HTTP 200 response carrying an enveloped `data` payload. */
function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Build a `PolicyResource` backed by the given fetch mock. */
function client(fetchImpl: typeof fetch): {
  resource: PolicyResource;
  fetch: ReturnType<typeof vi.fn>;
} {
  const fetchMock = vi.fn(fetchImpl);
  const http = new HttpClient({
    apiKey: 'sk_test',
    baseUrl: 'https://api.example.test',
    retry: false,
    fetch: fetchMock as unknown as typeof fetch,
  });
  return { resource: new PolicyResource(http), fetch: fetchMock };
}

/** A minimal `PolicySimulationHttpClient` that records the requests it receives. */
function mockTransport(handler: (body: unknown) => unknown): {
  client: PolicySimulationHttpClient;
  calls: Array<{ path: string; body?: unknown }>;
} {
  const calls: Array<{ path: string; body?: unknown }> = [];
  const transport: PolicySimulationHttpClient = {
    async post<TData>(path: string, body?: unknown): Promise<AstroidResponse<TData>> {
      calls.push({ path, body });
      return {
        data: handler(body) as TData,
        meta: undefined,
        requestId: undefined,
        status: 200,
        headers: new Headers(),
      };
    },
  };
  return { client: transport, calls };
}

const PAYLOAD: PolicySimulationInput = {
  asset: 'USDC',
  amount: '750',
  recipientAddress: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW',
};

/** The API's canonical allow payload. */
const ALLOWED_BODY = {
  allowed: true,
  violations: [],
  requiredApprovals: [],
  risk: { score: 0.05, band: 'LOW', factors: [] },
  budgetImpact: [],
  explanation: 'Transfer is within policy limits.',
};

/** The API's canonical deny payload. */
const REJECTED_BODY = {
  allowed: false,
  violations: [
    {
      policyId: 'pol_1',
      policyType: 'MAX_AMOUNT',
      message: 'Transfer amount 750 exceeds the maximum allowed limit of 500 USDC.',
      limit: 500,
      actual: 750,
    },
  ],
  requiredApprovals: ['owner'],
  risk: { score: 0.82, band: 'HIGH', factors: [] },
  budgetImpact: [{ budgetId: 'bdg_1', beforeRemaining: '1000.00', afterRemaining: '250.00' }],
  explanation: 'Transfer is blocked by 1 active policy.',
};

/* -------------------------------------------------------------------------- */
/* Request serialization                                                       */
/* -------------------------------------------------------------------------- */

describe('simulatePolicyEvaluation — request serialization', () => {
  it('POSTs the transaction payload to /policies/{id}/simulate', async () => {
    const { client: transport, calls } = mockTransport(() => ALLOWED_BODY);

    const result = await simulatePolicyEvaluation(transport, 'pol_1', PAYLOAD);

    expect(result.allowed).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.path).toBe('/policies/pol_1/simulate');
    expect(calls[0]!.body).toEqual(PAYLOAD);
  });

  it('serializes every optional transaction field verbatim', async () => {
    const { client: transport, calls } = mockTransport(() => ALLOWED_BODY);

    const input: PolicySimulationInput = {
      asset: 'USDC:GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW',
      amount: 250.5,
      senderAddress: 'GSOURCE',
      recipientAddress: 'GDESTINATION',
      memo: 'payout',
      spentInWindow: '40',
      metadata: { runId: 'run_1' },
    };

    await simulatePolicyEvaluation(transport, 'pol_1', input);

    // The body is exactly what the caller supplied: no field added, renamed or
    // dropped, and no policyId smuggled into it (it is already in the path).
    expect(calls[0]!.body).toEqual(input);
  });

  it('sends the payload as JSON over a POST to the per-policy path', async () => {
    const { resource, fetch } = client(async () => jsonResponse({ data: ALLOWED_BODY }));

    await resource.simulatePolicyAgainst('pol_1', PAYLOAD);

    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toContain('/policies/pol_1/simulate');
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse(String((init as RequestInit).body))).toEqual(PAYLOAD);
  });

  it('url-encodes a path-unsafe policy id so it cannot escape the route', async () => {
    const { resource, fetch } = client(async () => jsonResponse({ data: ALLOWED_BODY }));

    await resource.simulatePolicyAgainst('pol/../admin', PAYLOAD);

    expect(String(fetch.mock.calls[0]![0])).toContain('pol%2F..%2Fadmin');
    expect(policySimulationPath('pol/../admin')).toBe(`/policies/pol%2F..%2Fadmin/simulate`);
  });

  it('builds the path from the documented base path', () => {
    expect(POLICY_SIMULATE_BY_ID_PATH).toBe('/policies');
    expect(policySimulationPath('pol_1')).toBe('/policies/pol_1/simulate');
  });

  it('trims surrounding whitespace from the policy id', async () => {
    const { client: transport, calls } = mockTransport(() => ALLOWED_BODY);

    await simulatePolicyEvaluation(transport, '  pol_1  ', PAYLOAD);

    expect(calls[0]!.path).toBe('/policies/pol_1/simulate');
  });
});

/* -------------------------------------------------------------------------- */
/* Response handling                                                           */
/* -------------------------------------------------------------------------- */

describe('simulatePolicyEvaluation — response handling', () => {
  it('returns the allow decision, risk score and explanation', async () => {
    const { client: transport } = mockTransport(() => ALLOWED_BODY);

    const result: PolicySimulationEvaluation = await simulatePolicyEvaluation(
      transport,
      'pol_1',
      PAYLOAD,
    );

    expect(result).toEqual({
      policyId: 'pol_1',
      allowed: true,
      passed: true,
      violatedRules: [],
      riskScore: 0.05,
      risk: { score: 0.05, band: 'LOW', factors: [] },
      requiredApprovals: [],
      budgetImpact: [],
      explanation: 'Transfer is within policy limits.',
    });
  });

  it('returns a denial as a normal result with the violated rules and risk score', async () => {
    const { client: transport } = mockTransport(() => REJECTED_BODY);

    const result = await simulatePolicyEvaluation(transport, 'pol_1', PAYLOAD);

    expect(result.allowed).toBe(false);
    expect(result.passed).toBe(false);
    expect(result.violatedRules).toEqual([
      {
        policyId: 'pol_1',
        rule: 'MAX_AMOUNT',
        policyType: 'MAX_AMOUNT',
        message: 'Transfer amount 750 exceeds the maximum allowed limit of 500 USDC.',
        limit: 500,
        actual: 750,
      },
    ]);
    expect(result.riskScore).toBe(0.82);
    expect(result.risk.band).toBe('HIGH');
    expect(result.requiredApprovals).toEqual(['owner']);
    expect(result.budgetImpact).toEqual([
      { budgetId: 'bdg_1', beforeRemaining: '1000.00', afterRemaining: '250.00' },
    ]);
    expect(result.explanation).toBe('Transfer is blocked by 1 active policy.');
  });

  it('accepts the alternative decision, breach and risk spellings', async () => {
    const { client: transport } = mockTransport(() => ({
      permitted: false,
      violatedRules: [{ code: 'blocked_recipient', detail: 'Recipient is on the denylist.' }],
      riskScore: 0.5,
    }));

    const result = await simulatePolicyEvaluation(transport, 'pol_1', PAYLOAD);

    expect(result.allowed).toBe(false);
    expect(result.violatedRules).toEqual([
      { policyId: 'pol_1', rule: 'blocked_recipient', message: 'Recipient is on the denylist.' },
    ]);
    expect(result.riskScore).toBe(0.5);
    expect(result.risk.band).toBe('MEDIUM');
    expect(result.explanation).toBe('Transaction is blocked by 1 policy rule.');
  });

  it('derives the decision from the raw breach list when no flag is reported', async () => {
    const allow = await simulatePolicyEvaluation(
      mockTransport(() => ({ violations: [] })).client,
      'pol_1',
      PAYLOAD,
    );
    const deny = await simulatePolicyEvaluation(
      mockTransport(() => ({ violations: ['over the limit'] })).client,
      'pol_1',
      PAYLOAD,
    );

    expect(allow.allowed).toBe(true);
    expect(deny.allowed).toBe(false);
    expect(deny.violatedRules[0]).toMatchObject({
      policyId: 'pol_1',
      rule: 'POLICY_RULE',
      message: 'over the limit',
    });
  });

  it('honours a reported decision flag over the breach list', async () => {
    const { client: transport } = mockTransport(() => ({ allowed: true, violations: ['stale'] }));

    const result = await simulatePolicyEvaluation(transport, 'pol_1', PAYLOAD);

    expect(result.allowed).toBe(true);
  });

  it('never turns a denial into an allow when a breach entry is malformed', async () => {
    const { client: transport } = mockTransport(() => ({
      violations: [null, 42, { message: 'Blocked.' }, () => undefined],
    }));

    const result = await simulatePolicyEvaluation(transport, 'pol_1', PAYLOAD);

    expect(result.allowed).toBe(false);
    expect(result.violatedRules).toEqual([
      { policyId: 'pol_1', rule: 'POLICY_RULE', message: 'Blocked.' },
    ]);
  });

  it('preserves large decimal limits as strings rather than rounding them', async () => {
    const { client: transport } = mockTransport(() => ({
      allowed: false,
      violations: [
        { message: 'Over limit.', limit: '123456789012345678901234567890.123456789', actual: 1 },
      ],
    }));

    const result = await simulatePolicyEvaluation(transport, 'pol_1', PAYLOAD);

    expect(result.violatedRules[0]!.limit).toBe('123456789012345678901234567890.123456789');
  });

  it('reads a string risk score and clamps it into the 0..1 range', async () => {
    const { client: transport } = mockTransport(() => ({
      allowed: true,
      risk: { score: '0.42', band: 'medium' },
    }));
    const { client: outOfRange } = mockTransport(() => ({ allowed: true, riskScore: 82 }));

    const result = await simulatePolicyEvaluation(transport, 'pol_1', PAYLOAD);
    const clamped = await simulatePolicyEvaluation(outOfRange, 'pol_1', PAYLOAD);

    expect(result.riskScore).toBe(0.42);
    expect(result.risk.band).toBe('MEDIUM');
    expect(clamped.riskScore).toBe(1);
    expect(clamped.risk.band).toBe('CRITICAL');
  });

  it('defaults the risk assessment when the API reports none', async () => {
    const { client: transport } = mockTransport(() => ({ allowed: true, violations: [] }));

    const result = await simulatePolicyEvaluation(transport, 'pol_1', PAYLOAD);

    expect(result.risk).toEqual({ score: 0, band: 'LOW', factors: [] });
  });

  it('keeps well-formed risk factors and budget impacts, dropping broken entries', async () => {
    const { client: transport } = mockTransport(() => ({
      allowed: false,
      violations: ['blocked'],
      risk: {
        score: 0.7,
        band: 'HIGH',
        factors: [
          { factor: 'unusual_amount', score: 0.4, description: 'Above the rolling average.' },
          { factor: '', score: 0.1, description: 'dropped: no factor name' },
          { factor: 'no_score', description: 'dropped: no score' },
          'not-an-object',
        ],
      },
      requiredApprovals: ['owner', '', null, 7, 'finance'],
      budgetImpact: [
        { budgetId: 'bdg_1', beforeRemaining: 1000, afterRemaining: '250.00' },
        { budgetId: 'bdg_2', beforeRemaining: '10' },
        { beforeRemaining: '1', afterRemaining: '0' },
        'not-an-object',
      ],
    }));

    const result = await simulatePolicyEvaluation(transport, 'pol_1', PAYLOAD);

    expect(result.risk.factors).toEqual([
      { factor: 'unusual_amount', score: 0.4, description: 'Above the rolling average.' },
    ]);
    expect(result.requiredApprovals).toEqual(['owner', 'finance']);
    expect(result.budgetImpact).toEqual([
      { budgetId: 'bdg_1', beforeRemaining: '1000', afterRemaining: '250.00' },
    ]);
  });

  it('omits an unknown policy type instead of widening the union', async () => {
    const { client: transport } = mockTransport(() => ({
      allowed: false,
      violations: [{ policyType: 'NOT_A_POLICY_TYPE', message: 'Blocked.' }],
    }));

    const result = await simulatePolicyEvaluation(transport, 'pol_1', PAYLOAD);

    expect(result.violatedRules[0]).toEqual({
      policyId: 'pol_1',
      rule: 'POLICY_RULE',
      message: 'Blocked.',
    });
  });

  it('prefers the policy id reported by the API over the requested one', async () => {
    const { client: transport } = mockTransport(() => ({ policyId: 'pol_9', allowed: true }));

    const result = await simulatePolicyEvaluation(transport, 'pol_1', PAYLOAD);

    expect(result.policyId).toBe('pol_9');
  });
});

/* -------------------------------------------------------------------------- */
/* Fail-closed malformed responses                                            */
/* -------------------------------------------------------------------------- */

describe('simulatePolicyEvaluation — malformed responses fail closed', () => {
  const cases: Array<[string, unknown]> = [
    ['a string body', 'allowed'],
    ['a null body', null],
    ['an array body', []],
    ['a numeric body', 1],
    ['an empty object', {}],
    ['a risk block with no decision', { risk: { score: 0.9, band: 'HIGH' } }],
  ];

  for (const [label, body] of cases) {
    it(`rejects ${label} instead of reporting an allow`, async () => {
      const { client: transport } = mockTransport(() => body);

      const failing = simulatePolicyEvaluation(transport, 'pol_1', PAYLOAD);
      await expect(failing).rejects.toBeInstanceOf(ValidationError);
      await expect(failing).rejects.toThrow(/did not include|non-object/);
    });
  }

  it('tags the rejection with the MALFORMED_RESPONSE code and the policy id', async () => {
    const { client: transport } = mockTransport(() => ({}));

    try {
      await simulatePolicyEvaluation(transport, 'pol_1', PAYLOAD);
      expect.unreachable('expected the malformed response to reject');
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).code).toBe('MALFORMED_RESPONSE');
      expect((error as ValidationError).details).toMatchObject({
        field: 'response',
        policyId: 'pol_1',
        received: 'object',
      });
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Transport failures                                                          */
/* -------------------------------------------------------------------------- */

describe('simulatePolicyEvaluation — transport failures', () => {
  it('propagates a network failure as a NetworkError', async () => {
    const { resource } = client(async () => {
      throw new TypeError('Failed to fetch');
    });

    await expect(resource.simulatePolicyAgainst('pol_1', PAYLOAD)).rejects.toBeInstanceOf(
      NetworkError,
    );
  });

  it('propagates a 404 for an unknown policy as a NotFoundError', async () => {
    const { resource } = client(async () =>
      jsonResponse({ error: { code: 'NOT_FOUND', message: 'Policy not found' } }, 404),
    );

    await expect(resource.simulatePolicyAgainst('pol_missing', PAYLOAD)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('propagates a 422 as a structured ValidationError without misreading it as a denial', async () => {
    const { resource } = client(async () =>
      jsonResponse(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'amount must be a positive decimal',
            details: { fields: { amount: ['must be a positive decimal'] } },
          },
        },
        422,
      ),
    );

    const failing = resource.simulatePolicyAgainst('pol_1', { asset: 'USDC', amount: '1' });
    await expect(failing).rejects.toBeInstanceOf(ValidationError);
    await expect(failing).rejects.toThrow('amount must be a positive decimal');
  });
});

/* -------------------------------------------------------------------------- */
/* Local input validation                                                      */
/* -------------------------------------------------------------------------- */

describe('validatePolicySimulationInput', () => {
  it('accepts a well-formed payload and returns it', () => {
    expect(validatePolicySimulationInput(PAYLOAD)).toBe(PAYLOAD);
    expect(validatePolicySimulationInput({ asset: 'XLM', amount: 1 })).toEqual({
      asset: 'XLM',
      amount: 1,
    });
    expect(validatePolicySimulationInput({ asset: 'XLM', amount: '1', spentInWindow: 0 })).toEqual({
      asset: 'XLM',
      amount: '1',
      spentInWindow: 0,
    });
  });

  const invalidCases: Array<[string, unknown, string, string]> = [
    ['a non-object payload', 'USDC', 'input', 'INVALID_POLICY_SIMULATION_INPUT'],
    ['a missing payload', undefined, 'input', 'INVALID_POLICY_SIMULATION_INPUT'],
    ['a missing asset', { amount: '10' }, 'asset', 'INVALID_POLICY_ASSET'],
    ['a blank asset', { asset: '   ', amount: '10' }, 'asset', 'INVALID_POLICY_ASSET'],
    ['a non-string asset', { asset: 42, amount: '10' }, 'asset', 'INVALID_POLICY_ASSET'],
    ['a zero amount', { asset: 'XLM', amount: 0 }, 'amount', 'INVALID_POLICY_AMOUNT'],
    ['a zero amount string', { asset: 'XLM', amount: '0' }, 'amount', 'INVALID_POLICY_AMOUNT'],
    ['a negative amount', { asset: 'XLM', amount: -5 }, 'amount', 'INVALID_POLICY_AMOUNT'],
    [
      'a non-finite amount',
      { asset: 'XLM', amount: Number.NaN },
      'amount',
      'INVALID_POLICY_AMOUNT',
    ],
    [
      'an infinite amount',
      { asset: 'XLM', amount: Number.POSITIVE_INFINITY },
      'amount',
      'INVALID_POLICY_AMOUNT',
    ],
    ['a missing amount', { asset: 'XLM' }, 'amount', 'INVALID_POLICY_AMOUNT'],
    ['an exponent amount', { asset: 'XLM', amount: '1e3' }, 'amount', 'INVALID_POLICY_AMOUNT'],
    ['a hex amount', { asset: 'XLM', amount: '0x10' }, 'amount', 'INVALID_POLICY_AMOUNT'],
    [
      'a blank recipient',
      { asset: 'XLM', amount: '1', recipientAddress: '  ' },
      'recipientAddress',
      'INVALID_POLICY_RECIPIENT',
    ],
    [
      'a blank sender',
      { asset: 'XLM', amount: '1', senderAddress: '' },
      'senderAddress',
      'INVALID_POLICY_SENDER',
    ],
    ['a non-string memo', { asset: 'XLM', amount: '1', memo: 7 }, 'memo', 'INVALID_POLICY_MEMO'],
    [
      'a negative spentInWindow',
      { asset: 'XLM', amount: '1', spentInWindow: -1 },
      'spentInWindow',
      'INVALID_POLICY_SPENT_IN_WINDOW',
    ],
    [
      'non-object metadata',
      { asset: 'XLM', amount: '1', metadata: 'nope' },
      'metadata',
      'INVALID_POLICY_METADATA',
    ],
  ];

  for (const [label, input, field, code] of invalidCases) {
    it(`rejects ${label} naming the field`, () => {
      try {
        validatePolicySimulationInput(input);
        expect.unreachable(`expected ${label} to be rejected`);
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError);
        expect((error as ValidationError).code).toBe(code);
        expect((error as ValidationError).details).toEqual({ field });
      }
    });
  }

  it('rejects a blank policy id before building a request', async () => {
    const { client: transport, calls } = mockTransport(() => ALLOWED_BODY);

    for (const policyId of ['', '   ']) {
      await expect(simulatePolicyEvaluation(transport, policyId, PAYLOAD)).rejects.toMatchObject({
        code: 'INVALID_POLICY_ID',
      });
    }
    expect(calls).toHaveLength(0);
  });

  it('rejects a malformed payload before spending a round trip', async () => {
    const { resource, fetch } = client(async () => jsonResponse({ data: ALLOWED_BODY }));

    await expect(
      resource.simulatePolicyAgainst('pol_1', { asset: 'USDC', amount: '-5' } as never),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(fetch.mock.calls).toHaveLength(0);
  });

  it('rejects a missing payload on the two-argument form', async () => {
    const { resource, fetch } = client(async () => jsonResponse({ data: ALLOWED_BODY }));

    await expect(
      (resource as unknown as { simulatePolicy: (id: string) => Promise<unknown> }).simulatePolicy(
        'pol_1',
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(fetch.mock.calls).toHaveLength(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Amount and band predicates                                                 */
/* -------------------------------------------------------------------------- */

describe('amount and risk-band helpers', () => {
  it('isValidPolicySimulationAmount accepts positive numbers and decimal strings', () => {
    for (const value of [1, 0.0001, 1e6, '1', '0.01', '1000.00', '9007199254740993.123456789']) {
      expect(isValidPolicySimulationAmount(value)).toBe(true);
    }
  });

  it('isValidPolicySimulationAmount rejects non-positive and non-decimal values', () => {
    for (const value of [
      0,
      -1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      '',
      '0',
      '0.000',
      '-5',
      '1e3',
      '0x10',
      'abc',
      ' 1',
      '1 ',
      null,
      undefined,
      {},
      [],
    ]) {
      expect(isValidPolicySimulationAmount(value)).toBe(false);
    }
  });

  it('isValidPolicySpentInWindow additionally accepts zero', () => {
    expect(isValidPolicySpentInWindow(0)).toBe(true);
    expect(isValidPolicySpentInWindow('0')).toBe(true);
    expect(isValidPolicySpentInWindow('0.00')).toBe(true);
    expect(isValidPolicySpentInWindow(-1)).toBe(false);
    expect(isValidPolicySpentInWindow('1e3')).toBe(false);
    expect(isValidPolicySpentInWindow(undefined)).toBe(false);
  });

  it('riskBandForScore maps the 0..1 range onto the documented bands', () => {
    expect(riskBandForScore(0)).toBe('LOW');
    expect(riskBandForScore(0.29)).toBe('LOW');
    expect(riskBandForScore(0.3)).toBe('MEDIUM');
    expect(riskBandForScore(0.59)).toBe('MEDIUM');
    expect(riskBandForScore(0.6)).toBe('HIGH');
    expect(riskBandForScore(0.84)).toBe('HIGH');
    expect(riskBandForScore(0.85)).toBe('CRITICAL');
    expect(riskBandForScore(1)).toBe('CRITICAL');
  });

  it('riskBandForScore clamps out-of-range and non-finite scores instead of throwing', () => {
    expect(riskBandForScore(-5)).toBe('LOW');
    expect(riskBandForScore(42)).toBe('CRITICAL');
    expect(riskBandForScore(Number.NaN)).toBe('LOW');
  });
});

/* -------------------------------------------------------------------------- */
/* Resource surface                                                            */
/* -------------------------------------------------------------------------- */

describe('PolicyResource — single-policy simulation methods', () => {
  it('routes both simulatePolicy forms to the right endpoint', async () => {
    const { resource, fetch } = client(async () => jsonResponse({ data: ALLOWED_BODY }));

    await resource.simulatePolicy({ walletId: 'w_1', asset: 'USDC', amount: '10' });
    await resource.simulatePolicy('pol_1', PAYLOAD);
    await resource.simulatePolicyAgainst('pol_1', PAYLOAD);

    expect(String(fetch.mock.calls[0]![0])).toContain('/policies/simulate');
    expect(String(fetch.mock.calls[1]![0])).toContain('/policies/pol_1/simulate');
    expect(String(fetch.mock.calls[2]![0])).toContain('/policies/pol_1/simulate');
  });

  it('simulatePolicy(policyId, input) agrees with simulatePolicyAgainst', async () => {
    const viaOverload = client(async () => jsonResponse({ data: REJECTED_BODY }));
    const viaNamed = client(async () => jsonResponse({ data: REJECTED_BODY }));

    const a = await viaOverload.resource.simulatePolicy('pol_1', PAYLOAD);
    const b = await viaNamed.resource.simulatePolicyAgainst('pol_1', PAYLOAD);

    expect(a).toEqual(b);
    // The two entry points issue byte-identical requests (headers are compared
    // by value, since each HttpClient builds its own Headers instance).
    const [overloadInit, namedInit] = [
      viaOverload.fetch.mock.calls[0]![1] as RequestInit,
      viaNamed.fetch.mock.calls[0]![1] as RequestInit,
    ];
    expect(String(viaOverload.fetch.mock.calls[0]![0])).toBe(
      String(viaNamed.fetch.mock.calls[0]![0]),
    );
    expect(overloadInit.method).toBe(namedInit.method);
    expect(String(overloadInit.body)).toBe(String(namedInit.body));
    expect([...new Headers(overloadInit.headers).entries()].sort()).toEqual(
      [...new Headers(namedInit.headers).entries()].sort(),
    );
  });

  it('exposes the per-policy simulation helpers on the resource', () => {
    for (const method of ['simulatePolicy', 'simulatePolicyAgainst'] as const) {
      expect(typeof PolicyResource.prototype[method]).toBe('function');
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Pure parser                                                                 */
/* -------------------------------------------------------------------------- */

describe('toPolicySimulationEvaluation', () => {
  it('is a pure function — it does not depend on the transport', () => {
    const evaluation = toPolicySimulationEvaluation('pol_1', REJECTED_BODY);

    expect(evaluation.violatedRules[0]!.policyId).toBe('pol_1');
    expect(evaluation.violatedRules[0]!.policyType).toBe('MAX_AMOUNT');
  });

  it('rejects a blank policy id', () => {
    expect(() => toPolicySimulationEvaluation('  ', ALLOWED_BODY)).toThrow(ValidationError);
  });

  it('synthesizes an explanation only when the API omits one', () => {
    expect(toPolicySimulationEvaluation('pol_1', { allowed: true }).explanation).toBe(
      'Transaction complies with the policy.',
    );
    expect(toPolicySimulationEvaluation('pol_1', { violations: ['a', 'b'] }).explanation).toBe(
      'Transaction is blocked by 2 policy rules.',
    );
  });
});

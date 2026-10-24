/**
 * Unit tests for the policy rule evaluation simulation helpers (issue #401).
 *
 * Covers the three layers the module is built from:
 *
 * - {@link validatePolicyEvaluationRequest} — strict local request validation.
 * - {@link toPolicyEvaluationOutcome} — the defensive response parser.
 * - {@link simulatePolicyRuleEvaluation} — the transport helper, exercised
 *   against a mocked `fetch` through a real `HttpClient`.
 *
 * Both simulation outcomes are covered: a **match** (the transaction satisfies
 * the rule) and a **violation** (the transaction breaches the rule). No live
 * API is contacted.
 */

import { describe, expect, it, vi } from 'vitest';
import { HttpClient } from '@astroid/core';
import { ValidationError } from '@astroid/errors';
import type { PolicyEvaluationRequest } from '@astroid/types';

import {
  POLICY_SIMULATE_RULE_PATH,
  PolicyResource,
  simulatePolicyRuleEvaluation,
  toPolicyEvaluationOutcome,
  validatePolicyEvaluationRequest,
  validatePolicyConfig,
  isValidPolicyConfig,
} from '../index.js';

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

/** HTTP 200 response carrying an enveloped `data` payload. */
function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ data }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Build an `HttpClient` backed by the given fetch mock. */
function httpClient(fetchImpl: typeof fetch): {
  http: HttpClient;
  fetch: ReturnType<typeof vi.fn>;
} {
  const fetchMock = vi.fn(fetchImpl);
  const http = new HttpClient({
    apiKey: 'sk_test',
    baseUrl: 'https://api.example.test',
    retry: false,
    fetch: fetchMock as unknown as typeof fetch,
  });
  return { http, fetch: fetchMock };
}

/** A rule that permits a specific destination. */
const ALLOW_RULE = {
  name: 'treasury-only',
  allowedRecipients: ['GVALIDRECIPIENT'],
};

/** A rule that denies a specific destination. */
const DENY_RULE = {
  name: 'blocked-destination',
  blockedRecipients: ['GBADRECIPIENT'],
};

/** A transaction that satisfies {@link ALLOW_RULE}. */
const MATCHING_TRANSACTION = {
  asset: 'USDC',
  amount: '250.00',
  recipientAddress: 'GVALIDRECIPIENT',
};

/** A transaction that breaches {@link DENY_RULE}. */
const VIOLATING_TRANSACTION = {
  asset: 'USDC',
  amount: '50.00',
  recipientAddress: 'GBADRECIPIENT',
};

/* -------------------------------------------------------------------------- */
/* Request validation                                                          */
/* -------------------------------------------------------------------------- */

describe('validatePolicyEvaluationRequest (issue #401)', () => {
  it('accepts a well-formed request and returns it typed', () => {
    const request: PolicyEvaluationRequest = {
      rule: ALLOW_RULE,
      transaction: MATCHING_TRANSACTION,
    };

    const validated = validatePolicyEvaluationRequest(request);

    expect(validated.rule.name).toBe('treasury-only');
    expect(validated.transaction.asset).toBe('USDC');
  });

  it('rejects a request without a rule', () => {
    expect(() =>
      validatePolicyEvaluationRequest({ transaction: MATCHING_TRANSACTION }),
    ).toThrow(ValidationError);
  });

  it('rejects a request without a transaction', () => {
    expect(() => validatePolicyEvaluationRequest({ rule: ALLOW_RULE })).toThrow(ValidationError);
  });

  it('rejects a transaction without an asset', () => {
    expect(() =>
      validatePolicyEvaluationRequest({
        rule: ALLOW_RULE,
        transaction: { amount: '10' },
      }),
    ).toThrow(ValidationError);
  });

  it('rejects a rule without a name', () => {
    expect(() =>
      validatePolicyEvaluationRequest({
        rule: { allowedRecipients: ['GVALIDRECIPIENT'] },
        transaction: MATCHING_TRANSACTION,
      }),
    ).toThrow(ValidationError);
  });

  it('reports the offending field on the ValidationError', () => {
    let caught: unknown;
    try {
      validatePolicyEvaluationRequest({ rule: ALLOW_RULE });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ValidationError);
    expect((caught as ValidationError).fieldErrors).toBeDefined();
  });
});

/* -------------------------------------------------------------------------- */
/* Response parsing                                                            */
/* -------------------------------------------------------------------------- */

describe('toPolicyEvaluationOutcome (issue #401)', () => {
  const request: PolicyEvaluationRequest = {
    rule: ALLOW_RULE,
    transaction: MATCHING_TRANSACTION,
  };

  it('parses a matching (allowed) evaluation', () => {
    const outcome = toPolicyEvaluationOutcome(
      {
        allowed: true,
        denied: false,
        triggeredRuleIds: ['treasury-only'],
        violatedRules: [],
        riskScore: 0.1,
        explanation: 'Transaction satisfies the rule.',
      },
      request,
    );

    expect(outcome.allowed).toBe(true);
    expect(outcome.denied).toBe(false);
    expect(outcome.triggeredRuleIds).toEqual(['treasury-only']);
    expect(outcome.violatedRules).toEqual([]);
    expect(outcome.riskScore).toBe(0.1);
    expect(outcome.explanation).toBe('Transaction satisfies the rule.');
  });

  it('parses a violating (denied) evaluation and lists the failed checks', () => {
    const outcome = toPolicyEvaluationOutcome(
      {
        allowed: false,
        denied: true,
        triggeredRuleIds: ['blocked-destination'],
        violatedRules: [
          {
            rule: 'blocked-destination',
            check: 'address',
            success: false,
            explanation: 'Recipient is on the denylist.',
          },
        ],
        riskScore: 0.9,
      },
      request,
    );

    expect(outcome.allowed).toBe(false);
    expect(outcome.denied).toBe(true);
    expect(outcome.violatedRules).toHaveLength(1);
    expect(outcome.violatedRules[0]).toMatchObject({
      rule: 'blocked-destination',
      check: 'address',
      success: false,
      explanation: 'Recipient is on the denylist.',
    });
    expect(outcome.riskScore).toBe(0.9);
  });

  it('derives the decision from the violation list when no flag is reported', () => {
    const outcome = toPolicyEvaluationOutcome(
      { violatedRules: [{ rule: 'r', check: 'time', success: false }] },
      request,
    );

    expect(outcome.allowed).toBe(false);
    expect(outcome.denied).toBe(true);
  });

  it('accepts a `denied`-only payload', () => {
    const outcome = toPolicyEvaluationOutcome({ denied: true }, request);

    expect(outcome.allowed).toBe(false);
    expect(outcome.denied).toBe(true);
  });

  it('falls back to the request policy id and a generated explanation', () => {
    const outcome = toPolicyEvaluationOutcome(
      { allowed: true },
      { ...request, policyId: 'pol_1' },
    );

    expect(outcome.policyId).toBe('pol_1');
    expect(outcome.explanation).toContain('treasury-only');
    expect(outcome.riskScore).toBe(0);
  });

  it('clamps an out-of-range risk score into 0..1', () => {
    const outcome = toPolicyEvaluationOutcome({ allowed: true, riskScore: 4 }, request);

    expect(outcome.riskScore).toBe(1);
  });

  it('rejects a response that carries no decision at all', () => {
    expect(() => toPolicyEvaluationOutcome({}, request)).toThrow(ValidationError);
  });

  it('rejects a non-object response body', () => {
    expect(() => toPolicyEvaluationOutcome('nope', request)).toThrow(ValidationError);
  });
});

/* -------------------------------------------------------------------------- */
/* Transport helper                                                            */
/* -------------------------------------------------------------------------- */

describe('simulatePolicyRuleEvaluation (issue #401)', () => {
  it('POSTs the rule and transaction to the policy evaluation endpoint', async () => {
    const { http, fetch } = httpClient(async () =>
      jsonResponse({
        allowed: true,
        denied: false,
        triggeredRuleIds: ['treasury-only'],
      }),
    );

    const outcome = await simulatePolicyRuleEvaluation(http, {
      rule: ALLOW_RULE,
      transaction: MATCHING_TRANSACTION,
    });

    expect(outcome.allowed).toBe(true);

    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toContain(POLICY_SIMULATE_RULE_PATH);
    expect((init as RequestInit).method).toBe('POST');
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body.rule).toEqual(ALLOW_RULE);
    expect(body.transaction).toEqual(MATCHING_TRANSACTION);
  });

  it('resolves normally with allowed: false when the rule is violated', async () => {
    const { http } = httpClient(async () =>
      jsonResponse({
        allowed: false,
        denied: true,
        triggeredRuleIds: ['blocked-destination'],
        violatedRules: [
          {
            rule: 'blocked-destination',
            check: 'address',
            success: false,
            explanation: 'Recipient is on the denylist.',
          },
        ],
      }),
    );

    const outcome = await simulatePolicyRuleEvaluation(http, {
      rule: DENY_RULE,
      transaction: VIOLATING_TRANSACTION,
    });

    expect(outcome.allowed).toBe(false);
    expect(outcome.denied).toBe(true);
    expect(outcome.violatedRules).toHaveLength(1);
  });

  it('rejects a malformed request before any network call is made', async () => {
    const { http, fetch } = httpClient(async () => jsonResponse({ allowed: true }));

    await expect(
      simulatePolicyRuleEvaluation(http, {
        rule: ALLOW_RULE,
        transaction: { amount: '10' } as never,
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects a response that carries no decision', async () => {
    const { http } = httpClient(async () => jsonResponse({}));

    await expect(
      simulatePolicyRuleEvaluation(http, {
        rule: ALLOW_RULE,
        transaction: MATCHING_TRANSACTION,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

/* -------------------------------------------------------------------------- */
/* Resource method                                                             */
/* -------------------------------------------------------------------------- */

describe('PolicyResource.simulatePolicyRule (issue #401)', () => {
  it('is exposed on the resource and posts to /policies/simulate-rule', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse({ allowed: true, denied: false, triggeredRuleIds: [] }),
    );
    const http = new HttpClient({
      apiKey: 'sk_test',
      baseUrl: 'https://api.example.test',
      retry: false,
      fetch: fetchMock as unknown as typeof fetch,
    });
    const policies = new PolicyResource(http);

    const outcome = await policies.simulatePolicyRule({
      rule: ALLOW_RULE,
      transaction: MATCHING_TRANSACTION,
    });

    expect(outcome.allowed).toBe(true);
    const [url] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain('/policies/simulate-rule');
  });
});

/* -------------------------------------------------------------------------- */
/* Input validation and sanitization helpers (issue #407)                      */
/* -------------------------------------------------------------------------- */

describe('validatePolicyConfig (issue #407)', () => {
  const VALID_STELLAR_PUBKEY = 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW';

  it('validates and sanitizes a complete valid policy configuration', () => {
    const raw = {
      maxAmount: 1000,
      minAmount: 10,
      asset: '  USDC  ',
      allowedRecipients: [`  ${VALID_STELLAR_PUBKEY}  `],
      dailyLimit: 5000,
      weeklyLimit: 25000,
      monthlyLimit: 100000,
      timeWindow: {
        start: '2026-01-01T00:00:00.000Z',
        end: '2026-12-31T23:59:59.000Z',
      },
      allowedHours: {
        startHour: 9,
        endHour: 17,
        days: [1, 2, 3, 4, 5],
      },
      requiredSignatures: 2,
      requiresApproval: true,
      customMeta: 'preserved',
    };

    const validated = validatePolicyConfig(raw);

    expect(validated.maxAmount).toBe(1000);
    expect(validated.minAmount).toBe(10);
    expect(validated.asset).toBe('USDC');
    expect(validated.allowedRecipients).toEqual([VALID_STELLAR_PUBKEY]);
    expect(validated.dailyLimit).toBe(5000);
    expect(validated.weeklyLimit).toBe(25000);
    expect(validated.monthlyLimit).toBe(100000);
    expect(validated.timeWindow?.start).toBe('2026-01-01T00:00:00.000Z');
    expect(validated.allowedHours?.startHour).toBe(9);
    expect(validated.requiredSignatures).toBe(2);
    expect(validated.requiresApproval).toBe(true);
    expect(validated.customMeta).toBe('preserved');
    expect(isValidPolicyConfig(raw)).toBe(true);
  });

  it('rejects non-object configurations', () => {
    expect(() => validatePolicyConfig(null)).toThrow(ValidationError);
    expect(isValidPolicyConfig(null)).toBe(false);
    expect(() => validatePolicyConfig(undefined)).toThrow(ValidationError);
    expect(isValidPolicyConfig(undefined)).toBe(false);
    expect(() => validatePolicyConfig('config')).toThrow(ValidationError);
    expect(isValidPolicyConfig('config')).toBe(false);
    expect(() => validatePolicyConfig([])).toThrow(ValidationError);
    expect(isValidPolicyConfig([])).toBe(false);
  });

  it('rejects negative or NaN numeric limits', () => {
    expect(() => validatePolicyConfig({ maxAmount: -100 })).toThrow(ValidationError);
    expect(() => validatePolicyConfig({ minAmount: -1 })).toThrow(ValidationError);
    expect(() => validatePolicyConfig({ dailyLimit: -500 })).toThrow(ValidationError);
    expect(() => validatePolicyConfig({ weeklyLimit: NaN })).toThrow(ValidationError);
    expect(() => validatePolicyConfig({ monthlyLimit: Infinity })).toThrow(ValidationError);
  });

  it('rejects when minAmount exceeds maxAmount', () => {
    expect(() =>
      validatePolicyConfig({
        minAmount: 1000,
        maxAmount: 500,
      }),
    ).toThrow(ValidationError);
  });

  it('rejects invalid Stellar public key formats', () => {
    expect(() =>
      validatePolicyConfig({
        allowedRecipients: ['not-a-stellar-address'],
      }),
    ).toThrow(ValidationError);

    expect(() =>
      validatePolicyConfig({
        blockedRecipients: ['0x1234567890abcdef'],
      }),
    ).toThrow(ValidationError);

    expect(() =>
      validatePolicyConfig({
        recipientAddress: 'GSHORT',
      }),
    ).toThrow(ValidationError);
  });

  it('rejects invalid asset identifiers', () => {
    expect(() => validatePolicyConfig({ asset: '' })).toThrow(ValidationError);
    expect(() => validatePolicyConfig({ asset: 'TOOLONGASSETNAMEOVER12CHARS' })).toThrow(ValidationError);
    expect(() =>
      validatePolicyConfig({
        allowedAssets: ['INVALID:NOTANISSUERADDRESS'],
      }),
    ).toThrow(ValidationError);
  });

  it('rejects invalid timeWindow bounds', () => {
    expect(() =>
      validatePolicyConfig({
        timeWindow: {
          start: 'not-a-date',
          end: '2026-12-31T00:00:00Z',
        },
      }),
    ).toThrow(ValidationError);

    expect(() =>
      validatePolicyConfig({
        timeWindow: {
          start: '2026-12-31T00:00:00Z',
          end: '2026-01-01T00:00:00Z',
        },
      }),
    ).toThrow(ValidationError);
  });
});


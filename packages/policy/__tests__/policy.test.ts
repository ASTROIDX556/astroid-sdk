import { describe, expect, it, vi } from 'vitest';

import { HttpClient } from '@astroid/core';
import { NetworkError, NotFoundError, ValidationError } from '@astroid/errors';
import type { Policy, PolicySimulationResult } from '@astroid/types';

import {
  PolicyClient,
  PolicyResource,
  PoliciesResource,
  PolicyType,
  type PolicyCreateInput,
  type PolicyUpdateInput,
} from '../src/index.js';

/** HTTP 200 response carrying an enveloped `data` payload. */
function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Build a `PolicyResource` backed by the given fetch mock. */
function client(
  fetchImpl: typeof fetch,
): { resource: PolicyResource; fetch: ReturnType<typeof vi.fn>; http: HttpClient } {
  const fetchMock = vi.fn(fetchImpl);
  const http = new HttpClient({
    apiKey: 'sk_test',
    baseUrl: 'https://api.example.test',
    retry: false,
    fetch: fetchMock as unknown as typeof fetch,
  });
  return { resource: new PolicyResource(http), fetch: fetchMock, http };
}

const POLICY: Policy = {
  id: 'pol_1',
  organizationId: 'org_1',
  name: 'Max 500 USDC',
  type: 'MAX_AMOUNT',
  configuration: { maxAmount: 500 },
  priority: 1,
  enabled: true,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

const CREATE_INPUT = {
  name: 'Max 500 USDC',
  type: 'MAX_AMOUNT' as const,
  configuration: { maxAmount: 500 },
  priority: 1,
  enabled: true,
};

const SIM_RESULT: PolicySimulationResult = {
  allowed: true,
  violations: [],
  requiredApprovals: [],
  risk: { score: 0.05, band: 'LOW', factors: [] },
  budgetImpact: [],
  explanation: 'Transfer is within policy limits.',
};

describe('PolicyResource — CRUD with mocked API responses', () => {
  it('create POSTs the input to /policies and returns the policy', async () => {
    const { resource, fetch } = client(async () => jsonResponse({ data: POLICY }));

    const created = await resource.create(CREATE_INPUT);

    expect(created).toEqual(POLICY);
    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toContain('/policies');
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse(String((init as RequestInit).body))).toEqual(CREATE_INPUT);
  });

  it('get fetches a single policy by id', async () => {
    const { resource, fetch } = client(async () => jsonResponse({ data: POLICY }));

    const policy = await resource.get('pol_1');

    expect(policy).toEqual(POLICY);
    expect(String(fetch.mock.calls[0]![0])).toContain('/policies/pol_1');
  });

  it('list returns a paginated set of policies', async () => {
    const { resource } = client(async () =>
      jsonResponse({
        data: [POLICY],
        meta: { page: 1, limit: 1, total: 1, totalPages: 1 },
      }),
    );

    const result = await resource.list({ enabled: true });

    expect(result.data).toEqual([POLICY]);
    expect(result.meta?.total).toBe(1);
  });

  it('update PATCHes the policy and returns the updated record', async () => {
    const { resource, fetch } = client(async () =>
      jsonResponse({ data: { ...POLICY, enabled: false } }),
    );

    const updated = await resource.update('pol_1', { enabled: false });

    expect(updated.enabled).toBe(false);
    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toContain('/policies/pol_1');
    expect((init as RequestInit).method).toBe('PATCH');
  });

  it('delete issues a DELETE and resolves to void', async () => {
    const { resource, fetch } = client(async () => new Response(null, { status: 204 }));

    await expect(resource.delete('pol_1')).resolves.toBeUndefined();
    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toContain('/policies/pol_1');
    expect((init as RequestInit).method).toBe('DELETE');
  });
});

describe('PolicyResource — pre-flight simulation and dry-run helper', () => {
  it('simulate POSTs the request payload and returns the result', async () => {
    const { resource, fetch } = client(async () => jsonResponse({ data: SIM_RESULT }));

    const input = {
      walletId: 'w_1',
      asset: 'USDC',
      amount: '150',
      recipientAddress: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW',
    };

    const result = await resource.simulate(input);

    expect(result).toEqual(SIM_RESULT);
    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toContain('/policies/simulate');
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse(String((init as RequestInit).body))).toEqual(input);
  });

  it('simulatePolicy performs dry-run check against active spending policies', async () => {
    const { resource, fetch } = client(async () => jsonResponse({ data: SIM_RESULT }));

    const input = {
      walletId: 'w_1',
      asset: 'USDC',
      amount: '100',
      recipientAddress: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW',
    };

    const result = await resource.simulatePolicy(input);

    expect(result).toEqual(SIM_RESULT);
    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toContain('/policies/simulate');
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse(String((init as RequestInit).body))).toEqual(input);
  });

  it('simulatePolicy serializes the full transaction payload and policy-rule selectors', async () => {
    const { resource, fetch } = client(async () => jsonResponse({ data: SIM_RESULT }));

    const input = {
      agentId: 'ag_1',
      asset: 'XLM',
      amount: 10,
      recipientAddress: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW',
      senderAddress: 'GSOURCE',
      memo: 'payout',
      spentInWindow: '40',
      policyIds: ['pol_1', 'pol_2'],
    };

    const result = await resource.simulatePolicy(input);

    expect(result).toEqual(SIM_RESULT);
    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toContain('/policies/simulate');
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse(String((init as RequestInit).body))).toEqual(input);
  });

  it('simulate is a backwards-compatible alias of simulatePolicy', async () => {
    const { resource, fetch } = client(async () => jsonResponse({ data: SIM_RESULT }));

    const result = await resource.simulate({ walletId: 'w_1', asset: 'USDC', amount: '50' });

    expect(result).toEqual(SIM_RESULT);
    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toContain('/policies/simulate');
    expect((init as RequestInit).method).toBe('POST');
  });

  it('simulate returns a rejected result with the breached violations', async () => {
    const rejected: PolicySimulationResult = {
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
      budgetImpact: [],
      explanation: 'Transfer is blocked by 1 active policy.',
    };
    const { resource, fetch } = client(async () => jsonResponse({ data: rejected }));

    const input = {
      walletId: 'w_1',
      asset: 'USDC',
      amount: '750',
      recipientAddress: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW',
    };
    const result = await resource.simulatePolicy(input);

    expect(result.allowed).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toMatchObject({
      policyId: 'pol_1',
      policyType: 'MAX_AMOUNT',
      limit: 500,
      actual: 750,
    });
    expect(result.requiredApprovals).toContain('owner');
    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toContain('/policies/simulate');
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse(String((init as RequestInit).body))).toEqual(input);
  });

  it('propagates network failures as a structured NetworkError', async () => {
    const { resource } = client(async () => {
      throw new TypeError('Failed to fetch');
    });

    await expect(resource.simulate({ walletId: 'w_1', asset: 'XLM', amount: '1' })).rejects.toBeInstanceOf(
      NetworkError,
    );
  });
});

describe('PolicyResource — simulateTransaction wrapper (list + local evaluate)', () => {
  const BLOCKING_POLICY: Policy = {
    ...POLICY,
    id: 'pol_max',
    name: 'Max 500 USDC',
    type: 'MAX_AMOUNT',
    configuration: { maxAmount: 500 },
  };

  it('throws when neither agentId nor walletId is provided', async () => {
    const { resource } = client(async () => jsonResponse({ data: [] }));

    await expect(
      resource.simulateTransaction({ transaction: { asset: 'XLM', amount: '1' } }),
    ).rejects.toThrow('agentId` or `walletId`');
  });

  it('fetches active policies for the wallet and evaluates locally (allowed)', async () => {
    const { resource, fetch } = client(async () =>
      jsonResponse({ data: [BLOCKING_POLICY], meta: { page: 1, limit: 10, total: 1, totalPages: 1 } }),
    );

    const report = await resource.simulateTransaction({
      walletId: 'w_1',
      transaction: { asset: 'USDC', amount: '150' },
    });

    expect(report.passed).toBe(true);
    expect(report.violations).toEqual([]);
    const [url] = fetch.mock.calls[0]!;
    expect(String(url)).toContain('/policies');
    expect(String(url)).toContain('enabled=true');
    expect(String(url)).toContain('walletId=w_1');
  });

  it('blocks a transaction that breaches a fetched max-amount policy', async () => {
    const { resource } = client(async () =>
      jsonResponse({ data: [BLOCKING_POLICY], meta: { page: 1, limit: 10, total: 1, totalPages: 1 } }),
    );

    const report = await resource.simulateTransaction({
      walletId: 'w_1',
      transaction: { asset: 'USDC', amount: '750.50' },
    });

    expect(report.passed).toBe(false);
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0]).toMatchObject({
      policyId: 'pol_max',
      policyType: 'MAX_AMOUNT',
      limit: 500,
      actual: 750.5,
    });
    expect(report.violations[0].message).toContain('exceeds the maximum');
  });

  it('skips disabled policies during the local evaluation', async () => {
    const { resource, fetch } = client(async () =>
      jsonResponse({
        data: [{ ...BLOCKING_POLICY, enabled: false }],
        meta: { page: 1, limit: 10, total: 1, totalPages: 1 },
      }),
    );

    const report = await resource.simulateTransaction({
      walletId: 'w_1',
      transaction: { asset: 'USDC', amount: '9999' },
    });

    expect(report.passed).toBe(true);
    expect(fetch.mock.calls).toHaveLength(1);
  });

  it('scopes by agentId when given instead of walletId', async () => {
    const { resource, fetch } = client(async () =>
      jsonResponse({ data: [], meta: { page: 1, limit: 10, total: 0, totalPages: 0 } }),
    );

    const report = await resource.simulateTransaction({
      agentId: 'ag_1',
      transaction: { asset: 'XLM', amount: '5' },
    });

    expect(report.passed).toBe(true);
    const url = String(fetch.mock.calls[0]![0]);
    expect(url).toContain('agentId=ag_1');
    expect(url).not.toContain('walletId');
  });
});

/* -------------------------------------------------------------------------- */
/* PolicyClient — the name from the #242 acceptance criteria                   */
/* -------------------------------------------------------------------------- */

describe('PolicyClient export surface', () => {
  it('PolicyClient is an alias of PolicyResource, not a subclass', () => {
    expect(PolicyClient).toBe(PolicyResource);
  });

  it('PoliciesResource remains an alias of PolicyResource', () => {
    expect(PoliciesResource).toBe(PolicyResource);
  });

  it('exposes the full CRUD + simulate surface', () => {
    for (const method of [
      'create',
      'get',
      'list',
      'update',
      'delete',
      'simulate',
      'simulatePolicy',
      'simulateTransaction',
    ] as const) {
      expect(typeof PolicyClient.prototype[method]).toBe('function');
    }
  });

  it('routes requests identically through the PolicyClient name', async () => {
    const { resource, http } = client(async () => jsonResponse({ data: POLICY }));
    const viaClient = new PolicyClient(http);

    expect(await viaClient.get('pol_1')).toEqual(await resource.get('pol_1'));
    expect(viaClient).toBeInstanceOf(PolicyResource);
  });

  it('re-exports PolicyType as a runtime lookup table', () => {
    expect(PolicyType.MAX_AMOUNT).toBe('MAX_AMOUNT');
    expect(Object.values(PolicyType)).toContain('ALLOWED_RECIPIENTS');
  });
});

/* -------------------------------------------------------------------------- */
/* Request payload typing                                                      */
/* -------------------------------------------------------------------------- */

describe('PolicyResource — request payload typing', () => {
  it('create accepts a PolicyCreateInput draft and forwards it verbatim', async () => {
    const { resource, fetch } = client(async () => jsonResponse({ data: POLICY }));

    // Exactly what `PolicyBuilder#build()` returns.
    const draft: PolicyCreateInput = {
      name: 'Treasury guardrails',
      type: PolicyType.ALLOWED_RECIPIENTS,
      configuration: { allowedRecipients: ['GDESTINATION'] },
      priority: 1,
      enabled: true,
    };

    await expect(resource.create(draft)).resolves.toEqual(POLICY);
    expect(JSON.parse(String((fetch.mock.calls[0]![1] as RequestInit).body))).toEqual(draft);
  });

  it('create strips nothing — the payload is sent exactly as given', async () => {
    const { resource, fetch } = client(async () => jsonResponse({ data: POLICY }));

    await resource.create(CREATE_INPUT);

    const body = JSON.parse(String((fetch.mock.calls[0]![1] as RequestInit).body));
    expect(Object.keys(body).sort()).toEqual(Object.keys(CREATE_INPUT).sort());
  });

  it('update accepts a partial PolicyUpdateInput', async () => {
    const { resource, fetch } = client(async () =>
      jsonResponse({ data: { ...POLICY, ...{ enabled: false, priority: 5 } } }),
    );

    const patch: PolicyUpdateInput = { enabled: false, priority: 5 };
    const updated = await resource.update('pol_1', patch);

    expect(updated.enabled).toBe(false);
    expect(updated.priority).toBe(5);
    expect(JSON.parse(String((fetch.mock.calls[0]![1] as RequestInit).body))).toEqual(patch);
  });

  it('accepts a valid draft and forwards the payload verbatim', async () => {
    const { resource, fetch } = client(async () => jsonResponse({ data: POLICY }));

    const valid: PolicyCreateInput = {
      name: 'Treasury guardrails',
      type: PolicyType.DAILY_BUDGET,
      configuration: { maxAmount: 500 },
      priority: 1,
      enabled: true,
    };

    await resource.create(valid);

    // The resource is a thin transport: the body it POSTs is exactly the object
    // the caller supplied, with no field added, renamed or dropped.
    expect(JSON.parse(String((fetch.mock.calls[0]![1] as RequestInit).body))).toEqual(valid);
  });

  it('leaves stripping server-owned fields to the type system, not the transport', async () => {
    // `PolicyCreateInput` omits id/organizationId/createdAt/updatedAt/
    // deletedAt, so writing one of them literally is a compile error. TypeScript
    // excess-property checks do not apply to keys arriving through a spread, and
    // the resource deliberately does not strip them — silently dropping fields
    // a caller sent would be more surprising than forwarding them and letting
    // the API reject or ignore them.
    const { resource, fetch } = client(async () => jsonResponse({ data: POLICY }));

    await resource.create({ ...POLICY, name: 'Renamed', type: PolicyType.MAX_AMOUNT });

    const body = JSON.parse(String((fetch.mock.calls[0]![1] as RequestInit).body));
    expect(body.name).toBe('Renamed');
    expect(body.id).toBe('pol_1');
  });
});

/* -------------------------------------------------------------------------- */
/* Typed API failures                                                          */
/* -------------------------------------------------------------------------- */

describe('PolicyResource — typed API failures', () => {
  it('get surfaces a 404 as NotFoundError', async () => {
    const { resource } = client(async () =>
      jsonResponse({ error: { code: 'NOT_FOUND', message: 'Policy not found' } }, 404),
    );

    await expect(resource.get('pol_missing')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('create surfaces a 422 as ValidationError with the API message', async () => {
    const { resource } = client(async () =>
      jsonResponse(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'maxAmount must be positive',
            details: { fields: { maxAmount: ['must be positive'] } },
          },
        },
        422,
      ),
    );

    await expect(resource.create(CREATE_INPUT)).rejects.toBeInstanceOf(ValidationError);
    await expect(resource.create(CREATE_INPUT)).rejects.toThrow('maxAmount must be positive');
  });

  it('delete surfaces a 404 as NotFoundError', async () => {
    const { resource } = client(async () =>
      jsonResponse({ error: { code: 'NOT_FOUND', message: 'Policy not found' } }, 404),
    );

    await expect(resource.delete('pol_missing')).rejects.toBeInstanceOf(NotFoundError);
  });
});

/* -------------------------------------------------------------------------- */
/* list() filters                                                              */
/* -------------------------------------------------------------------------- */

describe('PolicyResource — list filters', () => {
  it('serializes every supported filter to the query string', async () => {
    const { resource, fetch } = client(async () =>
      jsonResponse({ data: [], meta: { page: 1, limit: 20, total: 0, totalPages: 0 } }),
    );

    await resource.list({
      enabled: false,
      type: PolicyType.BLOCKED_ASSETS,
      agentId: 'ag_1',
      walletId: 'w_1',
    });

    const url = new URL(String(fetch.mock.calls[0]![0]));
    expect(url.pathname).toContain('/policies');
    expect(url.searchParams.get('enabled')).toBe('false');
    expect(url.searchParams.get('type')).toBe('BLOCKED_ASSETS');
    expect(url.searchParams.get('agentId')).toBe('ag_1');
    expect(url.searchParams.get('walletId')).toBe('w_1');
  });

  it('lists by agent with no other filters', async () => {
    const { resource, fetch } = client(async () =>
      jsonResponse({ data: [POLICY], meta: { page: 1, limit: 20, total: 1, totalPages: 1 } }),
    );

    const result = await resource.list({ agentId: 'ag_1' });

    expect(result.data).toHaveLength(1);
    const url = new URL(String(fetch.mock.calls[0]![0]));
    expect(url.searchParams.get('agentId')).toBe('ag_1');
    expect(url.searchParams.get('enabled')).toBeNull();
  });

  it('returns an empty page when the API omits meta', async () => {
    const { resource } = client(async () => jsonResponse({ data: [] }));

    const result = await resource.list();

    expect(result.data).toEqual([]);
    expect(result.meta).toBeDefined();
  });

  it('url-encodes policy ids with path-unsafe characters', async () => {
    const { resource, fetch } = client(async () => jsonResponse({ data: POLICY }));

    await resource.get('pol/../admin');

    expect(String(fetch.mock.calls[0]![0])).toContain('pol%2F..%2Fadmin');
  });
});

import { describe, expect, it, vi } from 'vitest';

import { HttpClient } from '@astroid/core';
import { NetworkError } from '@astroid/errors';
import type { Policy, PolicySimulationResult } from '@astroid/types';

import { PolicyResource } from '../src/index.js';

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
): { resource: PolicyResource; fetch: ReturnType<typeof vi.fn> } {
  const fetchMock = vi.fn(fetchImpl);
  const http = new HttpClient({
    apiKey: 'sk_test',
    baseUrl: 'https://api.example.test',
    retry: false,
    fetch: fetchMock as unknown as typeof fetch,
  });
  return { resource: new PolicyResource(http), fetch: fetchMock };
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
    const { resource, fetch } = clientWith(async () => jsonResponse({ data: SIM_RESULT }));

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

  it('propagates network failures as a structured NetworkError', async () => {
    const { resource } = client(async () => {
      throw new TypeError('Failed to fetch');
    });

    await expect(resource.simulate({ walletId: 'w_1', asset: 'XLM', amount: '1' })).rejects.toBeInstanceOf(
      NetworkError,
    );
  });
});

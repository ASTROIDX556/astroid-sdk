import { describe, expect, it, vi } from 'vitest';
import { HttpClient } from '@astroid/core';
import {
  getPolicySimulationHistory,
  POLICY_SIMULATION_HISTORY_PATH,
  PolicyResource,
  type PolicySimulationHistoryEntry,
} from '../index.js';

function createHttpClient(responseBody: unknown): {
  client: HttpClient;
  fetchMock: ReturnType<typeof vi.fn>;
} {
  const fetchMock = vi.fn(
    async () =>
      new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  );
  const client = new HttpClient({
    apiKey: 'test',
    baseUrl: 'https://api.test',
    retry: false,
    fetch: fetchMock as unknown as typeof fetch,
  });

  return { client, fetchMock };
}

describe('policy simulation history', () => {
  const entry: PolicySimulationHistoryEntry = {
    id: 'sim_1',
    policyId: 'pol_1',
    agentId: 'agent_1',
    passed: false,
    createdAt: '2026-11-20T12:00:00.000Z',
  };
  const meta = {
    page: 2,
    limit: 10,
    total: 14,
    totalPages: 2,
    hasNextPage: false,
    hasPreviousPage: true,
  };

  it('fetches a filtered page and preserves the response envelope', async () => {
    const { client, fetchMock } = createHttpClient({ data: [entry], meta });

    const result = await getPolicySimulationHistory(client, {
      page: 2,
      limit: 10,
      from: '2026-11-01T00:00:00.000Z',
      to: '2026-11-30T23:59:59.000Z',
      agentId: 'agent_1',
      policyId: 'pol_1',
      passed: false,
    });

    expect(result).toEqual({ data: [entry], meta });
    const requestUrl = new URL(fetchMock.mock.calls[0]?.[0] as string);
    expect(requestUrl.pathname).toBe(`/v1${POLICY_SIMULATION_HISTORY_PATH}`);
    expect(requestUrl.searchParams.get('page')).toBe('2');
    expect(requestUrl.searchParams.get('limit')).toBe('10');
    expect(requestUrl.searchParams.get('from')).toBe('2026-11-01T00:00:00.000Z');
    expect(requestUrl.searchParams.get('to')).toBe('2026-11-30T23:59:59.000Z');
    expect(requestUrl.searchParams.get('agentId')).toBe('agent_1');
    expect(requestUrl.searchParams.get('policyId')).toBe('pol_1');
    expect(requestUrl.searchParams.get('passed')).toBe('false');
  });

  it('is available through the policies resource', async () => {
    const { client } = createHttpClient({ data: [entry], meta });
    const result = await new PolicyResource(client).getPolicySimulationHistory({
      policyId: 'pol_1',
    });

    expect(result).toEqual({ data: [entry], meta });
  });
});

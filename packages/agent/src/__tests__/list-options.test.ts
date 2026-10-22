import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildQueryString } from '@astroid/core';
import type { Agent } from '@astroid/types';

import { AgentResource, type AgentListOptions } from '../index.js';

function createClientMock() {
  return {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  };
}

function makeAgent(id: string): Agent {
  return {
    id,
    organizationId: 'org_1',
    name: `Agent ${id}`,
    role: 'OPERATIONS',
    status: 'ACTIVE',
    capabilities: [],
    metadata: {},
    createdAt: '2026-10-22T10:00:00.000Z',
    updatedAt: '2026-10-22T10:00:00.000Z',
  };
}

/** A raw list response as the HTTP client hands it back (already unwrapped). */
function page(data: Agent[]) {
  return { data, requestId: undefined, status: 200, headers: new Headers() };
}

/** The query record handed to the HTTP client by the last `get` call. */
function lastQuery(http: ReturnType<typeof createClientMock>): Record<string, string | number> {
  const call = http.get.mock.calls.at(-1);
  expect(call?.[0]).toBe('/agents');
  return (call?.[1] as { query: Record<string, string | number> }).query;
}

describe('AgentResource.list options', () => {
  let http: ReturnType<typeof createClientMock>;
  let resource: AgentResource;

  beforeEach(() => {
    http = createClientMock();
    resource = new AgentResource(http as never);
  });

  it('sends an empty query object when no options are supplied', async () => {
    http.get.mockResolvedValueOnce(page([makeAgent('a1')]));

    await resource.list();

    expect(http.get).toHaveBeenCalledWith('/agents', { query: {} });
    expect(buildQueryString(lastQuery(http))).toBe('');
  });

  it('serializes limit and cursor for keyset pagination', async () => {
    http.get.mockResolvedValueOnce(page([makeAgent('a1')]));

    await resource.list({ limit: 25, cursor: 'cur_abc' });

    expect(lastQuery(http)).toEqual({ limit: 25, cursor: 'cur_abc' });
    expect(buildQueryString(lastQuery(http))).toBe('?limit=25&cursor=cur_abc');
  });

  it('serializes the status and tag filters', async () => {
    http.get.mockResolvedValueOnce(page([]));

    await resource.list({ status: 'SUSPENDED', tag: 'trading' });

    expect(lastQuery(http)).toEqual({ status: 'SUSPENDED', tag: 'trading' });
    expect(buildQueryString(lastQuery(http))).toBe('?status=SUSPENDED&tag=trading');
  });

  it('serializes every supported option into the request URL', async () => {
    http.get.mockResolvedValueOnce(page([makeAgent('a1')]));

    const options: AgentListOptions = {
      limit: 50,
      cursor: 'cur_123',
      status: 'ACTIVE',
      role: 'OPERATIONS',
      tag: 'treasury',
      search: 'bot one',
    };
    await resource.list(options);

    expect(buildQueryString(lastQuery(http))).toBe(
      '?limit=50&cursor=cur_123&status=ACTIVE&role=OPERATIONS&tag=treasury&search=bot+one',
    );
  });

  it('drops options left undefined instead of sending them', async () => {
    http.get.mockResolvedValueOnce(page([]));

    await resource.list({ limit: 10, cursor: undefined, status: undefined, tag: undefined });

    expect(lastQuery(http)).toEqual({ limit: 10 });
    expect(buildQueryString(lastQuery(http))).toBe('?limit=10');
  });

  it('forwards pagination metadata from the response envelope', async () => {
    http.get.mockResolvedValueOnce({
      data: [makeAgent('a1')],
      meta: { page: 2, limit: 10, total: 11, totalPages: 2, nextCursor: 'cur_next' },
      status: 200,
      headers: new Headers(),
    });

    const result = await resource.list({ page: 2, limit: 10 });

    expect(result.meta?.total).toBe(11);
    expect(lastQuery(http)).toEqual({ page: 2, limit: 10 });
  });
});

describe('AgentResource.listAgents', () => {
  it('delegates to list and serializes the same options', async () => {
    const http = createClientMock();
    const resource = new AgentResource(http as never);
    http.get.mockResolvedValueOnce(page([makeAgent('a1')]));

    const result = await resource.listAgents({ limit: 5, cursor: 'cur_1', tag: 'ops' });

    expect(result.data.map((agent) => agent.id)).toEqual(['a1']);
    expect(http.get).toHaveBeenCalledWith('/agents', {
      query: { limit: 5, cursor: 'cur_1', tag: 'ops' },
    });
  });
});

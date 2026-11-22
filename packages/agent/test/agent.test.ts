import { describe, expect, it, vi } from 'vitest';
import { buildQueryString } from '@astroid/core';
import { AgentResource } from '../src/index.js';
import type { ListAgentsOptions } from '../src/types.js';

function createHttpMock() {
  return {
    get: vi.fn().mockResolvedValue({
      data: [],
      meta: { total: 0, page: 1, limit: 20, totalPages: 0, hasMore: false, nextCursor: null },
      status: 200,
      headers: new Headers(),
    }),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  };
}

describe('listAgents pagination and filtering query parameters (#558)', () => {
  it('omits query parameters when called without options', async () => {
    const http = createHttpMock();
    const resource = new AgentResource(http as never);

    await resource.listAgents();

    expect(http.get).toHaveBeenCalledWith('/agents', { query: {} });
    const q = (http.get.mock.calls[0]?.[1] as { query: Record<string, string | number> }).query;
    expect(buildQueryString(q)).toBe('');
  });

  it('constructs limit, cursor, status, and search query parameters cleanly', async () => {
    const http = createHttpMock();
    const resource = new AgentResource(http as never);
    const options: ListAgentsOptions = {
      limit: 25,
      cursor: 'cur_next_25',
      status: 'ACTIVE',
      search: 'treasury',
    };

    await resource.listAgents(options as never);

    expect(http.get).toHaveBeenCalledWith('/agents', {
      query: {
        limit: 25,
        cursor: 'cur_next_25',
        status: 'ACTIVE',
        search: 'treasury',
      },
    });
    const q = (http.get.mock.calls[0]?.[1] as { query: Record<string, string | number> }).query;
    const qs = buildQueryString(q);
    expect(qs).toContain('limit=25');
    expect(qs).toContain('cursor=cur_next_25');
    expect(qs).toContain('status=ACTIVE');
    expect(qs).toContain('search=treasury');
  });

  it('does not leak undefined option fields into the query object', async () => {
    const http = createHttpMock();
    const resource = new AgentResource(http as never);

    await resource.list({ limit: 10, cursor: undefined, status: undefined, search: 'bot' });

    const q = (http.get.mock.calls[0]?.[1] as { query: Record<string, string | number> }).query;
    expect(q).toEqual({ limit: 10, search: 'bot' });
    expect(buildQueryString(q)).not.toContain('undefined');
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Agent } from '@astroid/types';

import { AgentResource } from '../agent.js';

function createClientMock() {
  return {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  };
}

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'agt_1',
    organizationId: 'org_1',
    name: 'Test Agent',
    role: 'OPERATIONS',
    status: 'ACTIVE',
    capabilities: ['trade', 'transfer'],
    metadata: {},
    createdAt: '2026-08-29T10:00:00.000Z',
    updatedAt: '2026-08-29T10:00:00.000Z',
    ...overrides,
  };
}

function httpOk<T>(data: T) {
  return { data, requestId: undefined, status: 200, headers: new Headers() };
}

const CREATE_PARAMS = {
  name: 'NewBot',
  capabilities: ['trade'] as string[],
  initialBudget: { currency: 'USDC', amount: '500' },
};

describe('AgentResource lifecycle (issue #77)', () => {
  let http: ReturnType<typeof createClientMock>;
  let resource: AgentResource;

  beforeEach(() => {
    http = createClientMock();
    resource = new AgentResource(http as never);
  });

  it('create() POSTs typed params and returns the created agent', async () => {
    const agent = makeAgent({ name: 'NewBot' });
    http.post.mockResolvedValue(httpOk(agent));

    const result = await resource.create(CREATE_PARAMS);

    expect(result).toEqual(agent);
    expect(http.post).toHaveBeenCalledWith('/agents', CREATE_PARAMS);
  });

  it('get() GETs /agents/:id', async () => {
    const agent = makeAgent({ id: 'agt_42' });
    http.get.mockResolvedValue(httpOk(agent));

    await expect(resource.get('agt_42')).resolves.toEqual(agent);
    expect(http.get).toHaveBeenCalledWith('/agents/agt_42', {});
  });

  it('list() forwards status/role/search filters as query params', async () => {
    http.get.mockResolvedValue(httpOk([makeAgent()]));

    await resource.list({
      status: 'ACTIVE',
      role: 'OPERATIONS',
      search: 'bot',
      page: 1,
      limit: 10,
    });

    expect(http.get).toHaveBeenCalledWith('/agents', {
      query: { status: 'ACTIVE', role: 'OPERATIONS', search: 'bot', page: 1, limit: 10 },
    });
  });

  it('update() PATCHes /agents/:id', async () => {
    const updated = makeAgent({ name: 'RenamedBot' });
    http.patch.mockResolvedValue(httpOk(updated));

    const result = await resource.update('agt_1', { name: 'RenamedBot' });

    expect(result).toEqual(updated);
    expect(http.patch).toHaveBeenCalledWith('/agents/agt_1', { name: 'RenamedBot' });
  });

  it('deactivate() POSTs /agents/:id/deactivate and returns the archived agent', async () => {
    const deactivated = makeAgent({ status: 'ARCHIVED' });
    http.post.mockResolvedValue(httpOk(deactivated));

    const result = await resource.deactivate('agt_1');

    expect(result).toEqual(deactivated);
    expect(http.post).toHaveBeenCalledWith('/agents/agt_1/deactivate');
  });

  it('deactivate() percent-encodes the agent id', async () => {
    http.post.mockResolvedValue(httpOk(makeAgent({ status: 'ARCHIVED' })));

    await resource.deactivate('agt/special');

    expect(http.post).toHaveBeenCalledWith('/agents/agt%2Fspecial/deactivate');
  });
});

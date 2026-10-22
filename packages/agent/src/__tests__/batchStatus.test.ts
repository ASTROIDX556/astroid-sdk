import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AstroidError, NotFoundError } from '@astroid/errors';
import type { AgentStatusMetrics } from '@astroid/types';

import {
  AgentResource,
  AstroidValidationError,
  DEFAULT_BATCH_STATUS_CONCURRENCY,
  partitionAgentStatuses,
  type AgentStatusLookup,
} from '../index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createClientMock() {
  return { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() };
}

function httpOk<T>(data: T) {
  return { data, requestId: undefined, status: 200, headers: new Headers() };
}

function makeMetrics(
  agentId: string,
  overrides: Partial<AgentStatusMetrics> = {},
): AgentStatusMetrics {
  return {
    agentId,
    status: 'ACTIVE',
    isActive: true,
    tasksCompleted: 12,
    tasksInProgress: 1,
    currentSpend: '40.00',
    budgetRemaining: '60.00',
    lastActivityAt: '2026-10-22T09:00:00.000Z',
    uptimeSeconds: 3600,
    errorCount: 0,
    metadata: {},
    updatedAt: '2026-10-22T09:00:00.000Z',
    ...overrides,
  };
}

/** The agent id a `/agents/:id/status` path addresses. */
function idOf(path: string): string {
  return decodeURIComponent(path.split('/')[2] as string);
}

/** Answer each status request with that agent's metrics. */
function respondWithMetrics(http: ReturnType<typeof createClientMock>) {
  http.get.mockImplementation(async (path: string) => httpOk(makeMetrics(idOf(path))));
}

const notFound = (id: string) =>
  new NotFoundError(`Agent ${id} not found`, { code: 'NOT_FOUND', status: 404 });

function requested(http: ReturnType<typeof createClientMock>): string[] {
  return http.get.mock.calls.map(([path]) => idOf(path as string));
}

// ---------------------------------------------------------------------------
// batchStatus
// ---------------------------------------------------------------------------

describe('AgentResource.batchStatus()', () => {
  let http: ReturnType<typeof createClientMock>;
  let resource: AgentResource;

  beforeEach(() => {
    http = createClientMock();
    resource = new AgentResource(http as never);
  });

  describe('lookups', () => {
    it('GETs /agents/:id/status once per id and returns the metrics in input order', async () => {
      respondWithMetrics(http);

      const results = await resource.batchStatus(['agt_1', 'agt_2', 'agt_3']);

      expect(results).toEqual([
        { agentId: 'agt_1', ok: true, status: makeMetrics('agt_1') },
        { agentId: 'agt_2', ok: true, status: makeMetrics('agt_2') },
        { agentId: 'agt_3', ok: true, status: makeMetrics('agt_3') },
      ]);
      expect(http.get).toHaveBeenCalledTimes(3);
      expect(http.get).toHaveBeenCalledWith('/agents/agt_1/status', {});
    });

    it('keeps input order when responses arrive out of order', async () => {
      const delays: Record<string, number> = { agt_1: 30, agt_2: 1, agt_3: 15 };
      http.get.mockImplementation(async (path: string) => {
        const id = idOf(path);
        await new Promise((resolve) => setTimeout(resolve, delays[id]));
        return httpOk(makeMetrics(id));
      });

      const results = await resource.batchStatus(['agt_1', 'agt_2', 'agt_3']);

      expect(results.map((r) => r.agentId)).toEqual(['agt_1', 'agt_2', 'agt_3']);
    });

    it('looks an id up once when it is passed more than once', async () => {
      respondWithMetrics(http);

      const results = await resource.batchStatus(['agt_1', 'agt_2', 'agt_1', 'agt_2', 'agt_1']);

      expect(results.map((r) => r.agentId)).toEqual(['agt_1', 'agt_2']);
      expect(requested(http).sort()).toEqual(['agt_1', 'agt_2']);
    });

    it('resolves to an empty list and sends nothing for an empty batch', async () => {
      await expect(resource.batchStatus([])).resolves.toEqual([]);
      expect(http.get).not.toHaveBeenCalled();
    });

    it('URL-encodes ids that are not path-safe', async () => {
      respondWithMetrics(http);

      await resource.batchStatus(['agt/1 x']);

      expect(http.get).toHaveBeenCalledWith('/agents/agt%2F1%20x/status', {});
    });

    it('forwards request options to every lookup but not its own concurrency', async () => {
      respondWithMetrics(http);
      const options = { headers: { 'X-Trace': 'abc' }, timeoutMs: 2500, concurrency: 2 };

      await resource.batchStatus(['agt_1', 'agt_2'], options);

      for (const id of ['agt_1', 'agt_2']) {
        expect(http.get).toHaveBeenCalledWith(`/agents/${id}/status`, {
          headers: { 'X-Trace': 'abc' },
          timeoutMs: 2500,
        });
      }
    });
  });

  describe('partial failures', () => {
    it('reports a missing agent as not_found and still returns the others', async () => {
      http.get.mockImplementation(async (path: string) => {
        const id = idOf(path);
        if (id === 'agt_gone') throw notFound(id);
        return httpOk(makeMetrics(id));
      });

      const results = await resource.batchStatus(['agt_1', 'agt_gone', 'agt_2']);

      expect(results.map((r) => [r.agentId, r.ok])).toEqual([
        ['agt_1', true],
        ['agt_gone', false],
        ['agt_2', true],
      ]);
      const gone = results[1] as Extract<AgentStatusLookup, { ok: false }>;
      expect(gone.reason).toBe('not_found');
      expect(gone.error).toBeInstanceOf(NotFoundError);
    });

    it('treats any error that carries HTTP status 404 as not_found', async () => {
      http.get.mockRejectedValueOnce({ status: 404 }).mockRejectedValueOnce({ statusCode: 404 });

      const results = await resource.batchStatus(['agt_1', 'agt_2']);

      expect(results.map((r) => (r.ok ? 'ok' : r.reason))).toEqual(['not_found', 'not_found']);
    });

    it('keeps any other failure as an error entry holding the original error', async () => {
      const outage = new AstroidError('upstream down', { code: 'INTERNAL_ERROR', status: 503 });
      http.get.mockImplementation(async (path: string) => {
        const id = idOf(path);
        if (id === 'agt_2') throw outage;
        return httpOk(makeMetrics(id));
      });

      const results = await resource.batchStatus(['agt_1', 'agt_2', 'agt_3']);

      expect(results[0]?.ok).toBe(true);
      expect(results[2]?.ok).toBe(true);
      expect(results[1]).toEqual({ agentId: 'agt_2', ok: false, reason: 'error', error: outage });
    });

    it('does not reject when every lookup fails', async () => {
      http.get.mockRejectedValue(new Error('network down'));

      const results = await resource.batchStatus(['agt_1', 'agt_2']);

      expect(results.every((r) => !r.ok && r.reason === 'error')).toBe(true);
    });
  });

  describe('concurrency', () => {
    /** Track how many lookups are in flight; each one resolves after a tick. */
    function trackInFlight() {
      let inFlight = 0;
      let peak = 0;
      http.get.mockImplementation(async (path: string) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        return httpOk(makeMetrics(idOf(path)));
      });
      return () => peak;
    }

    const ids = Array.from({ length: 12 }, (_, i) => `agt_${i}`);

    it(`runs ${DEFAULT_BATCH_STATUS_CONCURRENCY} lookups at a time by default`, async () => {
      const peak = trackInFlight();

      const results = await resource.batchStatus(ids);

      expect(results).toHaveLength(12);
      expect(peak()).toBe(DEFAULT_BATCH_STATUS_CONCURRENCY);
    });

    it('honours a custom concurrency', async () => {
      const peak = trackInFlight();

      await resource.batchStatus(ids, { concurrency: 2 });

      expect(peak()).toBe(2);
    });

    it('does not start more workers than there are ids', async () => {
      const peak = trackInFlight();

      await resource.batchStatus(['agt_1', 'agt_2'], { concurrency: 50 });

      expect(peak()).toBe(2);
    });
  });

  describe('validation', () => {
    it.each([
      ['a string', 'agt_1'],
      ['undefined', undefined],
      ['null', null],
      ['an object', { 0: 'agt_1' }],
    ])('rejects %s instead of an array', async (_label, value) => {
      await expect(resource.batchStatus(value as never)).rejects.toBeInstanceOf(
        AstroidValidationError,
      );
      expect(http.get).not.toHaveBeenCalled();
    });

    it('rejects blank and non-string ids, naming their positions, before sending anything', async () => {
      const call = resource.batchStatus(['agt_1', '   ', 42 as never, 'agt_2', '' as never]);

      await expect(call).rejects.toMatchObject({
        name: 'AstroidValidationError',
        details: { field: 'agentIds', invalidIndexes: [1, 2, 4] },
      });
      expect(http.get).not.toHaveBeenCalled();
    });

    it.each([0, -1, 1.5, Number.NaN, Infinity, '3' as never])(
      'rejects concurrency %s',
      async (concurrency) => {
        await expect(resource.batchStatus(['agt_1'], { concurrency })).rejects.toMatchObject({
          name: 'AstroidValidationError',
          details: { field: 'concurrency' },
        });
        expect(http.get).not.toHaveBeenCalled();
      },
    );
  });

  describe('abort', () => {
    it('rejects with the abort reason and sends nothing when already aborted', async () => {
      const controller = new AbortController();
      const reason = new Error('stop');
      controller.abort(reason);

      await expect(resource.batchStatus(['agt_1'], { signal: controller.signal })).rejects.toBe(
        reason,
      );
      expect(http.get).not.toHaveBeenCalled();
    });

    it('starts no further lookups once the signal aborts mid-batch', async () => {
      const controller = new AbortController();
      http.get.mockImplementation(async (path: string) => {
        controller.abort(new Error('stop'));
        return httpOk(makeMetrics(idOf(path)));
      });

      await expect(
        resource.batchStatus(['agt_1', 'agt_2', 'agt_3'], {
          concurrency: 1,
          signal: controller.signal,
        }),
      ).rejects.toThrow('stop');
      expect(http.get).toHaveBeenCalledTimes(1);
    });
  });
});

// ---------------------------------------------------------------------------
// partitionAgentStatuses
// ---------------------------------------------------------------------------

describe('partitionAgentStatuses()', () => {
  it('splits results into statuses, missing ids and failures', () => {
    const boom = new Error('boom');
    const results: AgentStatusLookup[] = [
      { agentId: 'agt_1', ok: true, status: makeMetrics('agt_1') },
      { agentId: 'agt_gone', ok: false, reason: 'not_found', error: notFound('agt_gone') },
      { agentId: 'agt_2', ok: true, status: makeMetrics('agt_2', { status: 'SUSPENDED' }) },
      { agentId: 'agt_bad', ok: false, reason: 'error', error: boom },
    ];

    const { statuses, missing, failed } = partitionAgentStatuses(results);

    expect([...statuses.keys()]).toEqual(['agt_1', 'agt_2']);
    expect(statuses.get('agt_2')?.status).toBe('SUSPENDED');
    expect(missing).toEqual(['agt_gone']);
    expect(failed).toEqual([{ agentId: 'agt_bad', error: boom }]);
  });

  it('returns empty collections for no results', () => {
    expect(partitionAgentStatuses([])).toEqual({ statuses: new Map(), missing: [], failed: [] });
  });

  it('works on the output of batchStatus', async () => {
    const http = createClientMock();
    http.get.mockImplementation(async (path: string) => {
      const id = idOf(path);
      if (id === 'agt_gone') throw notFound(id);
      return httpOk(makeMetrics(id));
    });

    const results = await new AgentResource(http as never).batchStatus(['agt_1', 'agt_gone']);
    const { statuses, missing } = partitionAgentStatuses(results);

    expect([...statuses.keys()]).toEqual(['agt_1']);
    expect(missing).toEqual(['agt_gone']);
  });
});

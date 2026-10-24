import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AnalyticsClient,
  generateEventId,
  normalizeAnalyticsEvent,
  type AnalyticsFlushResult,
  type AnalyticsTransport,
} from '../src/client.js';
import type { AnalyticsEvent, AnalyticsEventBatch } from '@astroid/types';

/** Controllable clock + id factory for deterministic event normalization. */
const FIXED_NOW = 1_767_225_600_000; // 2026-01-01T00:00:00.000Z
const fixedNow = (): number => FIXED_NOW;

/** A recording transport: resolves by default, failures armed per test. */
function makeTransport() {
  const batches: AnalyticsEventBatch[] = [];
  let failuresRemaining = 0;

  const transport: AnalyticsTransport = {
    post: vi.fn(async (_path: string, body?: unknown) => {
      if (failuresRemaining > 0) {
        failuresRemaining -= 1;
        throw new Error('telemetry endpoint unavailable');
      }
      batches.push(body as AnalyticsEventBatch);
      return { data: { accepted: (body as AnalyticsEventBatch).events.length, rejected: 0 } };
    }),
  };

  return {
    transport,
    batches,
    /** Fail the next `n` post calls, then succeed. */
    failNext(n: number): void {
      failuresRemaining = n;
    },
    /** The raw spy on `post`. */
    get post(): ReturnType<typeof vi.fn> {
      return transport.post as ReturnType<typeof vi.fn>;
    },
  };
}

/** Wait for fire-and-forget microtask-scheduled flushes to settle. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await Promise.resolve();
}

describe('normalizeAnalyticsEvent', () => {
  it('fills defaults for severity, timestamp, context and properties', () => {
    const event = normalizeAnalyticsEvent(
      { name: 'agent.executed' },
      { now: fixedNow, idFactory: () => 'ae_fixed' },
    );
    expect(event).toEqual({
      id: 'ae_fixed',
      name: 'agent.executed',
      severity: 'info',
      timestamp: '2026-01-01T00:00:00.000Z',
      context: {},
      properties: {},
    });
  });

  it('preserves caller-supplied fields and copies mutable inputs', () => {
    const context = { agentId: 'agent_1' };
    const properties = { latencyMs: 42 };
    const event = normalizeAnalyticsEvent(
      {
        name: 'transaction.completed',
        severity: 'warn',
        timestamp: new Date('2026-02-01T12:00:00.000Z'),
        context,
        properties,
      },
      { idFactory: () => 'ae_1' },
    );
    expect(event.severity).toBe('warn');
    expect(event.timestamp).toBe('2026-02-01T12:00:00.000Z');
    expect(event.context).toEqual({ agentId: 'agent_1' });
    expect(event.properties).toEqual({ latencyMs: 42 });
    // Defensive copies: mutating the inputs must not alias the event.
    context.agentId = 'agent_mutated';
    properties.latencyMs = 43;
    expect(event.context.agentId).toBe('agent_1');
    expect(event.properties.latencyMs).toBe(42);
  });

  it('falls back to the clock for missing or invalid timestamps', () => {
    const fromMissing = normalizeAnalyticsEvent({ name: 'a' }, { now: fixedNow });
    const fromInvalid = normalizeAnalyticsEvent(
      { name: 'a', timestamp: 'not-a-date' },
      { now: fixedNow },
    );
    expect(fromMissing.timestamp).toBe('2026-01-01T00:00:00.000Z');
    expect(fromInvalid.timestamp).toBe('2026-01-01T00:00:00.000Z');
  });
});

describe('generateEventId', () => {
  it('generates unique, prefixed ids even within the same millisecond', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateEventId(FIXED_NOW)));
    expect(ids.size).toBe(100);
    for (const id of ids) expect(id.startsWith('ae_')).toBe(true);
  });
});

describe('AnalyticsClient — queuing', () => {
  it('queues recorded events and normalizes them on the wire', async () => {
    const t = makeTransport();
    const client = new AnalyticsClient({
      transport: t.transport,
      now: fixedNow,
      generateId: () => 'ae_test',
      flushIntervalMs: 0,
    });

    const accepted = client.record({
      name: 'transaction.completed',
      context: { transactionId: 'tx_1' },
      properties: { latencyMs: 120 },
    });

    expect(accepted).toBe(true);
    expect(client.pending).toBe(1);
    expect(t.post).not.toHaveBeenCalled(); // nothing sent without a flush

    const result = await client.flush();
    expect(result).toEqual<AnalyticsFlushResult>({
      sent: 1,
      batches: 1,
      requeued: 0,
      dropped: 0,
    });
    expect(t.batches).toHaveLength(1);
    expect(t.batches[0]!.events[0]).toMatchObject({
      id: 'ae_test',
      name: 'transaction.completed',
      severity: 'info',
      timestamp: '2026-01-01T00:00:00.000Z',
      context: { transactionId: 'tx_1' },
      properties: { latencyMs: 120 },
    });
    expect(client.pending).toBe(0);
    expect(client.stats().delivered).toBe(1);
  });

  it('posts batches to the default endpoint as an AnalyticsEventBatch', async () => {
    const t = makeTransport();
    const client = new AnalyticsClient({ transport: t.transport, flushIntervalMs: 0 });
    client.record({ name: 'sdk.init' });
    await client.flush();

    expect(t.post).toHaveBeenCalledWith(
      '/analytics/events',
      expect.objectContaining({
        events: expect.any(Array),
        sentAt: expect.any(String),
      }),
    );
  });

  it('honours a custom endpoint', async () => {
    const t = makeTransport();
    const client = new AnalyticsClient({
      transport: t.transport,
      endpoint: '/custom/ingest',
      flushIntervalMs: 0,
    });
    client.record({ name: 'sdk.init' });
    await client.flush();
    expect(t.post).toHaveBeenCalledWith('/custom/ingest', expect.any(Object));
  });

  it('recordMany accepts several events and returns the accepted count', async () => {
    const t = makeTransport();
    const client = new AnalyticsClient({ transport: t.transport, flushIntervalMs: 0 });
    const accepted = client.recordMany([
      { name: 'a' },
      { name: 'b' },
      { name: 'c' },
    ]);
    expect(accepted).toBe(3);
    expect(client.pending).toBe(3);
  });

  it('flushing an empty queue is a no-op', async () => {
    const t = makeTransport();
    const client = new AnalyticsClient({ transport: t.transport, flushIntervalMs: 0 });
    const result = await client.flush();
    expect(result).toEqual({ sent: 0, batches: 0, requeued: 0, dropped: 0 });
    expect(t.post).not.toHaveBeenCalled();
  });
});

describe('AnalyticsClient — batching', () => {
  it('auto-flushes on the microtask queue once maxBatchSize is reached, without blocking record', async () => {
    const t = makeTransport();
    const client = new AnalyticsClient({
      transport: t.transport,
      maxBatchSize: 3,
      flushIntervalMs: 0,
    });

    client.record({ name: 'e1' });
    client.record({ name: 'e2' });
    // Threshold not yet reached: no dispatch has been scheduled.
    expect(t.post).not.toHaveBeenCalled();

    client.record({ name: 'e3' }); // reaches maxBatchSize → schedules flush
    // record() stayed synchronous; delivery is deferred off the hot path.
    expect(client.pending).toBe(3);
    expect(t.post).not.toHaveBeenCalled();

    await settle();
    expect(t.post).toHaveBeenCalledTimes(1);
    expect(t.batches[0]!.events.map((e: AnalyticsEvent) => e.name)).toEqual(['e1', 'e2', 'e3']);
    expect(client.pending).toBe(0);
  });

  it('splits a large manual flush into multiple maxBatchSize batches', async () => {
    const t = makeTransport();
    const client = new AnalyticsClient({
      transport: t.transport,
      maxBatchSize: 2,
      flushIntervalMs: 0,
      maxQueueSize: 100,
    });
    client.recordMany([{ name: 'a' }, { name: 'b' }, { name: 'c' }, { name: 'd' }, { name: 'e' }]);

    const result = await client.flush();
    expect(result).toEqual({ sent: 5, batches: 3, requeued: 0, dropped: 0 });
    expect(t.batches.map((b) => b.events.length)).toEqual([2, 2, 1]);
  });

  it('periodic timer flushes events stranded below the batch threshold', async () => {
    vi.useFakeTimers();
    try {
      const t = makeTransport();
      const client = new AnalyticsClient({
        transport: t.transport,
        maxBatchSize: 10,
        flushIntervalMs: 1_000,
      });
      client.record({ name: 'lonely-event' });
      expect(t.post).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1_000);
      expect(t.post).toHaveBeenCalledTimes(1);
      expect(client.pending).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('shutdown stops the timer and drains remaining events', async () => {
    vi.useFakeTimers();
    try {
      const t = makeTransport();
      const client = new AnalyticsClient({
        transport: t.transport,
        maxBatchSize: 10,
        flushIntervalMs: 1_000,
      });
      client.record({ name: 'a' });
      const result = await client.shutdown();
      expect(result.sent).toBe(1);
      expect(client.pending).toBe(0);

      // Timer is dead: no further posts fire.
      t.post.mockClear();
      await vi.advanceTimersByTimeAsync(5_000);
      expect(t.post).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('drops the oldest events when the queue exceeds maxQueueSize', async () => {
    const t = makeTransport();
    const client = new AnalyticsClient({
      transport: t.transport,
      maxQueueSize: 2,
      flushIntervalMs: 0,
    });
    client.record({ name: 'first' });
    client.record({ name: 'second' });
    client.record({ name: 'third' }); // evicts "first"

    expect(client.pending).toBe(2);
    expect(client.stats().dropped).toBe(1);

    await client.flush();
    expect(t.batches[0]!.events.map((e: AnalyticsEvent) => e.name)).toEqual(['second', 'third']);
  });
});

describe('AnalyticsClient — disabled mode (zero overhead)', () => {
  it('is disabled by default when no transport is supplied', () => {
    const client = new AnalyticsClient();
    expect(client.isEnabled).toBe(false);
    expect(client.record({ name: 'anything' })).toBe(false);
    expect(client.pending).toBe(0);
  });

  it('drops events without touching the transport when enabled: false', async () => {
    const t = makeTransport();
    const client = new AnalyticsClient({ transport: t.transport, enabled: false });
    expect(client.record({ name: 'a' })).toBe(false);
    expect(client.recordMany([{ name: 'a' }, { name: 'b' }])).toBe(0);

    const result = await client.flush();
    expect(result).toEqual({ sent: 0, batches: 0, requeued: 0, dropped: 0 });
    expect(t.post).not.toHaveBeenCalled();
    expect(client.stats().recorded).toBe(0);
  });

  it('does not create a flush timer when disabled', async () => {
    vi.useFakeTimers();
    try {
      const t = makeTransport();
      new AnalyticsClient({ transport: t.transport, enabled: false, flushIntervalMs: 100 });
      await vi.advanceTimersByTimeAsync(10_000);
      expect(t.post).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('AnalyticsClient — failure resilience', () => {
  let client: AnalyticsClient;
  let onError: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onError = vi.fn();
  });

  afterEach(() => {
    client?.stopAutoFlush();
  });

  it('never rejects when the endpoint fails; it re-queues and reports via onError', async () => {
    const t = makeTransport();
    t.failNext(99); // always fail
    client = new AnalyticsClient({
      transport: t.transport,
      flushIntervalMs: 0,
      maxRetriesPerBatch: 2,
      onError,
    });
    client.record({ name: 'doomed' });

    const result = await client.flush(); // must not throw
    expect(result).toEqual({ sent: 0, batches: 0, requeued: 1, dropped: 0 });
    expect(client.pending).toBe(1); // retained for a later flush
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]![0]).toBeInstanceOf(Error);
    expect(onError.mock.calls[0]![1]).toBe(1);
  });

  it('delivers re-queued events once the endpoint recovers', async () => {
    const t = makeTransport();
    t.failNext(1);
    client = new AnalyticsClient({
      transport: t.transport,
      flushIntervalMs: 0,
      maxRetriesPerBatch: 1,
      onError,
    });
    client.record({ name: 'flaky' });

    const first = await client.flush();
    expect(first.requeued).toBe(1);
    expect(onError).toHaveBeenCalledTimes(1);

    const second = await client.flush(); // endpoint recovered
    expect(second).toEqual({ sent: 1, batches: 1, requeued: 0, dropped: 0 });
    expect(client.pending).toBe(0);
    expect(client.stats().delivered).toBe(1);
  });

  it('retries transient failures within a single flush', async () => {
    const t = makeTransport();
    t.failNext(2); // two transient failures, third attempt succeeds
    client = new AnalyticsClient({
      transport: t.transport,
      flushIntervalMs: 0,
      maxRetriesPerBatch: 3,
      onError,
    });
    client.record({ name: 'transient' });

    const result = await client.flush();
    expect(result).toEqual({ sent: 1, batches: 1, requeued: 0, dropped: 0 });
    expect(t.post).toHaveBeenCalledTimes(3);
    expect(onError).not.toHaveBeenCalled();
  });

  it('preserves event order across a failure: re-queued events flush before newer ones', async () => {
    const t = makeTransport();
    t.failNext(1);
    client = new AnalyticsClient({
      transport: t.transport,
      flushIntervalMs: 0,
      maxRetriesPerBatch: 1,
      onError,
    });
    client.record({ name: 'old-1' });
    client.record({ name: 'old-2' });
    await client.flush(); // fails → both re-queued at the front
    client.record({ name: 'new-1' });

    await client.flush();
    expect(t.batches.at(-1)!.events.map((e: AnalyticsEvent) => e.name)).toEqual([
      'old-1',
      'old-2',
      'new-1',
    ]);
  });

  it('drops the oldest re-queued events when the failed batch exceeds capacity', async () => {
    const t = makeTransport();
    t.failNext(99);
    client = new AnalyticsClient({
      transport: t.transport,
      flushIntervalMs: 0,
      maxRetriesPerBatch: 1,
      maxQueueSize: 2,
      onError,
    });
    // Record during the in-flight failed flush so the queue is already at
    // capacity when the batch is re-queued: only the newest events survive.
    client.record({ name: 'a' });
    client.record({ name: 'b' });
    const flushPromise = client.flush();
    client.record({ name: 'c' });
    const result = await flushPromise;

    expect(result.requeued).toBeLessThanOrEqual(2);
    expect(client.pending).toBeLessThanOrEqual(2);
    expect(result.requeued + result.dropped).toBe(2);
  });

  it('survives an onError hook that itself throws', async () => {
    const t = makeTransport();
    t.failNext(1);
    const throwingHook = vi.fn(() => {
      throw new Error('hook exploded');
    });
    client = new AnalyticsClient({
      transport: t.transport,
      flushIntervalMs: 0,
      maxRetriesPerBatch: 1,
      onError: throwingHook,
    });
    client.record({ name: 'a' });

    await expect(client.flush()).resolves.toEqual({
      sent: 0,
      batches: 0,
      requeued: 1,
      dropped: 0,
    });
    expect(throwingHook).toHaveBeenCalledTimes(1);
  });

  it('concurrent flush calls share one in-flight drain', async () => {
    const t = makeTransport();
    client = new AnalyticsClient({ transport: t.transport, flushIntervalMs: 0 });
    client.recordMany([{ name: 'a' }, { name: 'b' }]);

    const [first, second] = await Promise.all([client.flush(), client.flush()]);
    expect(first.sent).toBe(2);
    expect(second).toBe(first); // same shared outcome
    expect(t.post).toHaveBeenCalledTimes(1);
  });
});

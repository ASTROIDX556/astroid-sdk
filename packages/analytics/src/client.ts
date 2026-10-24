/**
 * `@astroid/analytics` — telemetry event tracking client (issue #380).
 *
 * An {@link AnalyticsClient} records custom agent telemetry events (financial
 * operations, SDK usage, operational logs) into an in-memory queue and ships
 * them to the telemetry ingest endpoint in batches. Design goals:
 *
 * - **Non-blocking** — {@link AnalyticsClient.record} is synchronous and cheap;
 *   batch dispatch is deferred to a microtask so recording never stalls the
 *   primary thread, and automatic flushes are fire-and-forget.
 * - **Failure-resilient** — a failing telemetry endpoint never throws into
 *   application code. Failed batches are re-queued (up to `maxQueueSize`)
 *   for a later flush, and every failure is surfaced through the optional
 *   `onError` hook instead of an exception.
 * - **Zero overhead when disabled** — with `enabled: false` (the default when
 *   no transport is supplied) every recording call returns immediately
 *   without normalizing, allocating ids, or touching the timer machinery.
 *
 * Wire DTOs ({@link AnalyticsEvent}, {@link AnalyticsEventInput},
 * {@link AnalyticsEventBatch}, {@link AnalyticsEventBatchAck}) live in
 * `@astroid/types` so the API surface and the server contract share one
 * definition.
 *
 * @module
 */

import type {
  AnalyticsEvent,
  AnalyticsEventBatch,
  AnalyticsEventBatchAck,
  AnalyticsEventInput,
  AnalyticsEventPropertyValue,
} from '@astroid/types';

/* -------------------------------------------------------------------------- */
/* Public types                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Minimal transport contract used to ship event batches.
 *
 * `HttpClient` from `@astroid/core` satisfies this structurally, and tests
 * can supply any object with a compatible `post`. Keeping the dependency
 * surface this small also means the client works with custom gateways.
 */
export interface AnalyticsTransport {
  post<TData>(
    path: string,
    body?: unknown,
    options?: Record<string, unknown>,
  ): Promise<{ data: TData }>;
}

/** Configuration for {@link AnalyticsClient}. */
export interface AnalyticsClientOptions {
  /**
   * Transport used to POST batches. When omitted the client is created in
   * disabled mode: {@link AnalyticsClient.record} is a no-op and no timers or
   * network activity are ever created (zero-overhead default).
   */
  transport?: AnalyticsTransport;
  /**
   * Explicitly enable/disable recording. Defaults to `true` when a
   * `transport` is supplied, `false` otherwise. Disabling is cheap: recorded
   * events are dropped immediately.
   */
  enabled?: boolean;
  /** Maximum events per batch request. Default `100`. Minimum `1`. */
  maxBatchSize?: number;
  /**
   * Maximum events held in the queue before new events are dropped (both on
   * record and when re-queueing a failed batch). Default `1000`. Minimum `1`.
   */
  maxQueueSize?: number;
  /**
   * Interval in milliseconds for automatic background flushing. `0` disables
   * the interval (flush manually or rely on the batch-size trigger).
   * Default `15_000`. The timer is `unref`'d in Node so it never keeps the
   * process alive.
   */
  flushIntervalMs?: number;
  /** Ingest endpoint path. Default `'/analytics/events'`. */
  endpoint?: string;
  /** Single delivery attempt budget per batch. Default `3` (i.e. 1 + 2 retries). */
  maxRetriesPerBatch?: number;
  /**
   * Invoked whenever a batch ultimately fails to deliver (after retries) and
   * its events are re-queued or dropped. Receives the error and the number of
   * events affected. Must not throw; errors from this hook are swallowed.
   */
  onError?: (error: unknown, eventCount: number) => void;
  /** Injectable clock (ms since epoch) for deterministic tests. Default `Date.now`. */
  now?: () => number;
  /** Injectable id generator for event ids. Default: time-based unique id. */
  generateId?: () => string;
}

/** Outcome of a single {@link AnalyticsClient.flush} call. */
export interface AnalyticsFlushResult {
  /** Events successfully delivered in this flush. */
  sent: number;
  /** Batches successfully delivered in this flush. */
  batches: number;
  /** Events that could not be delivered and were re-queued for a later flush. */
  requeued: number;
  /** Events dropped because the queue was at capacity. */
  dropped: number;
}

/** Snapshot of the client's queue state. */
export interface AnalyticsQueueStats {
  /** Events currently buffered. */
  pending: number;
  /** Total events accepted by {@link AnalyticsClient.record} so far. */
  recorded: number;
  /** Total events successfully delivered so far. */
  delivered: number;
  /** Total events dropped (disabled client or queue at capacity). */
  dropped: number;
  /** Whether a flush is currently in flight. */
  flushing: boolean;
}

/* -------------------------------------------------------------------------- */
/* Telemetry utilities                                                         */
/* -------------------------------------------------------------------------- */

/** Default ingest endpoint for event batches. */
export const DEFAULT_ANALYTICS_ENDPOINT = '/analytics/events';

/** Default maximum events per batch request. */
export const DEFAULT_MAX_BATCH_SIZE = 100;

/** Default maximum queue depth before events are dropped. */
export const DEFAULT_MAX_QUEUE_SIZE = 1000;

/** Default automatic flush interval (ms). */
export const DEFAULT_FLUSH_INTERVAL_MS = 15_000;

/** Default delivery attempts per batch (1 initial + 2 retries). */
export const DEFAULT_MAX_RETRIES_PER_BATCH = 3;

/**
 * Generate a unique event id without external dependencies.
 *
 * Combines the current epoch time with a monotonic counter and randomness so
 * ids stay unique even when many events are created within one millisecond.
 */
let eventIdCounter = 0;
export function generateEventId(now: number = Date.now()): string {
  eventIdCounter = (eventIdCounter + 1) % 0xffff;
  const random = Math.random().toString(36).slice(2, 10);
  return `ae_${now.toString(36)}_${eventIdCounter.toString(36)}_${random}`;
}

/**
 * Normalize a caller-supplied {@link AnalyticsEventInput} into a strict,
 * wire-ready {@link AnalyticsEvent}, filling defaults for severity,
 * timestamp, context, and properties.
 *
 * Invalid timestamps (unparseable strings, `NaN` dates) fall back to the
 * supplied clock so a bad input never leaks `null` or `Invalid Date` onto
 * the wire.
 *
 * @example
 * ```ts
 * const event = normalizeAnalyticsEvent(
 *   { name: 'transaction.completed', properties: { latencyMs: 42 } },
 *   { now: () => 1_767_225_600_000, idFactory: () => 'ae_fixed' },
 * );
 * // event.severity === 'info'; event.timestamp === '2026-01-01T00:00:00.000Z'
 * ```
 */
export function normalizeAnalyticsEvent(
  input: AnalyticsEventInput,
  options: {
    /** Clock (epoch ms) used when `timestamp` is missing or invalid. */
    now?: () => number;
    /** Id factory. Defaults to {@link generateEventId}. */
    idFactory?: () => string;
  } = {},
): AnalyticsEvent {
  const now = options.now ?? Date.now;
  const idFactory = options.idFactory ?? (() => generateEventId(now()));

  const timestamp = toIsoTimestamp(input.timestamp, now());
  const properties: Record<string, AnalyticsEventPropertyValue> = { ...(input.properties ?? {}) };

  return {
    id: idFactory(),
    name: input.name,
    severity: input.severity ?? 'info',
    timestamp,
    context: { ...(input.context ?? {}) },
    properties,
  };
}

/**
 * Coerce a `Date` or date string into an ISO-8601 UTC string, falling back
 * to `now` when the value is missing or cannot be parsed.
 */
function toIsoTimestamp(value: string | Date | undefined, now: number): string {
  if (value !== undefined) {
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return new Date(now).toISOString();
}

/* -------------------------------------------------------------------------- */
/* AnalyticsClient                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Telemetry client: records custom agent events and ships them to the ingest
 * endpoint in batches.
 *
 * Recording is synchronous and non-blocking. When the queue reaches
 * `maxBatchSize`, a flush is scheduled on the microtask queue so the caller's
 * hot path never awaits the network. A periodic timer (when `flushIntervalMs`
 * > 0) guarantees events are not stranded below the batch threshold. Both
 * automatic paths are fire-and-forget: delivery failures are re-queued and
 * reported via `onError`, never thrown to the recording caller.
 *
 * @example
 * ```ts
 * const analytics = new AnalyticsClient({
 *   transport: astroidClient, // any object with a compatible post()
 *   maxBatchSize: 50,
 *   flushIntervalMs: 10_000,
 *   onError: (err, count) => console.warn('telemetry dropped', count, err),
 * });
 *
 * analytics.record({
 *   name: 'transaction.completed',
 *   context: { agentId: 'agent_123', transactionId: 'tx_456' },
 *   properties: { latencyMs: 812, amount: '12.5' },
 * });
 *
 * await analytics.flush();   // explicit drain, e.g. on shutdown
 * ```
 */
export class AnalyticsClient {
  private readonly transport: AnalyticsTransport | undefined;
  private readonly enabled: boolean;
  private readonly maxBatchSize: number;
  private readonly maxQueueSize: number;
  private readonly endpoint: string;
  private readonly maxRetriesPerBatch: number;
  private readonly onError: ((error: unknown, eventCount: number) => void) | undefined;
  private readonly now: () => number;
  private readonly idFactory: () => string;

  /** FIFO buffer of normalized, not-yet-delivered events. */
  private readonly queue: AnalyticsEvent[] = [];
  private readonly intervalMs: number;
  private timer: ReturnType<typeof setInterval> | undefined;

  /** In-flight flush promise, so concurrent callers share one drain. */
  private inFlight: Promise<AnalyticsFlushResult> | undefined;
  private recordedCount = 0;
  private deliveredCount = 0;
  private droppedCount = 0;

  constructor(options: AnalyticsClientOptions = {}) {
    this.transport = options.transport;
    this.enabled = options.enabled ?? options.transport !== undefined;
    this.maxBatchSize = Math.max(1, Math.floor(options.maxBatchSize ?? DEFAULT_MAX_BATCH_SIZE));
    this.maxQueueSize = Math.max(1, Math.floor(options.maxQueueSize ?? DEFAULT_MAX_QUEUE_SIZE));
    this.endpoint = options.endpoint ?? DEFAULT_ANALYTICS_ENDPOINT;
    this.maxRetriesPerBatch = Math.max(
      1,
      Math.floor(options.maxRetriesPerBatch ?? DEFAULT_MAX_RETRIES_PER_BATCH),
    );
    this.onError = options.onError;
    this.now = options.now ?? Date.now;
    this.idFactory = options.generateId ?? (() => generateEventId(this.now()));

    this.intervalMs = Math.max(0, options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS);
    if (this.enabled && this.intervalMs > 0) {
      this.timer = setInterval(() => {
        // Fire-and-forget: failures are re-queued and reported via onError.
        void this.flush();
      }, this.intervalMs);
      // Never keep the Node process (or a test runner) alive on our behalf.
      (this.timer as { unref?: () => void }).unref?.();
    }
  }

  /** Whether the client records events (`false` = zero-overhead no-op). */
  get isEnabled(): boolean {
    return this.enabled;
  }

  /** Events currently buffered awaiting delivery. */
  get pending(): number {
    return this.queue.length;
  }

  /**
   * Record a telemetry event.
   *
   * Synchronous and non-blocking: the event is normalized and enqueued, and a
   * flush is scheduled on the microtask queue if the batch threshold was
   * reached. Returns `true` when the event was accepted into the queue.
   *
   * Returns `false` (doing no work at all) when the client is disabled or the
   * queue is at capacity.
   */
  record(input: AnalyticsEventInput): boolean {
    if (!this.enabled) return false;

    this.recordedCount += 1;
    const event = normalizeAnalyticsEvent(input, {
      now: this.now,
      idFactory: this.idFactory,
    });

    this.enqueue(event);
    this.maybeScheduleAutoFlush();
    return true;
  }

  /** Record several events in one call. Returns the number accepted. */
  recordMany(inputs: readonly AnalyticsEventInput[]): number {
    let accepted = 0;
    for (const input of inputs) {
      if (this.record(input)) accepted += 1;
    }
    return accepted;
  }

  /**
   * Flush the queue: deliver buffered events in batches of `maxBatchSize`
   * and return a summary of what happened.
   *
   * Never rejects. Batches that fail after `maxRetriesPerBatch` attempts are
   * re-queued at the front of the queue (bounded by `maxQueueSize`, oldest
   * events dropped first), and the failure is reported through `onError`.
   * Concurrent calls share the in-flight flush and receive its outcome.
   */
  flush(): Promise<AnalyticsFlushResult> {
    if (!this.enabled || this.transport === undefined) {
      return Promise.resolve({ sent: 0, batches: 0, requeued: 0, dropped: 0 });
    }
    if (this.inFlight) return this.inFlight;

    const run = this.drainQueue();
    this.inFlight = run;
    void run.finally(() => {
      if (this.inFlight === run) this.inFlight = undefined;
    });
    return run;
  }

  /** Drain the queue in batches until empty or a batch fails to deliver. */
  private async drainQueue(): Promise<AnalyticsFlushResult> {
    const result: AnalyticsFlushResult = { sent: 0, batches: 0, requeued: 0, dropped: 0 };
    while (this.queue.length > 0) {
      const batch = this.queue.splice(0, this.maxBatchSize);
      const delivered = await this.deliverBatch(batch);
      if (delivered) {
        result.sent += batch.length;
        result.batches += 1;
        this.deliveredCount += batch.length;
      } else {
        // Stop draining: the endpoint is failing, so further batches would
        // fail too. Re-queue this batch at the front (bounded by
        // maxQueueSize) and leave the remaining events untouched for the
        // next flush.
        const requeued = this.requeue(batch);
        result.requeued += requeued;
        result.dropped += batch.length - requeued;
        break;
      }
    }
    return result;
  }

  /**
   * Flush remaining events and stop the automatic flush timer. Call on
   * shutdown to avoid stranding events below the batch threshold.
   */
  async shutdown(): Promise<AnalyticsFlushResult> {
    this.stopAutoFlush();
    return this.flush();
  }

  /** Stop the automatic flush timer without draining the queue. */
  stopAutoFlush(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /** Snapshot of queue state, for dashboards and tests. */
  stats(): AnalyticsQueueStats {
    return {
      pending: this.queue.length,
      recorded: this.recordedCount,
      delivered: this.deliveredCount,
      dropped: this.droppedCount,
      flushing: this.inFlight !== undefined,
    };
  }

  /* ------------------------------- internals ------------------------------ */

  /** Append to the queue, dropping the oldest events at capacity. */
  private enqueue(event: AnalyticsEvent): void {
    this.queue.push(event);
    while (this.queue.length > this.maxQueueSize) {
      this.queue.shift();
      this.droppedCount += 1;
    }
  }

  /**
   * When the batch threshold is reached, schedule a fire-and-forget flush on
   * the microtask queue. Deferring (rather than awaiting inline) keeps
   * `record` synchronous and ensures recording never blocks the caller on
   * network I/O — batching stays fully off the primary thread's hot path.
   */
  private maybeScheduleAutoFlush(): void {
    if (this.queue.length < this.maxBatchSize || this.inFlight !== undefined) return;
    queueMicrotask(() => {
      // Re-check: a concurrent flush or shutdown may have drained the queue.
      if (this.inFlight === undefined && this.queue.length >= this.maxBatchSize) {
        void this.flush();
      }
    });
  }

  /**
   * Attempt delivery of one batch with bounded retries. Returns `true` when
   * the endpoint acknowledged the batch. All errors are caught — telemetry
   * must never crash the host application.
   */
  private async deliverBatch(batch: AnalyticsEvent[]): Promise<boolean> {
    if (batch.length === 0) return true;
    const body: AnalyticsEventBatch = {
      events: batch,
      sentAt: new Date(this.now()).toISOString(),
    };

    for (let attempt = 1; attempt <= this.maxRetriesPerBatch; attempt++) {
      try {
        await this.transport!.post<AnalyticsEventBatchAck>(this.endpoint, body);
        return true;
      } catch (error) {
        const isLastAttempt = attempt === this.maxRetriesPerBatch;
        if (!isLastAttempt) {
          // Brief courtesy pause before retrying so a transient blip does not
          // burn all attempts back-to-back.
          await sleep(0);
          continue;
        }
        this.reportError(error, batch.length);
        return false;
      }
    }
    return false;
  }

  /**
   * Re-queue a failed batch at the front of the queue, preserving record
   * order, and drop the oldest events if that exceeds `maxQueueSize`.
   * Returns the number of events retained.
   */
  private requeue(batch: AnalyticsEvent[]): number {
    const capacity = Math.max(0, this.maxQueueSize - this.queue.length);
    const retained = Math.min(batch.length, capacity);
    if (retained > 0) {
      const retainedEvents = batch.slice(batch.length - retained);
      this.queue.unshift(...retainedEvents);
    }
    this.droppedCount += batch.length - retained;
    return retained;
  }

  /** Invoke the error hook, isolating the host from hook failures. */
  private reportError(error: unknown, eventCount: number): void {
    if (!this.onError) return;
    try {
      this.onError(error, eventCount);
    } catch {
      // An error hook must never take down the host application.
    }
  }
}

/** Yield to the event loop for one tick (used between batch retries). */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

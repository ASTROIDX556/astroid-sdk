/**
 * A minimal, pluggable offline queue for mutating requests.
 *
 * When the SDK is configured with `enableOfflineQueue`, mutations that fail with
 * a transport (network) error are enqueued and replayed later — either manually
 * via `astroid.flushQueue()` or automatically when connectivity returns. The
 * queue is intentionally storage-agnostic: the default keeps entries in memory,
 * but any `QueueStorage` (e.g. backed by `localStorage` or AsyncStorage) can be
 * supplied.
 */

import type { RequestOptions } from './http-types.js';

/** A persisted, replayable request. */
export interface QueuedRequest {
  id: string;
  options: RequestOptions;
  enqueuedAt: string;
  attempts: number;
}

/** Pluggable persistence for the offline queue. */
export interface QueueStorage {
  load(): Promise<QueuedRequest[]> | QueuedRequest[];
  save(entries: QueuedRequest[]): Promise<void> | void;
}

/** Default in-memory storage (non-durable; resets on reload). */
export class MemoryQueueStorage implements QueueStorage {
  private entries: QueuedRequest[] = [];

  load(): QueuedRequest[] {
    return [...this.entries];
  }

  save(entries: QueuedRequest[]): void {
    this.entries = [...entries];
  }
}

/** Replays a single queued request; resolves on success, throws to keep it. */
export type QueueReplayer = (entry: QueuedRequest) => Promise<void>;

/**
 * A FIFO offline queue. `id`s are supplied by the caller (the client derives
 * them from an idempotency key or a monotonic counter) so the queue itself
 * stays free of non-deterministic time/random calls.
 */
export class OfflineQueue {
  private readonly storage: QueueStorage;

  constructor(storage: QueueStorage = new MemoryQueueStorage()) {
    this.storage = storage;
  }

  /** Append a request to the queue. */
  async enqueue(entry: QueuedRequest): Promise<void> {
    const entries = await this.storage.load();
    entries.push(entry);
    await this.storage.save(entries);
  }

  /** How many requests are waiting. */
  async size(): Promise<number> {
    return (await this.storage.load()).length;
  }

  /** A snapshot of the queued requests. */
  async list(): Promise<QueuedRequest[]> {
    return [...(await this.storage.load())];
  }

  /** Remove all queued requests. */
  async clear(): Promise<void> {
    await this.storage.save([]);
  }

  /**
   * Replay queued requests in order. A request that replays successfully is
   * removed; one that throws is kept (with its `attempts` incremented) and
   * flushing stops so ordering is preserved. Returns the number flushed.
   */
  async flush(replay: QueueReplayer): Promise<number> {
    const entries = await this.storage.load();
    let flushed = 0;
    while (entries.length > 0) {
      const entry = entries[0];
      if (!entry) break;
      try {
        await replay(entry);
        entries.shift();
        flushed += 1;
        await this.storage.save(entries);
      } catch {
        entry.attempts += 1;
        await this.storage.save(entries);
        break;
      }
    }
    return flushed;
  }
}

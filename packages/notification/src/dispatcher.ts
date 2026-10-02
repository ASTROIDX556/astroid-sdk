/**
 * `@astroid/notification` — Event dispatcher with wildcard topic filtering and routing.
 *
 * Lightweight, zero-dependency, isomorphic event router supporting exact, single-segment (*),
 * and multi-segment (**, #) topic subscriptions.
 *
 * @packageDocumentation
 */

/**
 * Handler callback invoked when a matching notification event is dispatched.
 *
 * @typeParam T - The expected payload type.
 * @param payload - The event payload.
 * @param topic - The concrete topic string on which the event was dispatched.
 */
export type NotificationHandler<T = unknown> = (
  payload: T,
  topic: string,
) => void | Promise<void>;

/**
 * Lifecycle handle returned when subscribing to a notification pattern.
 */
export interface Subscription {
  /**
   * The pattern this subscription is registered for.
   */
  readonly pattern: string;

  /**
   * Unregisters this handler from the dispatcher. Safe to call multiple times.
   */
  unsubscribe(): void;
}

/**
 * Converts a dot-separated topic pattern into a regular expression for matching.
 *
 * Supported syntax:
 * - Literal token: exact string match (e.g. `created` matches `created`).
 * - Single-token wildcard (`*`): matches exactly one segment between dots (e.g. `agent.*` matches `agent.created`).
 * - Multi-token wildcard (`**` or `#`): matches zero or more segments (e.g. `policy.**` matches `policy`, `policy.violation`, etc.).
 * - Global wildcard (`*`, `**`, `#` alone): matches any topic.
 *
 * @param pattern - The topic routing pattern.
 * @returns A compiled RegExp instance.
 */
export function patternToRegExp(pattern: string): RegExp {
  const trimmed = pattern.trim();
  if (trimmed === '*' || trimmed === '#' || trimmed === '**') {
    return /^.*$/;
  }

  const segments = trimmed.split('.');
  const regexTokens: string[] = [];

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]!;
    if (segment === '**' || segment === '#') {
      if (i === segments.length - 1 && i > 0) {
        regexTokens.push('(?:\\..*)?');
      } else if (i === 0 && segments.length > 1) {
        regexTokens.push('(?:.*\\.)?');
      } else {
        regexTokens.push('.*');
      }
    } else if (segment === '*') {
      if (i > 0 && !(regexTokens[i - 1]?.endsWith('?') || regexTokens[i - 1]?.endsWith('.'))) {
        regexTokens.push('\\.[^.]+');
      } else {
        regexTokens.push('[^.]+');
      }
    } else {
      const escaped = segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (i > 0 && !(regexTokens[i - 1]?.endsWith('?') || regexTokens[i - 1]?.endsWith('.'))) {
        regexTokens.push('\\.' + escaped);
      } else {
        regexTokens.push(escaped);
      }
    }
  }

  return new RegExp(`^${regexTokens.join('')}$`);
}

/**
 * Configuration options for the NotificationDispatcher.
 */
export interface NotificationDispatcherOptions {
  /**
   * Optional logger or error callback invoked when an asynchronous handler fails.
   */
  onError?: (error: unknown, topic: string, pattern: string) => void;
}

/**
 * Internal listener record mapping pattern strings to their compiled regex and handlers.
 */
interface ListenerRecord {
  pattern: string;
  regex: RegExp;
  handlers: Set<NotificationHandler<any>>;
}

/**
 * Lightweight, high-performance notification and event routing dispatcher.
 *
 * Allows client applications and autonomous agent systems to register topic-based
 * event handlers supporting single (`*`) and multi-segment (`**`, `#`) wildcards.
 *
 * Isomorphic: does not depend on Node.js core modules (`events`), allowing seamless
 * execution across browsers, Node.js runtimes, Cloudflare Workers, and Deno.
 *
 * @example
 * ```ts
 * import { NotificationDispatcher } from '@astroid/notification';
 *
 * const dispatcher = new NotificationDispatcher();
 *
 * // Subscribe to all agent events
 * const sub = dispatcher.subscribe('agent.*', (event, topic) => {
 *   console.log(`Agent event on [${topic}]:`, event);
 * });
 *
 * // Dispatch event
 * await dispatcher.dispatch('agent.created', { agentId: 'ag_123', name: 'StellarBot' });
 *
 * // Unsubscribe when done
 * sub.unsubscribe();
 * ```
 */
export class NotificationDispatcher {
  private readonly listeners = new Map<string, ListenerRecord>();
  private readonly onError?: (error: unknown, topic: string, pattern: string) => void;

  constructor(options?: NotificationDispatcherOptions) {
    this.onError = options?.onError;
  }

  /**
   * Registers a callback handler for the given topic pattern.
   *
   * @typeParam T - Expected payload data type.
   * @param pattern - Topic routing key (e.g. `policy.violation`, `agent.*`, `audit.**`, `#`).
   * @param handler - Function invoked whenever an event matching `pattern` is dispatched.
   * @returns A `Subscription` handle with an `unsubscribe()` method.
   * @throws {TypeError} If pattern is empty/whitespace or handler is not a function.
   */
  subscribe<T = unknown>(pattern: string, handler: NotificationHandler<T>): Subscription {
    if (!pattern || typeof pattern !== 'string' || pattern.trim() === '') {
      throw new TypeError('Subscription pattern must be a non-empty string');
    }
    if (typeof handler !== 'function') {
      throw new TypeError('Notification handler must be a callable function');
    }

    const normalizedPattern = pattern.trim();
    let record = this.listeners.get(normalizedPattern);

    if (!record) {
      record = {
        pattern: normalizedPattern,
        regex: patternToRegExp(normalizedPattern),
        handlers: new Set(),
      };
      this.listeners.set(normalizedPattern, record);
    }

    record.handlers.add(handler);

    let unsubscribed = false;
    return {
      pattern: normalizedPattern,
      unsubscribe: () => {
        if (unsubscribed) return;
        unsubscribed = true;
        this.unsubscribe(normalizedPattern, handler);
      },
    };
  }

  /**
   * Unregisters a specific handler callback previously registered to a pattern.
   *
   * @param pattern - Topic routing pattern.
   * @param handler - The exact callback function to remove.
   * @returns `true` if the handler was found and removed, `false` otherwise.
   */
  unsubscribe(pattern: string, handler: NotificationHandler<any>): boolean {
    if (!pattern || typeof pattern !== 'string') return false;
    const normalizedPattern = pattern.trim();
    const record = this.listeners.get(normalizedPattern);
    if (!record) return false;

    const removed = record.handlers.delete(handler);
    if (record.handlers.size === 0) {
      this.listeners.delete(normalizedPattern);
    }
    return removed;
  }

  /**
   * Dispatches an event payload asynchronously to all matching subscribers.
   *
   * Handlers are executed concurrently. If any handler rejects, `onError` is called
   * if configured; after all handlers settle, an `AggregateError` (or single Error)
   * is thrown if one or more handlers failed.
   *
   * @typeParam T - Payload type.
   * @param topic - Concrete topic identifier (e.g. `agent.created`).
   * @param payload - Event data payload.
   * @throws {TypeError} If topic is not a non-empty string.
   */
  async dispatch<T = unknown>(topic: string, payload: T): Promise<void> {
    if (!topic || typeof topic !== 'string' || topic.trim() === '') {
      throw new TypeError('Dispatch topic must be a non-empty string');
    }

    const normalizedTopic = topic.trim();
    const invocationList: { pattern: string; handler: NotificationHandler<T> }[] = [];

    for (const record of this.listeners.values()) {
      if (record.regex.test(normalizedTopic)) {
        for (const handler of record.handlers) {
          invocationList.push({ pattern: record.pattern, handler });
        }
      }
    }

    if (invocationList.length === 0) {
      return;
    }

    const promises = invocationList.map(async ({ pattern, handler }) => {
      try {
        await handler(payload, normalizedTopic);
      } catch (err) {
        if (this.onError) {
          this.onError(err, normalizedTopic, pattern);
        }
        throw err;
      }
    });

    const results = await Promise.allSettled(promises);
    const errors = results
      .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      .map((r) => r.reason);

    if (errors.length > 0) {
      if (errors.length === 1) {
        throw errors[0];
      }
      throw new AggregateError(
        errors,
        `Errors occurred while dispatching topic "${normalizedTopic}" to ${errors.length} handlers`,
      );
    }
  }

  /**
   * Dispatches an event payload synchronously to all matching subscribers.
   *
   * @typeParam T - Payload type.
   * @param topic - Concrete topic identifier (e.g. `policy.violation`).
   * @param payload - Event data payload.
   * @throws {TypeError} If topic is not a non-empty string.
   */
  dispatchSync<T = unknown>(topic: string, payload: T): void {
    if (!topic || typeof topic !== 'string' || topic.trim() === '') {
      throw new TypeError('Dispatch topic must be a non-empty string');
    }

    const normalizedTopic = topic.trim();
    const errors: unknown[] = [];

    for (const record of this.listeners.values()) {
      if (record.regex.test(normalizedTopic)) {
        for (const handler of record.handlers) {
          try {
            handler(payload, normalizedTopic);
          } catch (err) {
            if (this.onError) {
              this.onError(err, normalizedTopic, record.pattern);
            }
            errors.push(err);
          }
        }
      }
    }

    if (errors.length > 0) {
      if (errors.length === 1) {
        throw errors[0];
      }
      throw new AggregateError(
        errors,
        `Errors occurred while synchronously dispatching topic "${normalizedTopic}"`,
      );
    }
  }

  /**
   * Returns the count of registered listeners.
   *
   * @param pattern - Optional pattern filter. If supplied, returns listeners registered for that exact pattern.
   *                  If omitted, returns the total listeners across all patterns.
   */
  listenerCount(pattern?: string): number {
    if (pattern !== undefined) {
      return this.listeners.get(pattern.trim())?.handlers.size ?? 0;
    }
    let count = 0;
    for (const record of this.listeners.values()) {
      count += record.handlers.size;
    }
    return count;
  }

  /**
   * Returns a copy of all distinct active subscription patterns currently registered.
   */
  patterns(): string[] {
    return Array.from(this.listeners.keys());
  }

  /**
   * Checks whether any listeners are registered for a specific topic pattern.
   *
   * @param pattern - The topic routing pattern to check.
   */
  hasSubscribers(pattern: string): boolean {
    return (this.listeners.get(pattern.trim())?.handlers.size ?? 0) > 0;
  }

  /**
   * Unregisters all handlers and cleans up all pattern records.
   */
  clear(): void {
    this.listeners.clear();
  }
}

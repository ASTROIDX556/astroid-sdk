import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { isAgentStatus, type Agent, type AgentStatus } from '@astroid/types';

import { queryKeys, useAstroidClient } from '../hooks.js';

/* -------------------------------------------------------------------------- */
/* Public types                                                                */
/* -------------------------------------------------------------------------- */

/** Default SSE event names that carry agent status updates. */
export const AGENT_STREAM_STATUS_EVENTS: readonly string[] = Object.freeze([
  'status',
  'status_change',
  'agent.status',
  'agent_status',
]);

/** Error message delivered when no EventSource implementation is available. */
const NO_EVENT_SOURCE_MESSAGE =
  'useAgentStream: EventSource is not available in this environment. Pass an "eventSourceFactory" option or run in a browser.';

/**
 * Constructor used to create the underlying event source.
 *
 * Defaults to the browser's `EventSource`. Supply your own to use a polyfill,
 * an authenticated transport, or a deterministic fake in tests.
 */
export type AgentStreamEventSourceFactory = (
  url: string,
  init?: EventSourceInit,
) => EventSource;

/** A single parsed event from the agent stream. */
export interface AgentStreamEvent {
  /** The agent the event belongs to. */
  agentId: string;
  /** The SSE event name (`'message'` for unnamed events). */
  type: string;
  /** The parsed payload (`JSON.parse`d when possible, otherwise the raw string). */
  data: unknown;
  /** The agent status carried by the event, when one was present. */
  status?: AgentStatus;
  /** ISO-8601 timestamp of when the event was received locally. */
  receivedAt: string;
}

/** Options for {@link useAgentStream}. */
export interface UseAgentStreamOptions {
  /**
   * Whether to open the stream. Defaults to `true`. When `false` (or when
   * `agentId` is `undefined`) no connection is made and the hook is idle.
   */
  enabled?: boolean;
  /**
   * Stream URL, or a function that builds one from the agent id. Defaults to
   * `${baseUrl}/${apiVersion}/agents/:id/stream` using the provider's client.
   */
  url?: string | ((agentId: string) => string);
  /**
   * Additional named SSE events to listen for. Status events are always
   * listened for unless this option is supplied, in which case it replaces the
   * default {@link AGENT_STREAM_STATUS_EVENTS} list (`'message'` events are
   * always handled).
   */
  eventTypes?: readonly string[];
  /** Forwarded to `EventSource` as `withCredentials`. Defaults to `false`. */
  withCredentials?: boolean;
  /**
   * Maximum consecutive reconnection attempts after a dropped connection.
   * Defaults to `5`; use `Infinity` to retry forever and `0` to disable
   * automatic reconnection.
   */
  maxRetries?: number;
  /** Base delay before the first reconnection attempt, in ms. Default `1000`. */
  initialRetryDelayMs?: number;
  /** Upper bound for any single reconnection delay, in ms. Default `30000`. */
  maxRetryDelayMs?: number;
  /** Exponential multiplier applied per attempt. Default `2`. */
  backoffFactor?: number;
  /**
   * Jitter fraction in `[0, 1]`, or `true`/`false` for full/no jitter. The
   * delay is randomised in `[base * (1 - jitter), base]` so reconnecting
   * dashboards do not thunder-herd a recovering backend. Default `0.25`.
   */
  jitter?: number | boolean;
  /** Called for every parsed stream event. */
  onEvent?: (event: AgentStreamEvent) => void;
  /** Called when an event carries a new agent status. */
  onStatusChange?: (status: AgentStatus, event: AgentStreamEvent) => void;
  /**
   * Whether to patch the TanStack Query agent-detail cache when a status event
   * arrives. Defaults to `true`, so `useAgent()` re-renders without polling.
   */
  updateQueryCache?: boolean;
  /** Custom `EventSource` factory (polyfills, tests, authenticated transports). */
  eventSourceFactory?: AgentStreamEventSourceFactory;
}

/** Everything {@link useAgentStream} exposes to consumers. */
export interface UseAgentStreamResult {
  /** `true` while the stream is open and receiving events. */
  isConnected: boolean;
  /** `true` while connecting, including between reconnection attempts. */
  isConnecting: boolean;
  /** The last connection error, or `null` once connected again. */
  error: Error | null;
  /** The parsed payload of the most recent event, or `null` before the first. */
  data: unknown;
  /** The most recent parsed event, including its name and timestamp. */
  lastEvent: AgentStreamEvent | null;
  /** The most recent agent status seen on the stream, if any. */
  status: AgentStatus | undefined;
  /** Consecutive reconnection attempts made for the current connection. */
  retryCount: number;
  /** Discard the current connection and open a fresh one (resets retries). */
  reconnect: () => void;
  /** Close the stream and stop reconnecting until {@link reconnect} is called. */
  disconnect: () => void;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

interface AgentStreamState {
  isConnected: boolean;
  isConnecting: boolean;
  error: Error | null;
  data: unknown;
  lastEvent: AgentStreamEvent | null;
  status: AgentStatus | undefined;
  retryCount: number;
}

function initialState(agentId: string | undefined, enabled: boolean): AgentStreamState {
  return {
    isConnected: false,
    isConnecting: Boolean(agentId) && enabled,
    error: null,
    data: null,
    lastEvent: null,
    status: undefined,
    retryCount: 0,
  };
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

/** Parse an SSE `data` field as JSON, falling back to the raw string. */
function parsePayload(raw: string): unknown {
  if (raw === '') return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

/** Read an {@link AgentStatus} from a payload, looking through nested envelopes. */
function extractStatus(payload: unknown): AgentStatus | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const record = payload as Record<string, unknown>;

  for (const key of ['status', 'newStatus', 'agentStatus']) {
    const candidate = record[key];
    if (isAgentStatus(candidate)) return candidate;
  }
  for (const key of ['data', 'agent', 'payload', 'event']) {
    const nested = record[key];
    if (nested && typeof nested === 'object') {
      const status = extractStatus(nested);
      if (status) return status;
    }
  }
  return undefined;
}

/** Resolve the effective EventSource constructor, if any. */
function defaultEventSourceFactory(): AgentStreamEventSourceFactory | undefined {
  const Constructor = (globalThis as { EventSource?: typeof EventSource }).EventSource;
  if (!Constructor) return undefined;
  return (url, init) => new Constructor(url, init);
}

/* -------------------------------------------------------------------------- */
/* Hook                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Subscribe to an agent's real-time status stream over Server-Sent Events.
 *
 * Connects to the Astroid agent stream (or a URL you supply), parses each
 * event, and exposes connection state, the latest status and the full event to
 * the component. Dropped connections are retried with **exponential backoff
 * and jitter**; the stream is closed and every timer is cleared on unmount, so
 * navigating away never leaks an open connection. Status events also patch the
 * TanStack Query agent-detail cache, so `useAgent(id)` reflects the new status
 * without extra polling.
 *
 * @param agentId The agent to stream, or `undefined` to stay idle.
 * @param options Connection, retry and callback options.
 * @returns A {@link UseAgentStreamResult}.
 *
 * @example
 * ```tsx
 * const { status, isConnected, error } = useAgentStream(agentId, {
 *   onStatusChange: (status) => console.log('agent is now', status),
 * });
 *
 * return (
 *   <p>
 *     {isConnected ? 'live' : 'reconnecting'} — {status ?? 'unknown'}
 *     {error ? ` (${error.message})` : ''}
 *   </p>
 * );
 * ```
 */
export function useAgentStream(
  agentId: string | undefined,
  options: UseAgentStreamOptions = {},
): UseAgentStreamResult {
  const astroid = useAstroidClient();
  const queryClient = useQueryClient();

  const {
    enabled = true,
    url,
    eventTypes,
    withCredentials = false,
    maxRetries = 5,
    initialRetryDelayMs = 1_000,
    maxRetryDelayMs = 30_000,
    backoffFactor = 2,
    jitter = 0.25,
    eventSourceFactory,
  } = options;

  const [state, setState] = useState<AgentStreamState>(() =>
    initialState(agentId, enabled),
  );
  const [retryNonce, setRetryNonce] = useState(0);
  const [manuallyDisconnected, setManuallyDisconnected] = useState(false);

  const callbacksRef = useRef({
    onEvent: options.onEvent,
    onStatusChange: options.onStatusChange,
    updateQueryCache: options.updateQueryCache !== false,
  });

  useEffect(() => {
    callbacksRef.current = {
      onEvent: options.onEvent,
      onStatusChange: options.onStatusChange,
      updateQueryCache: options.updateQueryCache !== false,
    };
  }, [options.onEvent, options.onStatusChange, options.updateQueryCache]);

  // Reset any previous agent's data when the hook is pointed at a new agent.
  useEffect(() => {
    setState(initialState(agentId, enabled && !manuallyDisconnected));
  }, [agentId]);

  const active = Boolean(agentId) && enabled && !manuallyDisconnected;
  const eventTypesKey = (eventTypes ?? AGENT_STREAM_STATUS_EVENTS).join('\u0000');

  useEffect(() => {
    if (!active || !agentId) {
      setState((previous) =>
        previous.isConnected || previous.isConnecting
          ? { ...previous, isConnected: false, isConnecting: false }
          : previous,
      );
      return;
    }

    let disposed = false;
    let attempt = 0;
    let source: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const update = (updater: (previous: AgentStreamState) => AgentStreamState): void => {
      if (!disposed) setState(updater);
    };

    const watchedEvents = eventTypesKey === '' ? [] : eventTypesKey.split('\u0000');

    const resolveUrl = (): string => {
      if (typeof url === 'function') return url(agentId);
      if (typeof url === 'string') return url;
      const config = astroid.http.config;
      const base = config.baseUrl.replace(/\/+$/, '');
      return `${base}/${config.apiVersion}/agents/${encodeURIComponent(agentId)}/stream`;
    };

    const closeSource = (): void => {
      if (!source) return;
      try {
        source.onopen = null;
        source.onerror = null;
        source.onmessage = null;
        source.close();
      } catch {
        // A failing close must not prevent the connection from being dropped.
      }
      source = null;
    };

    const handleEvent = (eventType: string, raw: string): void => {
      const data = parsePayload(raw);
      const status = extractStatus(data);
      const event: AgentStreamEvent = {
        agentId,
        type: eventType,
        data,
        receivedAt: new Date().toISOString(),
        ...(status ? { status } : {}),
      };

      update((previous) => ({
        ...previous,
        data,
        lastEvent: event,
        ...(status ? { status } : {}),
      }));

      if (status) {
        callbacksRef.current.onStatusChange?.(status, event);
        if (callbacksRef.current.updateQueryCache) {
          queryClient.setQueryData<Agent | undefined>(
            queryKeys.agents.detail(agentId),
            (previous) => (previous ? { ...previous, status } : previous),
          );
        }
      }
      callbacksRef.current.onEvent?.(event);
    };

    const scheduleReconnect = (error: Error): void => {
      if (disposed) return;
      if (attempt >= maxRetries) {
        update((previous) => ({
          ...previous,
          isConnected: false,
          isConnecting: false,
          error,
          retryCount: attempt,
        }));
        return;
      }

      attempt += 1;
      const exponential = Math.min(
        maxRetryDelayMs,
        initialRetryDelayMs * Math.pow(backoffFactor, attempt - 1),
      );
      const jitterFraction = jitter === true ? 1 : jitter === false ? 0 : Math.min(1, Math.max(0, jitter));
      const delay = Math.max(
        0,
        Math.round(exponential * (1 - jitterFraction + Math.random() * jitterFraction)),
      );

      update((previous) => ({
        ...previous,
        isConnected: false,
        isConnecting: true,
        error,
        retryCount: attempt,
      }));

      timer = setTimeout(() => {
        timer = null;
        open();
      }, delay);
    };

    const open = (): void => {
      if (disposed) return;
      closeSource();

      const factory = eventSourceFactory ?? defaultEventSourceFactory();
      if (!factory) {
        update((previous) => ({
          ...previous,
          isConnected: false,
          isConnecting: false,
          error: new Error(NO_EVENT_SOURCE_MESSAGE),
        }));
        return;
      }

      update((previous) => ({ ...previous, isConnecting: true, error: null }));

      let nextSource: EventSource;
      try {
        nextSource = factory(
          resolveUrl(),
          withCredentials ? { withCredentials: true } : undefined,
        );
      } catch (error) {
        scheduleReconnect(toError(error));
        return;
      }

      source = nextSource;

      nextSource.onopen = () => {
        attempt = 0;
        update((previous) => ({
          ...previous,
          isConnected: true,
          isConnecting: false,
          error: null,
          retryCount: 0,
        }));
      };

      nextSource.onerror = () => {
        if (disposed) return;
        closeSource();
        scheduleReconnect(new Error(`Agent stream connection lost for "${agentId}".`));
      };

      const listener = (eventType: string) => (event: Event) => {
        if (disposed) return;
        const message = event as MessageEvent<unknown>;
        const raw =
          typeof message.data === 'string' ? message.data : JSON.stringify(message.data);
        handleEvent(eventType, raw);
      };

      nextSource.onmessage = listener('message');
      for (const eventType of watchedEvents) {
        if (eventType === 'message') continue;
        nextSource.addEventListener(eventType, listener(eventType));
      }
    };

    open();

    return () => {
      disposed = true;
      if (timer !== null) clearTimeout(timer);
      closeSource();
    };
  }, [
    active,
    agentId,
    url,
    withCredentials,
    maxRetries,
    initialRetryDelayMs,
    maxRetryDelayMs,
    backoffFactor,
    jitter,
    eventTypesKey,
    eventSourceFactory,
    retryNonce,
    queryClient,
    astroid,
  ]);

  const reconnect = useCallback(() => {
    setManuallyDisconnected(false);
    setState((previous) => ({ ...previous, error: null, retryCount: 0 }));
    setRetryNonce((nonce) => nonce + 1);
  }, []);

  const disconnect = useCallback(() => {
    setManuallyDisconnected(true);
    setState((previous) => ({
      ...previous,
      isConnected: false,
      isConnecting: false,
    }));
  }, []);

  return {
    ...state,
    reconnect,
    disconnect,
  };
}

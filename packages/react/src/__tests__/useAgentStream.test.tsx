import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { Agent } from '@astroid/types';
import type { Astroid } from '@astroid/client';

import { AstroidProvider } from '../provider.js';
import { queryKeys } from '../hooks.js';
import {
  useAgentStream,
  type AgentStreamEventSourceFactory,
  type UseAgentStreamOptions,
} from '../hooks/useAgentStream.js';
import { AGENT_A } from './test-utils.js';

/* -------------------------------------------------------------------------- */
/* Mock EventSource                                                            */
/* -------------------------------------------------------------------------- */

class MockEventSource {
  static instances: MockEventSource[] = [];

  readonly url: string;
  readonly init: EventSourceInit | undefined;
  readyState = 0;
  closed = false;
  onopen: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;

  private readonly listeners = new Map<string, Set<(event: Event) => void>>();

  constructor(url: string, init?: EventSourceInit) {
    this.url = url;
    this.init = init;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (event: Event) => void): void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, listener: (event: Event) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  close(): void {
    this.closed = true;
    this.readyState = 2;
  }

  emitOpen(): void {
    this.readyState = 1;
    this.onopen?.(new Event('open'));
  }

  emitError(): void {
    this.onerror?.(new Event('error'));
  }

  emitMessage(payload: unknown, type = 'message'): void {
    const event = {
      data: typeof payload === 'string' ? payload : JSON.stringify(payload),
    } as MessageEvent;
    if (type === 'message') this.onmessage?.(event);
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

const factory: AgentStreamEventSourceFactory = (url, init) =>
  new MockEventSource(url, init) as unknown as EventSource;

/* -------------------------------------------------------------------------- */
/* Harness                                                                     */
/* -------------------------------------------------------------------------- */

function createClient(): Astroid {
  return {
    http: {
      config: { baseUrl: 'https://api.test', apiVersion: 'v1' },
    },
  } as unknown as Astroid;
}

function setup(options: UseAgentStreamOptions = {}, agentId: string | undefined = 'agent_1') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const client = createClient();

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <AstroidProvider client={client}>{children}</AstroidProvider>
      </QueryClientProvider>
    );
  }

  const rendered = renderHook(
    () => useAgentStream(agentId, { eventSourceFactory: factory, jitter: false, ...options }),
    { wrapper: Wrapper },
  );

  return { ...rendered, queryClient };
}

beforeEach(() => {
  MockEventSource.instances = [];
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/* -------------------------------------------------------------------------- */
/* Tests                                                                       */
/* -------------------------------------------------------------------------- */

describe('useAgentStream (#528)', () => {
  it('connects to the default agent stream URL and exposes connection state', () => {
    const { result } = setup();

    expect(MockEventSource.instances).toHaveLength(1);
    const source = MockEventSource.instances[0] as MockEventSource;
    expect(source.url).toBe('https://api.test/v1/agents/agent_1/stream');
    expect(result.current.isConnecting).toBe(true);
    expect(result.current.isConnected).toBe(false);

    act(() => source.emitOpen());

    expect(result.current.isConnected).toBe(true);
    expect(result.current.isConnecting).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('parses message events and exposes the latest status and data', () => {
    const onEvent = vi.fn();
    const onStatusChange = vi.fn();
    const { result } = setup({ onEvent, onStatusChange });

    const source = MockEventSource.instances[0] as MockEventSource;
    act(() => source.emitOpen());
    act(() => source.emitMessage({ status: 'PAUSED', reason: 'manual' }));

    expect(result.current.status).toBe('PAUSED');
    expect(result.current.data).toEqual({ status: 'PAUSED', reason: 'manual' });
    expect(result.current.lastEvent?.type).toBe('message');
    expect(result.current.lastEvent?.status).toBe('PAUSED');
    expect(result.current.lastEvent?.receivedAt).toEqual(expect.any(String));
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onStatusChange).toHaveBeenCalledWith('PAUSED', expect.objectContaining({ type: 'message' }));
  });

  it('listens for named status events and nested payloads', () => {
    const { result } = setup();

    const source = MockEventSource.instances[0] as MockEventSource;
    act(() => source.emitOpen());
    act(() => source.emitMessage({ data: { status: 'SUSPENDED' } }, 'status'));

    expect(result.current.status).toBe('SUSPENDED');
    expect(result.current.lastEvent?.type).toBe('status');
  });

  it('patches the TanStack Query agent-detail cache with the new status', () => {
    const { result, queryClient } = setup();
    queryClient.setQueryData<Agent>(queryKeys.agents.detail('agent_1'), AGENT_A);

    const source = MockEventSource.instances[0] as MockEventSource;
    act(() => source.emitOpen());
    act(() => source.emitMessage({ status: 'ARCHIVED' }));

    expect(result.current.status).toBe('ARCHIVED');
    expect(queryClient.getQueryData<Agent>(queryKeys.agents.detail('agent_1'))?.status).toBe(
      'ARCHIVED',
    );
  });

  it('can opt out of cache updates and tolerates a missing cache entry', () => {
    const { result, queryClient } = setup({ updateQueryCache: false });
    const source = MockEventSource.instances[0] as MockEventSource;
    act(() => source.emitOpen());
    act(() => source.emitMessage({ status: 'PAUSED' }));

    expect(result.current.status).toBe('PAUSED');
    expect(queryClient.getQueryData(queryKeys.agents.detail('agent_1'))).toBeUndefined();
  });

  it('honours a custom URL and withCredentials option', () => {
    setup({
      url: 'https://stream.example.test/agents/agent_1',
      withCredentials: true,
    });

    const source = MockEventSource.instances[0] as MockEventSource;
    expect(source.url).toBe('https://stream.example.test/agents/agent_1');
    expect(source.init).toEqual({ withCredentials: true });
  });

  it('does not connect when disabled or without an agent id', () => {
    const disabled = setup({ enabled: false });
    expect(MockEventSource.instances).toHaveLength(0);
    expect(disabled.result.current.isConnecting).toBe(false);

    MockEventSource.instances = [];
    // An empty id is treated as "no agent" and must not open a connection.
    setup({}, '');
    expect(MockEventSource.instances).toHaveLength(0);
  });

  it('reconnects with exponential backoff after a dropped connection', () => {
    const { result } = setup({ initialRetryDelayMs: 1_000, maxRetries: 3 });

    const first = MockEventSource.instances[0] as MockEventSource;
    act(() => first.emitOpen());
    act(() => first.emitError());

    expect(result.current.isConnected).toBe(false);
    expect(result.current.isConnecting).toBe(true);
    expect(result.current.retryCount).toBe(1);
    expect(result.current.error).toBeInstanceOf(Error);
    expect(first.closed).toBe(true);

    act(() => vi.advanceTimersByTime(1_000));
    expect(MockEventSource.instances).toHaveLength(2);

    const second = MockEventSource.instances[1] as MockEventSource;
    expect(second.url).toBe(first.url);
    act(() => second.emitOpen());
    expect(result.current.isConnected).toBe(true);
    expect(result.current.retryCount).toBe(0);
  });

  it('applies increasing delays across consecutive failures', () => {
    setup({ initialRetryDelayMs: 100, backoffFactor: 2, maxRetries: 5 });

    act(() => (MockEventSource.instances[0] as MockEventSource).emitError());
    act(() => vi.advanceTimersByTime(100));
    expect(MockEventSource.instances).toHaveLength(2);

    act(() => (MockEventSource.instances[1] as MockEventSource).emitError());
    // The second attempt waits 200ms, so 100ms is not enough.
    act(() => vi.advanceTimersByTime(100));
    expect(MockEventSource.instances).toHaveLength(2);
    act(() => vi.advanceTimersByTime(100));
    expect(MockEventSource.instances).toHaveLength(3);
  });

  it('stops reconnecting after maxRetries and reports the error', () => {
    const { result } = setup({ initialRetryDelayMs: 50, maxRetries: 1 });

    act(() => (MockEventSource.instances[0] as MockEventSource).emitError());
    act(() => vi.advanceTimersByTime(50));
    expect(MockEventSource.instances).toHaveLength(2);

    act(() => (MockEventSource.instances[1] as MockEventSource).emitError());
    act(() => vi.advanceTimersByTime(60_000));

    expect(MockEventSource.instances).toHaveLength(2);
    expect(result.current.isConnecting).toBe(false);
    expect(result.current.error).not.toBeNull();
  });

  it('closes the connection and clears reconnection timers on unmount', () => {
    const { unmount } = setup();
    const source = MockEventSource.instances[0] as MockEventSource;

    act(() => source.emitOpen());
    act(() => source.emitError());
    unmount();

    expect(source.closed).toBe(true);
    act(() => vi.advanceTimersByTime(60_000));
    expect(MockEventSource.instances).toHaveLength(1);
  });

  it('supports manual disconnect and reconnect', () => {
    const { result } = setup();
    const first = MockEventSource.instances[0] as MockEventSource;
    act(() => first.emitOpen());

    act(() => result.current.disconnect());
    expect(result.current.isConnected).toBe(false);
    expect(first.closed).toBe(true);

    act(() => vi.advanceTimersByTime(60_000));
    expect(MockEventSource.instances).toHaveLength(1);

    act(() => result.current.reconnect());
    expect(MockEventSource.instances).toHaveLength(2);
  });

  it('treats non-JSON payloads as raw data', () => {
    const { result } = setup();
    const source = MockEventSource.instances[0] as MockEventSource;
    act(() => source.emitOpen());
    act(() => source.emitMessage('plain text'));

    expect(result.current.data).toBe('plain text');
    expect(result.current.status).toBeUndefined();
  });
});

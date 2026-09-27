import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Astroid, AstroidTimeoutError, DEFAULT_TIMEOUT_MS } from '../src/index.js';

/** A fetch that never settles until its AbortSignal fires. */
function hangingFetch(): typeof fetch {
  return (async (_url, init) => {
    const signal = init?.signal as AbortSignal | undefined;
    return new Promise<never>((_resolve, reject) => {
      if (signal?.aborted) {
        reject(new DOMException('The operation was aborted.', 'AbortError'));
        return;
      }
      signal?.addEventListener('abort', () => {
        reject(new DOMException('The operation was aborted.', 'AbortError'));
      });
    });
  }) as unknown as typeof fetch;
}

function okFetch(): typeof fetch {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ success: true, data: { ok: true } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  ) as unknown as typeof fetch;
}

describe('request timeout handling (#263)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('defaults the resolved client timeout to 30 seconds', () => {
    const client = new Astroid({ apiKey: 'sk_test', fetch: okFetch() });
    expect(client.http.config.timeoutMs).toBe(DEFAULT_TIMEOUT_MS);
    expect(client.http.config.timeoutMs).toBe(30_000);
  });

  it('aborts a hung request at the 30s default and throws the distinct timeout error', async () => {
    const client = new Astroid({
      apiKey: 'sk_test',
      retry: false,
      fetch: hangingFetch(),
    });

    const pending = client.http.get('/wallets/w_1');
    const assertion = expect(pending).rejects.toBeInstanceOf(AstroidTimeoutError);
    await vi.advanceTimersByTimeAsync(30_000);
    await assertion;

    await expect(pending).rejects.toMatchObject({
      code: 'REQUEST_TIMEOUT',
      timeoutMs: 30_000,
      isRetryable: true,
    });
  });

  it('leaves the request pending at 29_999ms (boundary)', async () => {
    const client = new Astroid({
      apiKey: 'sk_test',
      retry: false,
      fetch: hangingFetch(),
    });

    let outcome: 'pending' | 'resolved' | 'rejected' = 'pending';
    const pending = client.http.get('/wallets/w_1');
    pending.then(
      () => (outcome = 'resolved'),
      () => (outcome = 'rejected'),
    );

    await vi.advanceTimersByTimeAsync(29_999);
    expect(outcome).toBe('pending');

    await vi.advanceTimersByTimeAsync(1);
    expect(outcome).toBe('rejected');
    await expect(pending).rejects.toBeInstanceOf(AstroidTimeoutError);
  });

  it('honours a global `timeout` option override', async () => {
    const client = new Astroid({
      apiKey: 'sk_test',
      timeout: 40,
      retry: false,
      fetch: hangingFetch(),
    });

    const pending = client.http.get('/wallets/w_1');
    const assertion = expect(pending).rejects.toMatchObject({ timeoutMs: 40 });
    await vi.advanceTimersByTimeAsync(40);
    await assertion;
  });

  it('honours a per-request `timeoutMs` override over the global value', async () => {
    const client = new Astroid({
      apiKey: 'sk_test',
      timeout: 5_000,
      retry: false,
      fetch: hangingFetch(),
    });

    const pending = client.http.get('/wallets/w_1', { timeoutMs: 50 });
    const assertion = expect(pending).rejects.toBeInstanceOf(AstroidTimeoutError);
    // The 5s global timer must NOT have fired yet — only the 50ms override.
    await vi.advanceTimersByTimeAsync(50);
    await assertion;

    await expect(pending).rejects.toMatchObject({ timeoutMs: 50 });
  });

  it('passes an internal AbortSignal to fetch so the transport is actually cancelled', async () => {
    const fetchMock = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal as AbortSignal | undefined;
          signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          });
        }),
    ) as unknown as typeof fetch & { mock: { calls: unknown[][] } };

    const client = new Astroid({
      apiKey: 'sk_test',
      timeout: 25,
      retry: false,
      fetch: fetchMock,
    });

    const pending = client.http.get('/wallets/w_1');
    const assertion = expect(pending).rejects.toBeInstanceOf(AstroidTimeoutError);
    await vi.advanceTimersByTimeAsync(25);
    await assertion;

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(init?.signal?.aborted).toBe(true);
  });

  it('rejects with a plain AbortError — not a timeout — when the caller aborts first', async () => {
    const controller = new AbortController();
    const client = new Astroid({
      apiKey: 'sk_test',
      timeout: 30_000,
      retry: false,
      fetch: hangingFetch(),
    });

    const pending = client.http.get('/wallets/w_1', { signal: controller.signal });
    const assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await assertion;

    // Well past the deadline: the outcome must remain the caller's abort.
    await vi.advanceTimersByTimeAsync(60_000);
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('resolves normally when the response arrives before the deadline', async () => {
    const fetchMock = okFetch();
    const client = new Astroid({
      apiKey: 'sk_test',
      retry: false,
      fetch: fetchMock,
    });

    const res = await client.http.get<{ ok: boolean }>('/wallets/w_1');
    expect(res.data).toEqual({ ok: true });

    // Advancing far past the deadline must not retroactively fail the request.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

import { describe, expect, it, vi } from 'vitest';
import {
  Astroid,
  AstroidError,
  AstroidTimeoutError,
  NetworkError,
  isAstroidError,
} from '../index.js';
import { DEFAULT_TIMEOUT_MS } from '../index.js';
import { isTimeoutError } from '@astroid/errors';

/** A fetch that never settles until its AbortSignal fires. */
function hangingFetch(): typeof fetch {
  return (async (_url: RequestInfo | URL, init?: RequestInit) => {
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

describe('AstroidTimeoutError is part of the core error hierarchy (#80)', () => {
  it('extends NetworkError / AstroidError so catch blocks and guards work', () => {
    const err = new AstroidTimeoutError(500);
    expect(err).toBeInstanceOf(AstroidTimeoutError);
    expect(err).toBeInstanceOf(NetworkError);
    expect(err).toBeInstanceOf(AstroidError);
    expect(isAstroidError(err)).toBe(true);
    expect(isTimeoutError(err)).toBe(true);
    expect(err.code).toBe('REQUEST_TIMEOUT');
    expect(err.errorCode).toBe('REQUEST_TIMEOUT');
    expect(err.isRetryable).toBe(true);
    expect(err.retryable).toBe(true);
    expect(err.timeoutMs).toBe(500);
    // No HTTP response was ever received, so there is no status.
    expect(err.status).toBeUndefined();
  });

  it('serialises through toJSON like every other Astroid error', () => {
    const err = new AstroidTimeoutError(1_000);
    expect(err.toJSON()).toMatchObject({
      name: 'AstroidTimeoutError',
      code: 'REQUEST_TIMEOUT',
      message: 'Astroid request timed out after 1000ms.',
    });
  });

  it('is thrown by the client when a request exceeds its deadline', async () => {
    const client = new Astroid({
      apiKey: 'sk_test',
      retry: false,
      timeout: 5,
      fetch: hangingFetch(),
    });

    await expect(client.http.get('/wallets/w_1')).rejects.toMatchObject({
      name: 'AstroidTimeoutError',
      code: 'REQUEST_TIMEOUT',
    });
    await expect(client.http.get('/wallets/w_1')).rejects.toSatisfy(isAstroidError);
  });

  it('is thrown through resource methods and matches NetworkError-style handling', async () => {
    const client = new Astroid({
      apiKey: 'sk_test',
      retry: false,
      timeout: 5,
      fetch: hangingFetch(),
    });

    try {
      await client.wallets.get('w_1');
      expect.unreachable('expected a timeout error');
    } catch (err) {
      expect(isTimeoutError(err)).toBe(true);
      // A timeout is a transport failure: identical handling to NetworkError.
      expect(isAstroidError(err)).toBe(true);
    }
  });
});

describe('timeout config hardening (#80)', () => {
  it('falls back to the 30s default for zero, negative and non-finite timeouts', () => {
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const client = new Astroid({
        apiKey: 'sk_test',
        timeout: bad as never,
        fetch: vi.fn() as unknown as typeof fetch,
      });
      expect(client.http.config.timeoutMs).toBe(DEFAULT_TIMEOUT_MS);
    }
  });

  it('falls back to the default for an invalid per-request timeout override', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: { data: 'ok' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const client = new Astroid({
      apiKey: 'sk_test',
      fetch: fetchMock as unknown as typeof fetch,
    });

    // `timeoutMs: 0` must NOT turn into an instant timeout — the request
    // completes normally using the default deadline.
    const res = await client.http.get<{ data: string }>('/wallets/w_1', {
      timeoutMs: 0,
    });
    expect(res.data).toEqual({ data: 'ok' });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

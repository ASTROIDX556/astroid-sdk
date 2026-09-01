import { describe, it, expect, vi } from 'vitest';
import { AuthenticationError } from '@astroid/errors';
import { Astroid } from './index.js';

/* -------------------------------------------------------------------------- */
/* Test helpers                                                                */
/* -------------------------------------------------------------------------- */

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function errorResponse(status: number, message: string, code = 'UNAUTHORIZED'): Response {
  return new Response(JSON.stringify({ error: { message, code } }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const STATIC_TOKEN = 'static_bearer_token';
const NEW_TOKEN = 'fresh_dynamic_token';

/* -------------------------------------------------------------------------- */
/* 401 Automatic Token Refresh Interceptor & Queuing                            */
/* -------------------------------------------------------------------------- */

describe('401 Automatic Token Refresh Interceptor & Queuing', () => {
  const initialAccessToken = 'initial_expired_access_token';
  const initialRefreshToken = 'valid_refresh_token';
  const newAccessToken = 'new_fresh_access_token';
  const newRefreshToken = 'new_fresh_refresh_token';

  it('Scenario 1: Access token returns 401, refresh succeeds, original call completes successfully and triggers onTokenUpdate', async () => {
    const onTokenUpdate = vi.fn();
    let refreshCallCount = 0;

    const mockFetch = vi
      .fn()
      .mockImplementation(async (url: string | URL, options?: RequestInit) => {
        const urlStr = url.toString();
        const headers = (options?.headers as Record<string, string>) ?? {};

        if (urlStr.includes('/auth/refresh')) {
          refreshCallCount++;
          return new Response(
            JSON.stringify({
              accessToken: newAccessToken,
              refreshToken: newRefreshToken,
              tokenType: 'Bearer',
              expiresIn: 3600,
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }

        if (urlStr.includes('/wallets/w_1')) {
          if (headers.authorization === `Bearer ${newAccessToken}`) {
            return new Response(JSON.stringify({ data: { id: 'w_1', address: 'G123' } }), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            });
          }
          return new Response(
            JSON.stringify({ error: { message: 'Token expired', code: 'TOKEN_EXPIRED' } }),
            { status: 401, headers: { 'content-type': 'application/json' } },
          );
        }

        return new Response(JSON.stringify({}), { status: 404 });
      });

    const client = new Astroid({
      accessToken: initialAccessToken,
      refreshToken: initialRefreshToken,
      baseUrl: 'https://api.astroid.test/v1',
      fetch: mockFetch as unknown as typeof fetch,
      onTokenUpdate,
    });

    const wallet = await client.wallets.get('w_1');

    expect(wallet).toEqual({ id: 'w_1', address: 'G123' });
    expect(refreshCallCount).toBe(1);
    expect(onTokenUpdate).toHaveBeenCalledWith({
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      expiresIn: expect.any(Number),
      tokenType: 'Bearer',
    });
    expect(client.sessionManager.getAccessToken()).toBe(newAccessToken);
  });

  it('Scenario 2: Multiple concurrent calls hit 401, only ONE refresh request is dispatched, and all original calls complete successfully', async () => {
    let refreshCallCount = 0;

    const mockFetch = vi
      .fn()
      .mockImplementation(async (url: string | URL, options?: RequestInit) => {
        const urlStr = url.toString();
        const headers = (options?.headers as Record<string, string>) ?? {};

        if (urlStr.includes('/auth/refresh')) {
          refreshCallCount++;
          await new Promise((res) => setTimeout(res, 40));
          return new Response(
            JSON.stringify({
              accessToken: newAccessToken,
              refreshToken: newRefreshToken,
              tokenType: 'Bearer',
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }

        if (headers.authorization === `Bearer ${newAccessToken}`) {
          return new Response(JSON.stringify({ data: { success: true, url: urlStr } }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }

        return new Response(
          JSON.stringify({ error: { message: 'Unauthorized', code: 'UNAUTHORIZED' } }),
          { status: 401, headers: { 'content-type': 'application/json' } },
        );
      });

    const client = new Astroid({
      accessToken: initialAccessToken,
      refreshToken: initialRefreshToken,
      baseUrl: 'https://api.astroid.test/v1',
      fetch: mockFetch as unknown as typeof fetch,
    });

    const [res1, res2, res3, res4] = await Promise.all([
      client.wallets.get('w1'),
      client.agents.get('a1'),
      client.policies.get('p1'),
      client.budgets.get('b1'),
    ]);

    expect(refreshCallCount).toBe(1);
    expect(res1).toBeDefined();
    expect(res2).toBeDefined();
    expect(res3).toBeDefined();
    expect(res4).toBeDefined();
    expect(client.sessionManager.getAccessToken()).toBe(newAccessToken);
  });

  it('Scenario 3: Refresh fails, all pending requests are aborted with a clean authentication error', async () => {
    const mockFetch = vi.fn().mockImplementation(async (url: string | URL) => {
      const urlStr = url.toString();

      if (urlStr.includes('/auth/refresh')) {
        return new Response(
          JSON.stringify({ error: { message: 'Refresh token revoked', code: 'TOKEN_INVALID' } }),
          { status: 401, headers: { 'content-type': 'application/json' } },
        );
      }

      return new Response(
        JSON.stringify({ error: { message: 'Unauthorized', code: 'UNAUTHORIZED' } }),
        { status: 401, headers: { 'content-type': 'application/json' } },
      );
    });

    const client = new Astroid({
      accessToken: initialAccessToken,
      refreshToken: initialRefreshToken,
      baseUrl: 'https://api.astroid.test/v1',
      fetch: mockFetch as unknown as typeof fetch,
    });

    const promises = [client.wallets.get('w1'), client.agents.get('a1')];

    await Promise.all(promises.map((p) => expect(p).rejects.toThrow(AuthenticationError)));

    expect(client.sessionManager.getAccessToken()).toBeUndefined();
    expect(client.sessionManager.getRefreshToken()).toBeUndefined();
  });
});

/* -------------------------------------------------------------------------- */
/* Dynamic Bearer Token Interceptor (issue #5)                                 */
/* -------------------------------------------------------------------------- */

describe('Dynamic Bearer Token Interceptor', () => {
  /* ---- Header injection ---- */

  it('injects Authorization header with a static token', async () => {
    const mockFetch = vi.fn().mockImplementation(async (_url: string | URL, opts?: RequestInit) => {
      const headers = (opts?.headers as Record<string, string>) ?? {};
      expect(headers.authorization).toBe(`Bearer ${STATIC_TOKEN}`);
      return jsonResponse({ data: { ok: true } });
    });

    const client = new Astroid({
      accessToken: STATIC_TOKEN,
      baseUrl: 'https://api.astroid.test/v1',
      fetch: mockFetch as unknown as typeof fetch,
    });

    await client.wallets.get('w1');
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('injects Authorization header using a dynamic token function', async () => {
    const tokenProvider = vi.fn().mockResolvedValue(NEW_TOKEN);

    const mockFetch = vi.fn().mockImplementation(async (_url: string | URL, opts?: RequestInit) => {
      const headers = (opts?.headers as Record<string, string>) ?? {};
      expect(headers.authorization).toBe(`Bearer ${NEW_TOKEN}`);
      return jsonResponse({ data: { ok: true } });
    });

    const client = new Astroid({
      accessToken: tokenProvider,
      baseUrl: 'https://api.astroid.test/v1',
      fetch: mockFetch as unknown as typeof fetch,
    });

    await client.wallets.get('w1');
    expect(tokenProvider).toHaveBeenCalledOnce();
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('evaluates the token function before every request', async () => {
    let counter = 0;
    const tokenProvider = vi.fn().mockImplementation(async () => `token_${++counter}`);

    const mockFetch = vi.fn().mockImplementation(async () => jsonResponse({ data: { ok: true } }));

    const client = new Astroid({
      accessToken: tokenProvider,
      baseUrl: 'https://api.astroid.test/v1',
      fetch: mockFetch as unknown as typeof fetch,
    });

    await client.wallets.get('w1');
    await client.agents.get('a1');

    expect(tokenProvider).toHaveBeenCalledTimes(2);
    const firstCall = mockFetch.mock.calls[0]![1] as RequestInit;
    const secondCall = mockFetch.mock.calls[1]![1] as RequestInit;
    expect((firstCall.headers as Record<string, string>).authorization).toBe('Bearer token_1');
    expect((secondCall.headers as Record<string, string>).authorization).toBe('Bearer token_2');
  });

  /* ---- 401 retry with dynamic token ---- */

  it('retries with a fresh token on HTTP 401 when a dynamic token function is provided', async () => {
    let callCount = 0;
    const tokenProvider = vi.fn().mockImplementation(async () => {
      callCount++;
      return callCount === 1 ? 'expired_token' : NEW_TOKEN;
    });

    const mockFetch = vi.fn().mockImplementation(async (_url: string | URL, opts?: RequestInit) => {
      const headers = (opts?.headers as Record<string, string>) ?? {};
      const urlStr = _url.toString();
      if (urlStr.includes('/wallets/') && headers.authorization === `Bearer ${NEW_TOKEN}`) {
        return jsonResponse({ data: { id: 'w1', address: 'GABC' } });
      }
      return errorResponse(401, 'Token expired', 'TOKEN_EXPIRED');
    });

    const client = new Astroid({
      accessToken: tokenProvider,
      baseUrl: 'https://api.astroid.test/v1',
      fetch: mockFetch as unknown as typeof fetch,
    });

    const wallet = await client.wallets.get('w1');
    expect(wallet).toEqual({ id: 'w1', address: 'GABC' });
    expect(tokenProvider).toHaveBeenCalledTimes(2);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('propagates error after retry fails even with dynamic token', async () => {
    const tokenProvider = vi.fn().mockResolvedValue('still_bad_token');

    const mockFetch = vi.fn().mockImplementation(async (_url: string | URL) => {
      return errorResponse(401, 'Unauthorized', 'UNAUTHORIZED');
    });

    const client = new Astroid({
      accessToken: tokenProvider,
      baseUrl: 'https://api.astroid.test/v1',
      fetch: mockFetch as unknown as typeof fetch,
    });

    await expect(client.wallets.get('w1')).rejects.toThrow(AuthenticationError);
    expect(tokenProvider).toHaveBeenCalledTimes(2);
  });

  it('does not retry 401 on auth endpoints even with dynamic token', async () => {
    const tokenProvider = vi.fn().mockResolvedValue(NEW_TOKEN);

    const mockFetch = vi.fn().mockImplementation(async () => {
      return errorResponse(401, 'Invalid credentials', 'AUTHENTICATION_ERROR');
    });

    const client = new Astroid({
      accessToken: tokenProvider,
      baseUrl: 'https://api.astroid.test/v1',
      fetch: mockFetch as unknown as typeof fetch,
    });

    await expect(
      client.http.post('/auth/login', { email: 'a@b.com', password: 'x' }),
    ).rejects.toThrow();
    expect(tokenProvider).toHaveBeenCalledTimes(1);
  });

  /* ---- Concurrent token refresh deduplication ---- */

  it('deduplicates concurrent token provider calls (single in-flight promise)', async () => {
    let providerCallCount = 0;
    const tokenProvider = vi.fn().mockImplementation(async () => {
      providerCallCount++;
      await new Promise((r) => setTimeout(r, 50));
      return `deduped_token_${providerCallCount}`;
    });

    const mockFetch = vi.fn().mockImplementation(async () => jsonResponse({ data: { ok: true } }));

    const client = new Astroid({
      accessToken: tokenProvider,
      baseUrl: 'https://api.astroid.test/v1',
      fetch: mockFetch as unknown as typeof fetch,
    });

    await Promise.all([
      client.wallets.get('w1'),
      client.agents.get('a1'),
      client.policies.get('p1'),
      client.budgets.get('b1'),
      client.transactions.list(),
    ]);

    expect(tokenProvider).toHaveBeenCalledTimes(1);
    for (const call of mockFetch.mock.calls) {
      const headers = (call[1] as RequestInit)?.headers as Record<string, string>;
      expect(headers?.authorization).toBe('Bearer deduped_token_1');
    }
  });

  it('re-evaluates token after the cached promise settles', async () => {
    let tokenVersion = 0;
    const tokenProvider = vi.fn().mockImplementation(async () => `v${++tokenVersion}`);

    const mockFetch = vi.fn().mockImplementation(async () => jsonResponse({ data: { ok: true } }));

    const client = new Astroid({
      accessToken: tokenProvider,
      baseUrl: 'https://api.astroid.test/v1',
      fetch: mockFetch as unknown as typeof fetch,
    });

    // First batch — should share token v1
    await Promise.all([client.wallets.get('w1'), client.agents.get('a1')]);
    const firstToken = (mockFetch.mock.calls[0]![1] as RequestInit).headers;
    expect((firstToken as Record<string, string>).authorization).toBe('Bearer v1');

    // Second batch — after the first promise settled, gets a fresh token v2
    await Promise.all([client.wallets.get('w2'), client.agents.get('a2')]);
    const secondToken = (mockFetch.mock.calls[2]![1] as RequestInit).headers;
    expect((secondToken as Record<string, string>).authorization).toBe('Bearer v2');

    expect(tokenProvider).toHaveBeenCalledTimes(2);
  });

  /* ---- setTokenProvider runtime wiring ---- */

  it('allows setting a token provider at runtime via setTokenProvider()', async () => {
    const mockFetch = vi.fn().mockImplementation(async () => jsonResponse({ data: { ok: true } }));

    const client = new Astroid({
      accessToken: 'initial_static',
      baseUrl: 'https://api.astroid.test/v1',
      fetch: mockFetch as unknown as typeof fetch,
    });

    // Switch to a dynamic token provider at runtime
    const dynamicProvider = vi.fn().mockResolvedValue('runtime_dynamic_token');
    client.http.setTokenProvider(dynamicProvider);

    await client.wallets.get('w1');
    expect(dynamicProvider).toHaveBeenCalledOnce();
    const headers = (mockFetch.mock.calls[0]![1] as RequestInit).headers;
    expect((headers as Record<string, string>).authorization).toBe('Bearer runtime_dynamic_token');
  });
});

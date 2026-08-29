import { describe, it, expect, vi } from 'vitest';
import { AuthenticationError } from '@astroid/errors';
import { Astroid } from './index.js';

describe('401 Automatic Token Refresh Interceptor & Queuing', () => {
  const initialAccessToken = 'initial_expired_access_token';
  const initialRefreshToken = 'valid_refresh_token';
  const newAccessToken = 'new_fresh_access_token';
  const newRefreshToken = 'new_fresh_refresh_token';

  it('Scenario 1: Access token returns 401, refresh succeeds, original call completes successfully and triggers onTokenUpdate', async () => {
    const onTokenUpdate = vi.fn();
    let refreshCallCount = 0;

    const mockFetch = vi.fn().mockImplementation(async (url: string | URL, options?: RequestInit) => {
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
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }

      if (urlStr.includes('/wallets/w_1')) {
        if (headers.authorization === `Bearer ${newAccessToken}`) {
          return new Response(
            JSON.stringify({ data: { id: 'w_1', address: 'G123' } }),
            { status: 200, headers: { 'content-type': 'application/json' } }
          );
        }
        return new Response(
          JSON.stringify({ error: { message: 'Token expired', code: 'TOKEN_EXPIRED' } }),
          { status: 401, headers: { 'content-type': 'application/json' } }
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

    const mockFetch = vi.fn().mockImplementation(async (url: string | URL, options?: RequestInit) => {
      const urlStr = url.toString();
      const headers = (options?.headers as Record<string, string>) ?? {};

      if (urlStr.includes('/auth/refresh')) {
        refreshCallCount++;
        // Introduce slight delay to test concurrency race window
        await new Promise((res) => setTimeout(res, 40));
        return new Response(
          JSON.stringify({
            accessToken: newAccessToken,
            refreshToken: newRefreshToken,
            tokenType: 'Bearer',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }

      if (headers.authorization === `Bearer ${newAccessToken}`) {
        return new Response(
          JSON.stringify({ data: { success: true, url: urlStr } }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ error: { message: 'Unauthorized', code: 'UNAUTHORIZED' } }),
        { status: 401, headers: { 'content-type': 'application/json' } }
      );
    });

    const client = new Astroid({
      accessToken: initialAccessToken,
      refreshToken: initialRefreshToken,
      baseUrl: 'https://api.astroid.test/v1',
      fetch: mockFetch as unknown as typeof fetch,
    });

    // Fire 4 parallel requests concurrently
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
          { status: 401, headers: { 'content-type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ error: { message: 'Unauthorized', code: 'UNAUTHORIZED' } }),
        { status: 401, headers: { 'content-type': 'application/json' } }
      );
    });

    const client = new Astroid({
      accessToken: initialAccessToken,
      refreshToken: initialRefreshToken,
      baseUrl: 'https://api.astroid.test/v1',
      fetch: mockFetch as unknown as typeof fetch,
    });

    const promises = [
      client.wallets.get('w1'),
      client.agents.get('a1'),
    ];

    await Promise.all(
      promises.map((p) =>
        expect(p).rejects.toThrow(AuthenticationError)
      )
    );

    expect(client.sessionManager.getAccessToken()).toBeUndefined();
    expect(client.sessionManager.getRefreshToken()).toBeUndefined();
  });
});

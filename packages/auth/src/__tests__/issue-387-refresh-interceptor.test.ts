import { describe, it, expect, vi } from 'vitest';
import { HttpClient } from '@astroid/core';
import type { PreparedRequest } from '@astroid/core';
import type { AuthTokens } from '@astroid/types';
import { SessionManager } from '../session.js';
import { RefreshManager, wireRefreshManagerToHttpClient } from '../refresh.js';
import { wireSessionToHttpClient, createSessionMiddleware } from '../auth.js';

describe('Issue #387 — Token Refresh Interceptor in @astroid/auth', () => {
  function makeJwt(expSecondsFromNow: number): string {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({ sub: 'user_123', exp: Math.floor(Date.now() / 1000) + expSecondsFromNow }),
    ).toString('base64url');
    return `${header}.${payload}.signature`;
  }

  function mock401Response(): Response {
    return new Response(JSON.stringify({ error: { message: 'Unauthorized' } }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }

  function mock200Response(body: unknown = { ok: true }): Response {
    return new Response(JSON.stringify({ success: true, data: body }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }

  it('intercepts 401 response, refreshes token via RefreshManager, and retries request', async () => {
    const expiredToken = makeJwt(-10);
    const renewedToken = makeJwt(3600);

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mock401Response())
      .mockResolvedValueOnce(mock200Response({ message: 'recovered' }));

    const client = new HttpClient({
      apiKey: 'test-key',
      baseUrl: 'https://api.astroid.test',
      fetch: fetchMock as unknown as typeof fetch,
      retry: false,
    });

    const sessionManager = new SessionManager({
      accessToken: expiredToken,
      refreshToken: 'valid-refresh-token',
    });

    const refreshFn = vi.fn(async (): Promise<AuthTokens> => ({
      accessToken: renewedToken,
      refreshToken: 'rotated-refresh-token',
      tokenType: 'Bearer',
      expiresIn: 3600,
    }));

    const refreshManager = new RefreshManager({ sessionManager, refreshFn });
    wireRefreshManagerToHttpClient(client, refreshManager);

    const response = await client.get<{ message: string }>('/protected-resource');

    expect(response.status).toBe(200);
    expect(response.data).toEqual({ message: 'recovered' });
    expect(refreshFn).toHaveBeenCalledTimes(1);
    expect(client.config.auth.accessToken).toBe(renewedToken);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('safely queues concurrent requests while token refresh is in progress', async () => {
    const renewedToken = makeJwt(3600);
    const refreshResolvers: (() => void)[] = [];

    const refreshFn = vi.fn(async (): Promise<AuthTokens> => {
      await new Promise<void>((resolve) => {
        refreshResolvers.push(resolve);
      });
      return {
        accessToken: renewedToken,
        refreshToken: 'next-refresh-token',
        tokenType: 'Bearer',
        expiresIn: 3600,
      };
    });

    const sessionManager = new SessionManager({
      accessToken: makeJwt(-60),
      refreshToken: 'active-refresh-token',
    });

    // Launch multiple concurrent refreshes
    const p1 = sessionManager.refreshSession(refreshFn);
    const p2 = sessionManager.refreshSession(refreshFn);
    const p3 = sessionManager.refreshSession(refreshFn);

    expect(sessionManager.isRefreshing()).toBe(true);
    expect(refreshFn).toHaveBeenCalledTimes(1);

    // Resolve in-flight refresh
    refreshResolvers.forEach((r) => r());

    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
    expect(r1.accessToken).toBe(renewedToken);
    expect(r2.accessToken).toBe(renewedToken);
    expect(r3.accessToken).toBe(renewedToken);
    expect(sessionManager.isRefreshing()).toBe(false);
  });

  it('prevents infinite loops when refresh fails by clearing tokens and propagating error', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mock401Response());

    const client = new HttpClient({
      apiKey: 'test-key',
      baseUrl: 'https://api.astroid.test',
      fetch: fetchMock as unknown as typeof fetch,
      retry: false,
    });

    const sessionManager = new SessionManager({
      accessToken: makeJwt(-10),
      refreshToken: 'bad-refresh-token',
    });

    const refreshFn = vi.fn(async (): Promise<AuthTokens> => {
      throw new Error('Invalid refresh token');
    });

    wireSessionToHttpClient(client, sessionManager, refreshFn);

    await expect(client.get('/protected-resource')).rejects.toThrow();

    // Must not loop indefinitely
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(refreshFn).toHaveBeenCalledTimes(1);
  });

  it('createSessionMiddleware attaches fresh token and ignores auth endpoints', async () => {
    const freshToken = makeJwt(3600);
    const sessionManager = new SessionManager({
      accessToken: freshToken,
      refreshToken: 'token-r',
    });

    const middleware = createSessionMiddleware(sessionManager, async () => ({
      accessToken: freshToken,
      refreshToken: 'token-r',
      tokenType: 'Bearer',
      expiresIn: 3600,
    }));

    // Calling an auth endpoint directly should not modify headers
    const req: PreparedRequest = {
      url: 'https://api.astroid.test/auth/refresh',
      method: 'POST',
      headers: {},
      options: { method: 'POST', path: '/auth/refresh' },
      body: undefined,
      timeoutMs: 1000,
      retryable: false,
      signal: undefined,
    };

    const res = await middleware.onRequest?.(req);
    expect(res?.url).toBe('https://api.astroid.test/auth/refresh');
  });
});

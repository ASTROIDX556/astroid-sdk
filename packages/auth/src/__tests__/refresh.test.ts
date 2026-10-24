import { describe, expect, it, vi } from 'vitest';
import { HttpClient } from '@astroid/core';
import type { AuthTokens } from '@astroid/types';
import { createRefreshManager, wireRefreshManagerToHttpClient } from '../refresh.js';
import { SessionManager } from '../session.js';

function createTestJwt(offsetSeconds: number): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({ sub: 'refresh_test', exp: Math.floor(Date.now() / 1000) + offsetSeconds }),
  ).toString('base64url');
  return `${header}.${payload}.mock_signature`;
}

function unauthorizedResponse(): Response {
  return new Response(
    JSON.stringify({ error: { code: 'AUTHENTICATION_ERROR', message: 'Token expired' } }),
    { status: 401, headers: { 'content-type': 'application/json' } },
  );
}

function okResponse(): Response {
  return new Response(JSON.stringify({ success: true, data: { id: 'recovered' } }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('RefreshManager', () => {
  it('refreshes a 401 session, updates tokens, and retries the original request', async () => {
    const freshToken = createTestJwt(3600);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(unauthorizedResponse())
      .mockResolvedValueOnce(okResponse());
    const client = new HttpClient({
      apiKey: 'sk_test_refresh',
      baseUrl: 'https://api.astroid.test',
      retry: false,
      fetch: fetchMock as unknown as typeof fetch,
    });
    const session = new SessionManager({
      accessToken: createTestJwt(3600),
      refreshToken: 'refresh_token_valid',
    });
    const refreshFn = vi.fn(
      async (): Promise<AuthTokens> => ({
        accessToken: freshToken,
        refreshToken: 'refresh_token_rotated',
        tokenType: 'Bearer',
        expiresIn: 3600,
      }),
    );
    const refreshManager = createRefreshManager({ sessionManager: session, refreshFn });
    wireRefreshManagerToHttpClient(client, refreshManager);

    const response = await client.get<{ id: string }>('/wallets');

    expect(response.data).toEqual({ id: 'recovered' });
    expect(refreshFn).toHaveBeenCalledOnce();
    expect(refreshFn).toHaveBeenCalledWith('refresh_token_valid');
    expect(session.getAccessToken()).toBe(freshToken);
    expect(session.getRefreshToken()).toBe('refresh_token_rotated');
    expect(client.config.auth.accessToken).toBe(freshToken);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('shares one refresh request between concurrent callers', async () => {
    const session = new SessionManager({
      accessToken: createTestJwt(3600),
      refreshToken: 'refresh_token_valid',
    });
    const refreshFn = vi.fn(async (): Promise<AuthTokens> => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return {
        accessToken: createTestJwt(7200),
        refreshToken: 'refresh_token_rotated',
        tokenType: 'Bearer',
        expiresIn: 3600,
      };
    });
    const refreshManager = createRefreshManager({ sessionManager: session, refreshFn });

    const [first, second] = await Promise.all([refreshManager.refresh(), refreshManager.refresh()]);

    expect(refreshFn).toHaveBeenCalledOnce();
    expect(first).toEqual(second);
    expect(refreshManager.isRefreshing()).toBe(false);
  });

  it('does not refresh or retry a request more than once', async () => {
    const fetchMock = vi.fn().mockResolvedValue(unauthorizedResponse());
    const client = new HttpClient({
      apiKey: 'sk_test_refresh',
      baseUrl: 'https://api.astroid.test',
      retry: false,
      fetch: fetchMock as unknown as typeof fetch,
    });
    const session = new SessionManager({
      accessToken: createTestJwt(3600),
      refreshToken: 'refresh_token_valid',
    });
    const refreshFn = vi.fn(
      async (): Promise<AuthTokens> => ({
        accessToken: createTestJwt(7200),
        refreshToken: 'refresh_token_rotated',
        tokenType: 'Bearer',
        expiresIn: 3600,
      }),
    );
    wireRefreshManagerToHttpClient(
      client,
      createRefreshManager({ sessionManager: session, refreshFn }),
    );

    await expect(client.get('/wallets')).rejects.toThrow();

    expect(refreshFn).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

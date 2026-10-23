/**
 * Unit tests for the token-refresh interceptor and session management helpers
 * in `@astroid/auth` (issue #404).
 *
 * The suite drives the real `HttpClient` against a mocked `fetch`, so the
 * behaviour under test is the one a consumer actually gets:
 *
 *   request → 401 Unauthorized → refresh → replay the original request → 200
 *
 * Covered:
 * - a 401 triggers exactly one refresh and the original request is replayed
 *   with the **new** access token;
 * - concurrent 401s share a single refresh (the promise-queue / mutex);
 * - a session without a refresh token does not attempt a refresh and the
 *   original 401 surfaces unchanged;
 * - a failed refresh clears the session and notifies both `onAuthFailure` and
 *   `onSessionExpired`;
 * - the proactive path refreshes an already-expired access token *before* the
 *   request leaves, and never intercepts the auth endpoints themselves.
 *
 * No live API is contacted.
 */

import { describe, expect, it, vi } from 'vitest';
import { HttpClient } from '@astroid/core';
import { AuthenticationError } from '@astroid/errors';
import type { AuthTokens } from '@astroid/types';

import {
  SessionManager,
  createSessionMiddleware,
  wireSessionToHttpClient,
  type AuthFailureEvent,
} from '../session.js';

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

/** Build a JWT-shaped token whose `exp` is `offsetSeconds` from now. */
function createTestJwt(offsetSeconds: number): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({ sub: 'user_123', exp: Math.floor(Date.now() / 1000) + offsetSeconds }),
  ).toString('base64url');
  return `${header}.${payload}.mock_signature`;
}

/** A `200 OK` response carrying the SDK success envelope. */
function okResponse(data: unknown): Response {
  return new Response(JSON.stringify({ success: true, data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

/** A `401 Unauthorized` response carrying the SDK error envelope. */
function unauthorizedResponse(): Response {
  return new Response(
    JSON.stringify({
      error: { code: 'AUTHENTICATION_ERROR', message: 'Access token expired' },
    }),
    { status: 401, headers: { 'content-type': 'application/json' } },
  );
}

/**
 * A mock fetch that answers the **first** request to each path with a 401 and
 * every later request to that path with a 200.
 *
 * Keying on the path (rather than on a global call order) keeps the suite
 * deterministic when requests overlap, which is exactly the case the
 * single-flight refresh test exercises.
 */
function unauthorizedOnceThenOk(
  resolveBody: (path: string) => unknown = () => ({ id: 'ok' }),
): ReturnType<typeof vi.fn> {
  const attempts = new Map<string, number>();
  return vi.fn().mockImplementation(async (input: unknown) => {
    const path = new URL(String(input)).pathname;
    const count = (attempts.get(path) ?? 0) + 1;
    attempts.set(path, count);
    if (count === 1) return unauthorizedResponse();
    return okResponse(resolveBody(path));
  });
}

/** A mock fetch that always answers with a 200. */
function alwaysOk(resolveBody: (path: string) => unknown = () => ({ id: 'ok' })): ReturnType<
  typeof vi.fn
> {
  return vi.fn().mockImplementation(async (input: unknown) =>
    okResponse(resolveBody(new URL(String(input)).pathname)),
  );
}

/** An `HttpClient` wired to the mock fetch, with retries disabled. */
function createClient(fetchMock: ReturnType<typeof vi.fn>): HttpClient {
  return new HttpClient({
    apiKey: 'sk_test_session',
    baseUrl: 'https://api.astroid.test',
    retry: false,
    fetch: fetchMock as unknown as typeof fetch,
  });
}

/** A refresh function resolving with a fresh, unexpired access token. */
function createRefreshFn(accessToken: string): ReturnType<typeof vi.fn> {
  return vi.fn(
    async (): Promise<AuthTokens> => ({
      accessToken,
      refreshToken: 'refresh_token_rotated',
      tokenType: 'Bearer',
      expiresIn: 3600,
    }),
  );
}

/* -------------------------------------------------------------------------- */
/* Reactive 401 handling                                                       */
/* -------------------------------------------------------------------------- */

describe('session refresh interceptor — reactive 401 handling (issue #404)', () => {
  it('refreshes the session and replays the original request after a 401', async () => {
    const freshToken = createTestJwt(3600);
    const fetchMock = unauthorizedOnceThenOk((path) =>
      path.includes('/wallets') ? { id: 'wal_refreshed' } : { id: 'ok' },
    );
    const client = createClient(fetchMock);

    const session = new SessionManager({
      accessToken: createTestJwt(3600),
      refreshToken: 'refresh_token_valid',
    });
    const refreshFn = createRefreshFn(freshToken);
    wireSessionToHttpClient(client, session, refreshFn);

    const res = await client.get<{ id: string }>('/wallets');

    expect(res.data.id).toBe('wal_refreshed');
    expect(refreshFn).toHaveBeenCalledTimes(1);
    expect(refreshFn).toHaveBeenCalledWith('refresh_token_valid');
    expect(session.getAccessToken()).toBe(freshToken);
    // The client adopted the refreshed token, so the replay is authenticated.
    expect(client.config.auth.accessToken).toBe(freshToken);
    // The original request plus exactly one replay.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('replays the request with the refreshed access token, not the stale one', async () => {
    const staleToken = createTestJwt(3600);
    const freshToken = createTestJwt(7200);
    const fetchMock = unauthorizedOnceThenOk(() => ({ id: 'wal_ok' }));
    const client = createClient(fetchMock);

    const session = new SessionManager({
      accessToken: staleToken,
      refreshToken: 'refresh_token_valid',
    });
    wireSessionToHttpClient(client, session, createRefreshFn(freshToken));

    await client.get('/wallets');

    const replayHeaders = fetchMock.mock.calls[1]?.[1]?.headers as Record<string, string>;
    expect(replayHeaders['authorization']).toBe(`Bearer ${freshToken}`);
  });

  it('does not attempt a refresh when the session has no refresh token', async () => {
    const fetchMock = unauthorizedOnceThenOk();
    const client = createClient(fetchMock);

    const session = new SessionManager({ accessToken: createTestJwt(3600) });
    const refreshFn = createRefreshFn(createTestJwt(3600));
    wireSessionToHttpClient(client, session, refreshFn);

    await expect(client.get('/wallets')).rejects.toThrow(AuthenticationError);

    expect(refreshFn).not.toHaveBeenCalled();
    // Only the original request went out — no refresh, no replay.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('clears the session and surfaces the 401 when the refresh itself fails', async () => {
    const fetchMock = unauthorizedOnceThenOk();
    const client = createClient(fetchMock);

    const session = new SessionManager({
      accessToken: createTestJwt(3600),
      refreshToken: 'refresh_token_valid',
    });
    const refreshFn = vi.fn().mockRejectedValue(
      new AuthenticationError('Invalid refresh token', { code: 'TOKEN_EXPIRED', status: 401 }),
    );
    wireSessionToHttpClient(client, session, refreshFn);

    await expect(client.get('/wallets')).rejects.toThrow(AuthenticationError);

    expect(refreshFn).toHaveBeenCalledTimes(1);
    // The failed refresh invalidated the session.
    expect(session.getAccessToken()).toBeUndefined();
    expect(session.getRefreshToken()).toBeUndefined();
    // The original request was not replayed with a broken session.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

/* -------------------------------------------------------------------------- */
/* Single-flight refresh                                                       */
/* -------------------------------------------------------------------------- */

describe('session refresh interceptor — concurrent refreshes (issue #404)', () => {
  it('performs exactly one refresh for concurrent 401s', async () => {
    const freshToken = createTestJwt(3600);
    const fetchMock = unauthorizedOnceThenOk((path) =>
      path.includes('/wallets') ? { id: 'wal_a' } : { id: 'wal_b' },
    );
    const client = createClient(fetchMock);

    const session = new SessionManager({
      accessToken: createTestJwt(3600),
      refreshToken: 'refresh_token_valid',
    });
    const refreshFn = vi.fn(async (): Promise<AuthTokens> => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return {
        accessToken: freshToken,
        refreshToken: 'refresh_token_rotated',
        tokenType: 'Bearer',
        expiresIn: 3600,
      };
    });
    wireSessionToHttpClient(client, session, refreshFn);

    const [first, second] = await Promise.all([client.get('/wallets'), client.get('/agents')]);

    expect(first.data).toEqual({ id: 'wal_a' });
    expect(second.data).toEqual({ id: 'wal_b' });
    // The mutex/promise queue collapsed both 401s into a single refresh.
    expect(refreshFn).toHaveBeenCalledTimes(1);
  });
});

/* -------------------------------------------------------------------------- */
/* Proactive refresh                                                           */
/* -------------------------------------------------------------------------- */

describe('session refresh interceptor — proactive refresh (issue #404)', () => {
  it('refreshes an expired access token before the request is sent', async () => {
    const freshToken = createTestJwt(3600);
    const fetchMock = alwaysOk(() => ({ id: 'wal_ok' }));
    const client = createClient(fetchMock);

    const session = new SessionManager({
      accessToken: createTestJwt(-60), // already expired
      refreshToken: 'refresh_token_valid',
    });
    const refreshFn = createRefreshFn(freshToken);
    client.use(createSessionMiddleware(session, refreshFn));

    await client.get('/wallets');

    expect(refreshFn).toHaveBeenCalledTimes(1);
    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers['authorization']).toBe(`Bearer ${freshToken}`);
  });

  it('never intercepts the auth endpoints themselves', async () => {
    const session = new SessionManager({
      accessToken: createTestJwt(-60),
      refreshToken: 'refresh_token_valid',
    });
    const refreshFn = createRefreshFn(createTestJwt(3600));
    const middleware = createSessionMiddleware(session, refreshFn);

    await middleware.onRequest!({
      method: 'POST',
      url: 'https://api.astroid.test/v1/auth/refresh',
      headers: {},
      body: undefined,
      timeoutMs: 30_000,
      retryable: false,
      signal: undefined,
      options: { method: 'POST', path: '/auth/refresh' },
    });

    expect(refreshFn).not.toHaveBeenCalled();
  });
});

/* -------------------------------------------------------------------------- */
/* Failure notifications                                                       */
/* -------------------------------------------------------------------------- */

describe('session refresh interceptor — failure notifications (issue #404)', () => {
  it('notifies onAuthFailure and onSessionExpired when the refresh fails', async () => {
    const events: AuthFailureEvent[] = [];
    const onSessionExpired = vi.fn();
    const session = new SessionManager({
      accessToken: createTestJwt(-60),
      refreshToken: createTestJwt(3600),
      onAuthFailure: (event) => {
        events.push(event);
      },
      onSessionExpired,
    });

    const failure = new AuthenticationError('Invalid refresh token', {
      code: 'TOKEN_EXPIRED',
      status: 401,
    });
    const refreshFn = vi.fn().mockRejectedValue(failure);

    await expect(session.refreshSession(refreshFn)).rejects.toThrow(AuthenticationError);

    expect(events).toHaveLength(1);
    expect(events[0]!.reason).toBe('refresh_failed');
    expect(onSessionExpired).toHaveBeenCalledTimes(1);
  });

  it('notifies onAuthFailure and onSessionExpired on a 401 escalation', async () => {
    const events: AuthFailureEvent[] = [];
    const onSessionExpired = vi.fn();
    const session = new SessionManager({
      accessToken: createTestJwt(3600),
      refreshToken: createTestJwt(3600),
      onAuthFailure: (event) => {
        events.push(event);
      },
      onSessionExpired,
    });
    const middleware = createSessionMiddleware(session, vi.fn());

    await middleware.onError!(
      new AuthenticationError('Session invalidated', { code: 'UNAUTHORIZED', status: 401 }),
      {
        method: 'GET',
        url: 'https://api.astroid.test/v1/wallets',
        headers: {},
        body: undefined,
        timeoutMs: 30_000,
        retryable: true,
        signal: undefined,
        options: { method: 'GET', path: '/wallets' },
      },
    );

    expect(events).toHaveLength(1);
    expect(events[0]!.reason).toBe('unauthorized_401');
    expect(onSessionExpired).toHaveBeenCalledTimes(1);
    expect(session.getAccessToken()).toBeUndefined();
  });

  it('swallows listener errors so a failing callback cannot break the auth flow', async () => {
    const session = new SessionManager({
      accessToken: createTestJwt(-60),
      refreshToken: createTestJwt(3600),
      onSessionExpired: () => {
        throw new Error('listener exploded');
      },
      onAuthFailure: () => {
        throw new Error('listener exploded');
      },
    });
    const refreshFn = vi.fn().mockRejectedValue(new Error('refresh boom'));

    await expect(session.refreshSession(refreshFn)).rejects.toThrow(AuthenticationError);
    expect(session.getAccessToken()).toBeUndefined();
  });

  it('does not notify listeners for non-401 errors', async () => {
    const onSessionExpired = vi.fn();
    const events: AuthFailureEvent[] = [];
    const session = new SessionManager({
      accessToken: createTestJwt(3600),
      refreshToken: createTestJwt(3600),
      onAuthFailure: (event) => {
        events.push(event);
      },
      onSessionExpired,
    });
    const middleware = createSessionMiddleware(session, vi.fn());

    await middleware.onError!(
      new AuthenticationError('Forbidden', { code: 'FORBIDDEN', status: 403 }),
      {
        method: 'GET',
        url: 'https://api.astroid.test/v1/wallets',
        headers: {},
        body: undefined,
        timeoutMs: 30_000,
        retryable: true,
        signal: undefined,
        options: { method: 'GET', path: '/wallets' },
      },
    );

    expect(events).toHaveLength(0);
    expect(onSessionExpired).not.toHaveBeenCalled();
    expect(session.getAccessToken()).toBeDefined();
  });
});

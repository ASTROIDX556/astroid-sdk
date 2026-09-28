import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthenticationError } from '@astroid/errors';
import { HttpClient } from '@astroid/core';
import {
  SessionManager,
  createSessionMiddleware,
  parseJwt,
  getTokenExpiration,
  isTokenExpired,
  type AuthFailureEvent,
  type TokenStorage,
} from '../src/session.js';
import { AuthResource } from '../src/index.js';

function createTestJwt(expInSeconds: number): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub: 'user_123', exp: expInSeconds })).toString('base64url');
  const signature = 'mock_signature';
  return `${header}.${payload}.${signature}`;
}

describe('Session Management & Token Refresh', () => {
  const nowInSeconds = Math.floor(Date.now() / 1000);
  const validAccessToken = createTestJwt(nowInSeconds + 3600);
  const expiredAccessToken = createTestJwt(nowInSeconds - 100);
  const expiringAccessToken = createTestJwt(nowInSeconds + 15);
  const validRefreshToken = createTestJwt(nowInSeconds + 86400);
  const expiredRefreshToken = createTestJwt(nowInSeconds - 3600);

  describe('JWT Utilities', () => {
    it('should correctly parse JWT payloads', () => {
      const payload = parseJwt(validAccessToken);
      expect(payload).not.toBeNull();
      expect(payload?.sub).toBe('user_123');
      expect(payload?.exp).toBe(nowInSeconds + 3600);
    });

    it('should return null for malformed JWT strings', () => {
      expect(parseJwt('invalid.jwt')).toBeNull();
      expect(parseJwt('')).toBeNull();
      expect(parseJwt('a.b.c.d')).toBeNull();
    });

    it('should extract expiration timestamp correctly', () => {
      expect(getTokenExpiration(validAccessToken)).toBe(nowInSeconds + 3600);
      expect(getTokenExpiration('invalid')).toBeNull();
    });

    it('should evaluate token expiration correctly considering buffer', () => {
      expect(isTokenExpired(validAccessToken, 30)).toBe(false);
      expect(isTokenExpired(expiredAccessToken, 30)).toBe(true);
      expect(isTokenExpired(expiringAccessToken, 30)).toBe(true); // expires in 15s < 30s buffer
      expect(isTokenExpired(undefined)).toBe(true);
    });
  });

  describe('SessionManager', () => {
    it('should hold and update token state', async () => {
      const session = new SessionManager({
        accessToken: validAccessToken,
        refreshToken: validRefreshToken,
      });

      expect(session.getAccessToken()).toBe(validAccessToken);
      expect(session.getRefreshToken()).toBe(validRefreshToken);
      expect(session.isAccessTokenExpired()).toBe(false);

      await session.clearTokens();
      expect(session.getAccessToken()).toBeUndefined();
      expect(session.getRefreshToken()).toBeUndefined();
      expect(session.isAccessTokenExpired()).toBe(true);
    });

    it('should persist tokens to storage if provided', async () => {
      const storageMap = new Map<string, string>();
      const storage: TokenStorage = {
        getItem: (key) => storageMap.get(key) ?? null,
        setItem: (key, val) => {
          storageMap.set(key, val);
        },
        removeItem: (key) => {
          storageMap.delete(key);
        },
      };

      const session = new SessionManager({ storage });
      await session.setTokens({
        accessToken: validAccessToken,
        refreshToken: validRefreshToken,
      });

      expect(storageMap.get('astroid_auth_access_token')).toBe(validAccessToken);
      expect(storageMap.get('astroid_auth_refresh_token')).toBe(validRefreshToken);

      await session.clearTokens();
      expect(storageMap.has('astroid_auth_access_token')).toBe(false);
    });

    it('should queue concurrent token refresh calls so only one refresh executes', async () => {
      const session = new SessionManager({
        accessToken: expiredAccessToken,
        refreshToken: validRefreshToken,
      });

      const freshAccessToken = createTestJwt(nowInSeconds + 7200);
      const refreshFn = vi.fn().mockImplementation(async () => {
        await new Promise((res) => setTimeout(res, 50));
        return {
          accessToken: freshAccessToken,
          refreshToken: validRefreshToken,
          tokenType: 'Bearer',
          expiresIn: 7200,
        };
      });

      // Fire 5 concurrent refresh requests
      const results = await Promise.all([
        session.refreshSession(refreshFn),
        session.refreshSession(refreshFn),
        session.refreshSession(refreshFn),
        session.refreshSession(refreshFn),
        session.refreshSession(refreshFn),
      ]);

      expect(refreshFn).toHaveBeenCalledTimes(1);
      expect(refreshFn).toHaveBeenCalledWith(validRefreshToken);
      results.forEach((res) => {
        expect(res.accessToken).toBe(freshAccessToken);
      });
      expect(session.getAccessToken()).toBe(freshAccessToken);
    });

    it('should clear tokens securely when refresh fails completely', async () => {
      const session = new SessionManager({
        accessToken: expiredAccessToken,
        refreshToken: validRefreshToken,
      });

      const refreshFn = vi.fn().mockRejectedValue(
        new AuthenticationError('Invalid refresh token', {
          code: 'TOKEN_EXPIRED',
          status: 401,
        })
      );

      await expect(session.refreshSession(refreshFn)).rejects.toThrow(AuthenticationError);
      expect(session.getAccessToken()).toBeUndefined();
      expect(session.getRefreshToken()).toBeUndefined();
    });

    it('emits a refresh_failed auth-failure event after clearing credentials (issue #237)', async () => {
      const failure = new AuthenticationError('Invalid refresh token', {
        code: 'TOKEN_EXPIRED',
        status: 401,
      });
      const events: AuthFailureEvent[] = [];
      const storageMap = new Map<string, string>();
      const session = new SessionManager({
        accessToken: expiredAccessToken,
        refreshToken: validRefreshToken,
        storage: {
          getItem: (key) => storageMap.get(key) ?? null,
          setItem: (key, value) => {
            storageMap.set(key, value);
          },
          removeItem: (key) => {
            storageMap.delete(key);
          },
        },
        onAuthFailure: (event) => {
          events.push(event);
        },
      });
      const refreshFn = vi.fn().mockRejectedValue(failure);

      await expect(session.refreshSession(refreshFn)).rejects.toThrow(AuthenticationError);

      expect(session.getAccessToken()).toBeUndefined();
      expect(session.getRefreshToken()).toBeUndefined();
      expect(events).toHaveLength(1);
      expect(events[0]!.reason).toBe('refresh_failed');
      expect(events[0]!.error).toBe(failure);
      expect(new Date(events[0]!.timestamp).getTime()).not.toBeNaN();
      // Cleanup ran before the event was emitted.
      expect(storageMap.has('astroid_auth_access_token')).toBe(false);
      expect(storageMap.has('astroid_auth_refresh_token')).toBe(false);
    });

    it('emits a refresh_token_expired event without invoking the refresh call', async () => {
      const events: AuthFailureEvent[] = [];
      const session = new SessionManager({
        accessToken: expiredAccessToken,
        refreshToken: expiredRefreshToken,
        onAuthFailure: (event) => {
          events.push(event);
        },
      });
      const refreshFn = vi.fn();

      await expect(session.refreshSession(refreshFn)).rejects.toThrow(AuthenticationError);
      expect(refreshFn).not.toHaveBeenCalled();
      expect(events).toHaveLength(1);
      expect(events[0]!.reason).toBe('refresh_token_expired');
      expect(session.getAccessToken()).toBeUndefined();
    });

    it('swallows errors thrown by the onAuthFailure callback so cleanup is never broken', async () => {
      const session = new SessionManager({
        accessToken: expiredAccessToken,
        refreshToken: validRefreshToken,
        onAuthFailure: () => {
          throw new Error('listener exploded');
        },
      });
      const refreshFn = vi.fn().mockRejectedValue(new Error('refresh boom'));

      await expect(session.refreshSession(refreshFn)).rejects.toThrow(AuthenticationError);
      expect(session.getAccessToken()).toBeUndefined();
      expect(session.getRefreshToken()).toBeUndefined();
    });

    it('should throw AuthenticationError immediately when refresh token is expired', async () => {
      const session = new SessionManager({
        accessToken: expiredAccessToken,
        refreshToken: expiredRefreshToken,
      });

      const refreshFn = vi.fn();

      await expect(session.refreshSession(refreshFn)).rejects.toThrow(AuthenticationError);
      expect(refreshFn).not.toHaveBeenCalled();
      expect(session.getAccessToken()).toBeUndefined();
      expect(session.getRefreshToken()).toBeUndefined();
    });
  });

  describe('Session Middleware Integration', () => {
    it('should automatically refresh token before making request when access token is expired', async () => {
      const session = new SessionManager({
        accessToken: expiredAccessToken,
        refreshToken: validRefreshToken,
      });

      const freshAccessToken = createTestJwt(nowInSeconds + 3600);
      const refreshFn = vi.fn().mockResolvedValue({
        accessToken: freshAccessToken,
        refreshToken: validRefreshToken,
        tokenType: 'Bearer',
        expiresIn: 3600,
      });

      const middleware = createSessionMiddleware(session, refreshFn);

      const req = await middleware.onRequest!({
        method: 'GET',
        url: 'https://api.astroid.finance/v1/wallets',
        headers: { authorization: `Bearer ${expiredAccessToken}` },
        body: undefined,
        timeoutMs: 30000,
        retryable: true,
        signal: undefined,
        options: { method: 'GET', path: '/wallets' },
      });

      expect(refreshFn).toHaveBeenCalledTimes(1);
      expect(req.headers['authorization']).toBe(`Bearer ${freshAccessToken}`);
    });

    it('should not intercept auth refresh endpoint to avoid cyclic calls', async () => {
      const session = new SessionManager({
        accessToken: expiredAccessToken,
        refreshToken: validRefreshToken,
      });

      const refreshFn = vi.fn();
      const middleware = createSessionMiddleware(session, refreshFn);

      const req = await middleware.onRequest!({
        method: 'POST',
        url: 'https://api.astroid.finance/v1/auth/refresh',
        headers: {},
        body: undefined,
        timeoutMs: 30000,
        retryable: false,
        signal: undefined,
        options: { method: 'POST', path: '/auth/refresh' },
      });

      expect(refreshFn).not.toHaveBeenCalled();
      expect(req.url).toContain('/auth/refresh');
    });

    it('should clear credentials if request error is 401 AuthenticationError', async () => {
      const session = new SessionManager({
        accessToken: validAccessToken,
        refreshToken: validRefreshToken,
      });

      const middleware = createSessionMiddleware(session, vi.fn());

      await middleware.onError!(
        new AuthenticationError('Session invalidated', {
          code: 'UNAUTHORIZED',
          status: 401,
        }),
        {
          method: 'GET',
          url: 'https://api.astroid.finance/v1/wallets',
          headers: {},
          body: undefined,
          timeoutMs: 30000,
          retryable: true,
          signal: undefined,
          options: { method: 'GET', path: '/wallets' },
        }
      );

      expect(session.getAccessToken()).toBeUndefined();
      expect(session.getRefreshToken()).toBeUndefined();
    });

    it('emits an unauthorized_401 failure event alongside the credential cleanup (issue #237)', async () => {
      const events: AuthFailureEvent[] = [];
      const session = new SessionManager({
        accessToken: validAccessToken,
        refreshToken: validRefreshToken,
        onAuthFailure: (event) => {
          events.push(event);
        },
      });
      const middleware = createSessionMiddleware(session, vi.fn());
      const error = new AuthenticationError('Session invalidated', {
        code: 'UNAUTHORIZED',
        status: 401,
      });

      await middleware.onError!(error, {
        method: 'GET',
        url: 'https://api.astroid.finance/v1/wallets',
        headers: {},
        body: undefined,
        timeoutMs: 30000,
        retryable: true,
        signal: undefined,
        options: { method: 'GET', path: '/wallets' },
      });

      expect(session.getAccessToken()).toBeUndefined();
      expect(session.getRefreshToken()).toBeUndefined();
      expect(events).toHaveLength(1);
      expect(events[0]!.reason).toBe('unauthorized_401');
      expect(events[0]!.error).toBe(error);
    });

    it('leaves non-401 errors untouched without emitting a failure event', async () => {
      const events: AuthFailureEvent[] = [];
      const session = new SessionManager({
        accessToken: validAccessToken,
        refreshToken: validRefreshToken,
        onAuthFailure: (event) => {
          events.push(event);
        },
      });
      const middleware = createSessionMiddleware(session, vi.fn());

      await middleware.onError!(
        new AuthenticationError('Forbidden', { code: 'FORBIDDEN', status: 403 }),
        {
          method: 'GET',
          url: 'https://api.astroid.finance/v1/wallets',
          headers: {},
          body: undefined,
          timeoutMs: 30000,
          retryable: true,
          signal: undefined,
          options: { method: 'GET', path: '/wallets' },
        }
      );

      expect(events).toHaveLength(0);
      expect(session.getAccessToken()).toBe(validAccessToken);
    });
  });
});

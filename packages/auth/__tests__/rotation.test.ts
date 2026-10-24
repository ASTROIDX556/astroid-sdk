import { describe, expect, it, vi } from 'vitest';
import {
  TokenRotator,
  isTokenExpiring,
  rotateTokens,
  shouldRotateToken,
} from '../src/rotation.js';
import { AuthenticationError } from '@astroid/errors';
import type { AuthTokens } from '@astroid/types';

function makeToken(expInSeconds: number): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ exp: expInSeconds })).toString('base64url');
  return `${header}.${payload}.signature`;
}

describe('Token rotation utilities (#449)', () => {
  describe('shouldRotateToken and isTokenExpiring', () => {
    it('returns true for expired or undefined tokens', () => {
      expect(shouldRotateToken(undefined)).toBe(true);
      expect(isTokenExpiring(undefined)).toBe(true);

      const pastExp = Math.floor(Date.now() / 1000) - 10;
      const expiredToken = makeToken(pastExp);
      expect(shouldRotateToken(expiredToken)).toBe(true);
      expect(isTokenExpiring(expiredToken)).toBe(true);
    });

    it('returns true when token expires within the buffer window', () => {
      const nearExp = Math.floor(Date.now() / 1000) + 15; // 15s remaining, buffer is 30s
      const nearToken = makeToken(nearExp);
      expect(shouldRotateToken(nearToken, 30)).toBe(true);
      expect(isTokenExpiring(nearToken, 30)).toBe(true);
    });

    it('returns false when token is well unexpired outside buffer window', () => {
      const farExp = Math.floor(Date.now() / 1000) + 300; // 5 min remaining
      const validToken = makeToken(farExp);
      expect(shouldRotateToken(validToken, 30)).toBe(false);
      expect(isTokenExpiring(validToken, 30)).toBe(false);
    });
  });

  describe('TokenRotator', () => {
    it('executes successful refresh and triggers onTokenUpdate', async () => {
      const futureExp = Math.floor(Date.now() / 1000) + 3600;
      const validRefreshToken = makeToken(futureExp);
      const newTokens: AuthTokens = {
        accessToken: makeToken(futureExp),
        refreshToken: makeToken(futureExp),
        expiresIn: 3600,
        tokenType: 'Bearer',
      };

      const refreshFn = vi.fn().mockResolvedValue(newTokens);
      const onTokenUpdate = vi.fn();

      const rotator = new TokenRotator({
        refreshFn,
        onTokenUpdate,
      });

      const result = await rotator.rotate(validRefreshToken);

      expect(result).toEqual(newTokens);
      expect(refreshFn).toHaveBeenCalledWith(validRefreshToken);
      expect(onTokenUpdate).toHaveBeenCalledWith(newTokens);
    });

    it('deduplicates concurrent refresh requests', async () => {
      const futureExp = Math.floor(Date.now() / 1000) + 3600;
      const validRefreshToken = makeToken(futureExp);
      const newTokens: AuthTokens = {
        accessToken: makeToken(futureExp),
        refreshToken: makeToken(futureExp),
        expiresIn: 3600,
        tokenType: 'Bearer',
      };

      let resolveRefresh: (tokens: AuthTokens) => void;
      const refreshPromise = new Promise<AuthTokens>((resolve) => {
        resolveRefresh = resolve;
      });
      const refreshFn = vi.fn().mockImplementation(() => refreshPromise);

      const rotator = new TokenRotator({ refreshFn });

      const req1 = rotator.rotate(validRefreshToken);
      const req2 = rotator.rotate(validRefreshToken);

      expect(rotator.isRotating()).toBe(true);

      resolveRefresh!(newTokens);

      const [res1, res2] = await Promise.all([req1, req2]);

      expect(res1).toEqual(newTokens);
      expect(res2).toEqual(newTokens);
      expect(refreshFn).toHaveBeenCalledTimes(1);
      expect(rotator.isRotating()).toBe(false);
    });

    it('propagates refresh failures and invokes onRotationFailure', async () => {
      const futureExp = Math.floor(Date.now() / 1000) + 3600;
      const validRefreshToken = makeToken(futureExp);
      const failureError = new Error('Token revoked');

      const refreshFn = vi.fn().mockRejectedValue(failureError);
      const onRotationFailure = vi.fn();

      const rotator = new TokenRotator({
        refreshFn,
        onRotationFailure,
      });

      await expect(rotator.rotate(validRefreshToken)).rejects.toThrow(AuthenticationError);
      expect(onRotationFailure).toHaveBeenCalledWith(failureError);
    });

    it('rejects immediately if refresh token is missing or expired', async () => {
      const onRotationFailure = vi.fn();
      const rotator = new TokenRotator({
        refreshFn: vi.fn(),
        onRotationFailure,
      });

      await expect(rotator.rotate('')).rejects.toThrow(AuthenticationError);
      expect(onRotationFailure).toHaveBeenCalled();
    });
  });

  describe('rotateTokens helper', () => {
    it('executes single-shot rotation', async () => {
      const futureExp = Math.floor(Date.now() / 1000) + 3600;
      const validRefreshToken = makeToken(futureExp);
      const newTokens: AuthTokens = {
        accessToken: makeToken(futureExp),
        refreshToken: makeToken(futureExp),
        expiresIn: 3600,
        tokenType: 'Bearer',
      };

      const refreshFn = vi.fn().mockResolvedValue(newTokens);
      const onTokenUpdate = vi.fn();

      const result = await rotateTokens({
        refreshToken: validRefreshToken,
        refreshFn,
        onTokenUpdate,
      });

      expect(result).toEqual(newTokens);
      expect(onTokenUpdate).toHaveBeenCalledWith(newTokens);
    });
  });
});

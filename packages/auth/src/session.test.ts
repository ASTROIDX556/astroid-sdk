import { describe, it, expect, vi } from 'vitest';
import { SessionManager } from './session.js';
import { AuthenticationError } from '@astroid/errors';

function makeJwt(expSec: number): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = btoa(JSON.stringify({ exp: expSec, sub: 'user-1' }));
  return `${header}.${payload}.signature`;
}

describe('SessionManager automatic refresh & expiration', () => {
  it('detects token expiration correctly with buffer', () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const token = makeJwt(nowSec + 10); // expires in 10s
    const manager = new SessionManager({ accessToken: token, bufferSeconds: 30 });

    expect(manager.isAccessTokenExpired()).toBe(true);
    expect(manager.isAccessTokenExpired(5)).toBe(false);
  });

  it('queues concurrent refresh requests and executes refreshFn only once', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const expiredToken = makeJwt(nowSec - 10);
    const freshToken = makeJwt(nowSec + 3600);

    const manager = new SessionManager({
      accessToken: expiredToken,
      refreshToken: 'refresh-token-123',
    });

    let callCount = 0;
    const refreshFn = vi.fn(async () => {
      callCount++;
      await new Promise((r) => setTimeout(r, 50));
      return { accessToken: freshToken, refreshToken: 'refresh-token-456', expiresIn: 3600, tokenType: 'Bearer' };
    });

    const p1 = manager.refreshSession(refreshFn);
    const p2 = manager.refreshSession(refreshFn);
    const p3 = manager.refreshSession(refreshFn);

    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);

    expect(callCount).toBe(1);
    expect(r1.accessToken).toBe(freshToken);
    expect(r2.accessToken).toBe(freshToken);
    expect(r3.accessToken).toBe(freshToken);
    expect(manager.getAccessToken()).toBe(freshToken);
  });
});

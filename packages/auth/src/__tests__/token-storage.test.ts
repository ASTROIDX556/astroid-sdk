import { describe, expect, it, vi } from 'vitest';

import { MemoryTokenStorage } from '../index.js';
import { SessionManager } from '../session.js';
import type { TokenStorage, TokenStorageAdapter } from '../token-storage.js';

describe('MemoryTokenStorage', () => {
  it('persists, retrieves, and removes tokens through the adapter methods', async () => {
    const storage = new MemoryTokenStorage();

    await storage.setToken('access', 'a.b.c');
    await storage.setToken('refresh', 'r.e.f');

    await expect(storage.getToken('access')).resolves.toBe('a.b.c');
    await expect(storage.getToken('refresh')).resolves.toBe('r.e.f');

    await storage.removeToken('access');

    await expect(storage.getToken('access')).resolves.toBeNull();
    await expect(storage.getToken('refresh')).resolves.toBe('r.e.f');
  });

  it('returns null for missing keys and treats removal as idempotent', async () => {
    const storage = new MemoryTokenStorage();

    await expect(storage.getToken('missing')).resolves.toBeNull();
    await expect(storage.removeToken('missing')).resolves.toBeUndefined();
    await expect(storage.getToken('missing')).resolves.toBeNull();
  });

  it('implements the Storage-compatible shape used by existing integrations', () => {
    const storage: TokenStorage = new MemoryTokenStorage();

    expect(storage.getItem('session')).toBeNull();
    storage.setItem('session', 'value');
    expect(storage.getItem('session')).toBe('value');
    storage.removeItem('session');
    expect(storage.getItem('session')).toBeNull();
  });

  it('exposes its entry count and can be cleared between test cases', async () => {
    const storage = new MemoryTokenStorage();
    expect(storage.size).toBe(0);

    await storage.setToken('one', '1');
    await storage.setToken('two', '2');
    expect(storage.size).toBe(2);

    storage.clear();
    expect(storage.size).toBe(0);
    await expect(storage.getToken('one')).resolves.toBeNull();
  });
});

describe('SessionManager token storage integration', () => {
  it('persists access and refresh tokens into a MemoryTokenStorage', async () => {
    const storage = new MemoryTokenStorage();
    const session = new SessionManager({ storage });

    await session.setTokens({ accessToken: 'access-token', refreshToken: 'refresh-token' });

    await expect(storage.getToken('astroid_auth_access_token')).resolves.toBe('access-token');
    await expect(storage.getToken('astroid_auth_refresh_token')).resolves.toBe('refresh-token');

    await session.clearTokens();

    await expect(storage.getToken('astroid_auth_access_token')).resolves.toBeNull();
    await expect(storage.getToken('astroid_auth_refresh_token')).resolves.toBeNull();
  });

  it('persists an API key into the memory store', async () => {
    const storage = new MemoryTokenStorage();
    const session = new SessionManager({ storage });

    await session.setApiKey('sk_live_123');

    await expect(storage.getToken('astroid_auth_api_key')).resolves.toBe('sk_live_123');
  });

  it('uses a custom TokenStorageAdapter directly', async () => {
    const adapter: TokenStorageAdapter = {
      getToken: vi.fn(async () => null),
      setToken: vi.fn(async () => undefined),
      removeToken: vi.fn(async () => undefined),
    };
    const session = new SessionManager({ storage: adapter });

    await session.setTokens({ accessToken: 'access-token', refreshToken: 'refresh-token' });

    expect(adapter.setToken).toHaveBeenCalledWith('astroid_auth_access_token', 'access-token');
    expect(adapter.setToken).toHaveBeenCalledWith('astroid_auth_refresh_token', 'refresh-token');

    await session.clearTokens();
    expect(adapter.removeToken).toHaveBeenCalledWith('astroid_auth_access_token');
    expect(adapter.removeToken).toHaveBeenCalledWith('astroid_auth_refresh_token');
  });

  it('adapts a Storage-compatible backend (backwards compatibility)', async () => {
    const entries = new Map<string, string>();
    const storage: TokenStorage = {
      getItem: (key) => entries.get(key) ?? null,
      setItem: (key, value) => {
        entries.set(key, value);
      },
      removeItem: (key) => {
        entries.delete(key);
      },
    };
    const session = new SessionManager({ storage });

    await session.setTokens({ accessToken: 'legacy-token' });

    expect(entries.get('astroid_auth_access_token')).toBe('legacy-token');
  });
});

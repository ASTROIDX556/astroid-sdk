import { describe, expect, expectTypeOf, it, vi } from 'vitest';

import { AuthenticationError } from '@astroid/errors';
import { InMemoryTokenStorage, SessionManager, type TokenStorageAdapter } from '../index.js';

describe('InMemoryTokenStorage', () => {
  it('starts empty', async () => {
    const storage = new InMemoryTokenStorage();

    await expect(storage.getToken()).resolves.toBeNull();
  });

  it('can be seeded with an initial token', async () => {
    const storage = new InMemoryTokenStorage('initial-token');

    await expect(storage.getToken()).resolves.toBe('initial-token');
  });

  it('stores and retrieves a token', async () => {
    const storage = new InMemoryTokenStorage();

    await storage.setToken('header.payload.signature');

    await expect(storage.getToken()).resolves.toBe('header.payload.signature');
  });

  it('replaces a previously stored token', async () => {
    const storage = new InMemoryTokenStorage('old-token');

    await storage.setToken('new-token');

    await expect(storage.getToken()).resolves.toBe('new-token');
  });

  it('clears the stored token', async () => {
    const storage = new InMemoryTokenStorage('token');

    await storage.clearToken();

    await expect(storage.getToken()).resolves.toBeNull();
  });

  it('clearing an empty store is a no-op', async () => {
    const storage = new InMemoryTokenStorage();

    await expect(storage.clearToken()).resolves.toBeUndefined();
    await expect(storage.getToken()).resolves.toBeNull();
  });

  it.each([[''], ['   ']])(
    'rejects the blank token %j and keeps the previous value',
    async (bad) => {
      const storage = new InMemoryTokenStorage('valid-token');

      await expect(storage.setToken(bad)).rejects.toBeInstanceOf(AuthenticationError);
      await expect(storage.getToken()).resolves.toBe('valid-token');
    },
  );

  it('rejects a blank initial token', () => {
    expect(() => new InMemoryTokenStorage('')).toThrow(AuthenticationError);
  });

  it('keeps independent state per instance', async () => {
    const first = new InMemoryTokenStorage();
    const second = new InMemoryTokenStorage();

    await first.setToken('first-token');

    await expect(second.getToken()).resolves.toBeNull();
  });

  it('satisfies the TokenStorageAdapter contract', () => {
    expectTypeOf<InMemoryTokenStorage>().toMatchTypeOf<TokenStorageAdapter>();
  });
});

describe('SessionManager token storage adapter', () => {
  it('persists the access token in the adapter', async () => {
    const tokenStorage = new InMemoryTokenStorage();
    const session = new SessionManager({ tokenStorage });

    await session.setTokens({ accessToken: 'access-token', refreshToken: 'refresh-token' });

    await expect(tokenStorage.getToken()).resolves.toBe('access-token');
  });

  it('clears the adapter when credentials are cleared', async () => {
    const tokenStorage = new InMemoryTokenStorage('access-token');
    const session = new SessionManager({ tokenStorage });

    await session.clearTokens();

    await expect(tokenStorage.getToken()).resolves.toBeNull();
  });

  it('restores a session from the adapter', async () => {
    const tokenStorage = new InMemoryTokenStorage('persisted-token');
    const session = new SessionManager({ tokenStorage });

    await expect(session.restoreFromStorage()).resolves.toBe('persisted-token');
    expect(session.getAccessToken()).toBe('persisted-token');
  });

  it('does not overwrite an access token already held in memory', async () => {
    const tokenStorage = new InMemoryTokenStorage('stale-token');
    const session = new SessionManager({ accessToken: 'explicit-token', tokenStorage });

    await expect(session.restoreFromStorage()).resolves.toBeUndefined();
    expect(session.getAccessToken()).toBe('explicit-token');
  });

  it('returns undefined without advertising a token when no adapter is configured', async () => {
    const session = new SessionManager();

    await expect(session.restoreFromStorage()).resolves.toBeUndefined();
  });

  it('does not fail token adoption when the adapter rejects a write', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const tokenStorage: TokenStorageAdapter = {
      getToken: async () => null,
      setToken: async () => {
        throw new Error('quota exceeded');
      },
      clearToken: async () => undefined,
    };
    const session = new SessionManager({ tokenStorage });

    await expect(session.setTokens({ accessToken: 'access-token' })).resolves.toBeUndefined();
    expect(session.getAccessToken()).toBe('access-token');
    expect(warn).toHaveBeenCalled();

    warn.mockRestore();
  });
});

/**
 * Token storage adapters for `@astroid/auth` (issue #441).
 *
 * The SDK persists session credentials through an adapter so applications can
 * plug in any backend (localStorage, secure storage, a server-side cache) or
 * fall back to {@link InMemoryTokenStorage} when no persistence is available.
 *
 * @packageDocumentation
 */

import { AuthenticationError } from '@astroid/errors';

/**
 * Asynchronous contract for persisting a session token.
 *
 * Implementations should never throw for a token that is not present: an empty
 * store is reported as `null` from {@link TokenStorageAdapter.getToken}.
 *
 * @example
 * ```ts
 * const storage: TokenStorageAdapter = new InMemoryTokenStorage();
 * await storage.setToken(accessToken);
 * const token = await storage.getToken();
 * await storage.clearToken();
 * ```
 */
export interface TokenStorageAdapter {
  /**
   * Read the stored token.
   *
   * @returns The token, or `null` when the adapter holds no token.
   */
  getToken(): Promise<string | null>;

  /**
   * Persist `token`, replacing any previously stored token.
   *
   * @throws {AuthenticationError} When `token` is not a non-empty string.
   */
  setToken(token: string): Promise<void>;

  /** Remove the stored token, if any. */
  clearToken(): Promise<void>;
}

/** Reject blank credentials so a failed login can never be mistaken for one. */
function assertToken(token: string): void {
  if (typeof token !== 'string' || token.trim() === '') {
    throw new AuthenticationError('Token must be a non-empty string', {
      code: 'UNAUTHORIZED',
      status: 401,
    });
  }
}

/**
 * In-memory {@link TokenStorageAdapter} used when no durable storage is
 * available (or desirable, e.g. short-lived CLI sessions).
 *
 * The token lives only in this instance: it is never written to disk and is
 * discarded with the process. Each instance is independent, which makes the
 * adapter convenient for tests and for per-client isolation.
 *
 * @example
 * ```ts
 * const storage = new InMemoryTokenStorage();
 * const session = new SessionManager({ tokenStorage: storage });
 *
 * await session.setTokens({ accessToken: 'header.payload.signature' });
 * expect(await storage.getToken()).toBe('header.payload.signature');
 *
 * await session.clearTokens();
 * expect(await storage.getToken()).toBeNull();
 * ```
 */
export class InMemoryTokenStorage implements TokenStorageAdapter {
  private token: string | null;

  /**
   * @param initialToken Optional token to seed the store with.
   * @throws {AuthenticationError} When `initialToken` is an empty string.
   */
  constructor(initialToken?: string) {
    if (initialToken !== undefined) {
      assertToken(initialToken);
    }
    this.token = initialToken ?? null;
  }

  /** Read the token currently held in memory. */
  async getToken(): Promise<string | null> {
    return this.token;
  }

  /** Store `token`, overwriting any previous value. */
  async setToken(token: string): Promise<void> {
    assertToken(token);
    this.token = token;
  }

  /** Forget the stored token. Safe to call when nothing is stored. */
  async clearToken(): Promise<void> {
    this.token = null;
  }
}

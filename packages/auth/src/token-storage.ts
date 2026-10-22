/**
 * Pluggable token storage for `@astroid/auth` (issue #433).
 *
 * Session tokens need to survive in very different runtimes: a browser tab
 * (`localStorage`), a Node.js script / worker (process memory), or a custom
 * backend (secure storage, encrypted file, …). This module defines the two
 * storage shapes the SDK understands and ships a zero-dependency default:
 *
 * - {@link TokenStorage} — the `Storage`-compatible shape (`getItem` /
 *   `setItem` / `removeItem`). `localStorage` and `sessionStorage` satisfy it
 *   directly, so existing integrations keep working.
 * - {@link TokenStorageAdapter} — the token-oriented async adapter
 *   (`getToken` / `setToken` / `removeToken`) for custom backends. A
 *   {@link SessionManager} accepts either shape.
 * - {@link MemoryTokenStorage} — an in-memory implementation of both, suited to
 *   tests, server-side usage, and worker runtimes with no persistent storage.
 *
 * @module
 */

/**
 * Custom storage interface for persisting session tokens (e.g., `localStorage`).
 *
 * Methods may be synchronous or asynchronous; `SessionManager` awaits every
 * call, so both `localStorage` and a promise-based backend work.
 */
export interface TokenStorage {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
  removeItem(key: string): void | Promise<void>;
}

/**
 * Token-oriented storage adapter.
 *
 * Unlike {@link TokenStorage}'s generic `getItem` / `setItem` / `removeItem`
 * names, this interface is async by contract and speaks in tokens, which keeps
 * custom backends (secure storage, KV stores, encrypted files) simple to
 * implement. Pass an adapter as `SessionManagerConfig.storage` and the session
 * manager will use it directly.
 */
export interface TokenStorageAdapter {
  /** Read a persisted token, resolving `null` when the key is absent. */
  getToken(key: string): Promise<string | null>;
  /** Persist `value` under `key`, replacing any existing entry. */
  setToken(key: string, value: string): Promise<void>;
  /** Delete the token stored under `key`; a missing key is a no-op. */
  removeToken(key: string): Promise<void>;
}

/**
 * Default in-memory token storage.
 *
 * The store is backed by a `Map`, so reads and writes are synchronous under the
 * hood (exposed as promises by the adapter methods) and predictable in
 * single-threaded runtimes. Nothing is persisted across process restarts —
 * ideal for tests, server-side scripts, and worker runtimes; browser
 * deployments should use `localStorage` (a {@link TokenStorage}) instead.
 *
 * @example
 * ```ts
 * const storage = new MemoryTokenStorage();
 * const session = new SessionManager({ storage });
 *
 * await session.setTokens({ accessToken: 'a.b.c', refreshToken: 'r.e.f' });
 * await storage.getToken('astroid_auth_access_token'); // 'a.b.c'
 * await storage.removeToken('astroid_auth_access_token');
 * ```
 */
export class MemoryTokenStorage implements TokenStorage, TokenStorageAdapter {
  private readonly entries = new Map<string, string>();

  /** Number of tokens currently held. */
  get size(): number {
    return this.entries.size;
  }

  /** Storage-compatible read; returns `null` when the key is absent. */
  getItem(key: string): string | null {
    return this.entries.get(key) ?? null;
  }

  /** Storage-compatible write. */
  setItem(key: string, value: string): void {
    this.entries.set(key, value);
  }

  /** Storage-compatible delete; a missing key is a no-op. */
  removeItem(key: string): void {
    this.entries.delete(key);
  }

  /** Adapter-style read; resolves `null` when the key is absent. */
  async getToken(key: string): Promise<string | null> {
    return this.getItem(key);
  }

  /** Adapter-style write. */
  async setToken(key: string, value: string): Promise<void> {
    this.setItem(key, value);
  }

  /** Adapter-style delete; a missing key is a no-op. */
  async removeToken(key: string): Promise<void> {
    this.removeItem(key);
  }

  /** Drop every stored token (useful between test cases). */
  clear(): void {
    this.entries.clear();
  }
}

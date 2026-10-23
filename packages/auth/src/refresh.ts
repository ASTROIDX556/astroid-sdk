/**
 * Token refresh lifecycle helpers for `@astroid/auth`.
 *
 * @packageDocumentation
 */

import type { HttpClient } from '@astroid/core';
import type { AuthTokens } from '@astroid/types';
import type { SessionManager } from './session.js';

/** Configuration for a {@link RefreshManager}. */
export interface RefreshManagerConfig {
  /** Session that owns the access and refresh tokens. */
  sessionManager: SessionManager;
  /** Exchanges a refresh token for a new token pair. */
  refreshFn: (refreshToken: string) => Promise<AuthTokens>;
}

/**
 * Coordinates refresh requests through the session's single-flight queue.
 * Concurrent callers share the same in-flight refresh and session state is
 * updated by {@link SessionManager.refreshSession}.
 */
export class RefreshManager {
  private readonly sessionManager: SessionManager;
  private readonly refreshFn: (refreshToken: string) => Promise<AuthTokens>;

  constructor(config: RefreshManagerConfig) {
    this.sessionManager = config.sessionManager;
    this.refreshFn = config.refreshFn;
  }

  /** Refresh the current session, sharing any refresh already in progress. */
  refresh(): Promise<AuthTokens> {
    return this.sessionManager.refreshSession(this.refreshFn);
  }

  /** Whether a refresh request is currently in progress. */
  isRefreshing(): boolean {
    return this.sessionManager.isRefreshing();
  }

  /** Wait for an in-flight refresh to settle. */
  waitForRefresh(): Promise<void> {
    return this.sessionManager.waitForRefresh();
  }
}

/** Create a {@link RefreshManager} for the supplied session and refresh function. */
export function createRefreshManager(config: RefreshManagerConfig): RefreshManager {
  return new RefreshManager(config);
}

/**
 * Wire a refresh manager to an HTTP client. A 401 response triggers one
 * refresh attempt; the client retries the original request once on success.
 */
export function wireRefreshManagerToHttpClient(
  client: HttpClient,
  refreshManager: RefreshManager,
): void {
  client.set401Handler(async () => {
    try {
      const tokens = await refreshManager.refresh();
      client.setAccessToken(tokens.accessToken);
      return true;
    } catch {
      return false;
    }
  });
}

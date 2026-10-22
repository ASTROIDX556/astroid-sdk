/** @module */

/**
 * Token refresh manager that handles automatic JWT session token renewal.
 *
 * Uses a promise-based queue to ensure only one refresh request is executed
 * simultaneously when multiple calls encounter an expired token concurrently.
 *
 * @packageDocumentation
 */

import type { AuthTokens, AuthFailureReason } from '@astroid/types';
import type { SessionManager } from './session.js';
import { AuthenticationError } from '@astroid/errors';
import { getTokenExpiration, isTokenExpired } from './session.js';

/**
 * Options for constructing a RefreshManager.
 */
export interface RefreshManagerConfig {
  /** Session owning the token store and the single-flight refresh queue. */
  sessionManager: SessionManager;
  /** Exchanges a refresh token for fresh tokens (e.g. `POST /auth/refresh`). */
  refreshFn: (refreshToken: string) => Promise<AuthTokens>;
  /** URL fragments that must never wait on or trigger a refresh -- the auth
   * endpoints themselves (waiting on `/auth/refresh` would deadlock).
   * Defaults to the standard auth routes.
   */
  skipPaths?: readonly string[];
}

/**
 * Result of a successful token refresh.
 */
export interface RefreshResult {
  /** The new access token. */
  accessToken: string;
  /** The new refresh token (may be the same or rotated). */
  refreshToken: string;
  /** The token type (typically `'Bearer'`). */
  tokenType: string;
  /** How long the access token lives, in seconds. */
  expiresIn: number;
}

/**
 * Token refresh manager that handles automatic JWT session token renewal.
 *
 * Key features:
 * - Single-flight promise queue: concurrent refresh calls wait on the same
 *   refresh promise, preventing duplicate network requests.
 * - Proactive refresh before requests are sent when the access token is
 *   already expired.
 * - Safe handling of failed refreshes that clears session state and notifies
 *   configured callbacks.
 * - Skip paths to avoid deadlocks with auth endpoints.
 */
export class RefreshManager {
  private readonly sessionManager: SessionManager;
  private readonly refreshFn: (refreshToken: string) => Promise<AuthTokens>;
  private readonly skipPaths: readonly string[];
  private refreshQueue: Promise<AuthTokens> | null = null;

  /**
   * Creates a new RefreshManager.
   */
  constructor(config: RefreshManagerConfig) {
    this.sessionManager = config.sessionManager;
    this.refreshFn = config.refreshFn;
    this.skipPaths = config.skipPaths ?? ['/auth/refresh', '/auth/login', '/auth/register'];
  }

  /** URL path fragments that must never trigger a refresh. */
  getSkipPaths(): readonly string[] {
    return this.skipPaths;
  }

  /**
   * Refresh the access token using the stored refresh token.
   *
   * This method uses a promise-based queue to ensure only one refresh request
   * is executed at a time. Concurrent calls waiting on an expired token will
   * share the same refresh promise, preventing duplicate refresh network calls.
   *
   * @returns A promise that resolves with the new AuthTokens, or rejects if
   *   the refresh token is missing, expired, or the refresh itself fails.
   *
   * @throws {AuthenticationError} When the refresh token is missing, expired,
   *   or the refresh operation fails.
   */
  async refresh(): Promise<AuthTokens> {
    if (this.sessionManager.authMode === 'apiKey') {
      throw new AuthenticationError(
        'API key authentication does not support token refresh',
        { code: 'API_KEY_MODE', status: 401 },
      );
    }

    // Single-flight: if a refresh is already in flight, wait on it.
    if (this.refreshQueue) {
      return this.refreshQueue;
    }

    // Check if we have a refresh token and it's not expired.
    if (
      !this.sessionManager.getRefreshToken() ||
      this.sessionManager.isRefreshTokenExpired(0)
    ) {
      await this.sessionManager.handleAuthFailure(
        'refresh_token_expired',
        undefined,
      );
      throw new AuthenticationError(
        'Refresh token is missing or expired',
        { code: 'TOKEN_EXPIRED', status: 401 },
      );
    }

    const tokenToUse = this.sessionManager.getRefreshToken()!;

    // Queue the refresh promise to ensure single-flight behavior.
    this.refreshQueue = (async () => {
      try {
        const tokens = await this.refreshFn(tokenToUse);
        await this.sessionManager.setTokens({
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
        });
        return tokens;
      } catch (err) {
        // Failed refresh already clears tokens and emits events via
        // handleAuthFailure; re-throw as AuthenticationError.
        if (err instanceof AuthenticationError) {
          throw err;
        }
        throw new AuthenticationError(
          'Failed to refresh session token',
          {
            code: 'TOKEN_EXPIRED',
            status: 401,
            cause: err,
          },
        );
      } finally {
        // Allow the next concurrent refresh to proceed.
        this.refreshQueue = null;
      }
    })();

    return this.refreshQueue;
  }

  /**
   * Wait for any in-flight refresh to complete.
   *
   * Resolves immediately when no refresh is pending. If the refresh fails,
   * the error is swallowed -- waiting callers should surface the resulting
   * authentication error through their normal 401 path.
   */
  async waitForRefresh(): Promise<void> {
    const pending = this.refreshQueue;
    if (!pending) return;
    try {
      await pending;
    } catch {
      // The failed refresh already cleared tokens; the caller's own request
      // will produce the authoritative authentication error.
    }
  }

  /**
   * Proactively refresh the access token if it is expired or close to expiration.
   *
   * This is useful before sending a request to avoid an unnecessary 401
   * round-trip. If the token is not yet expired, this method resolves
   * immediately without making a refresh call.
   *
   * @param bufferSeconds Optional buffer (in seconds) before the token is
   *   considered expired. Defaults to the session manager's configured buffer.
   * @returns The new AuthTokens if a refresh was performed, or the current
   *   tokens if the access token was still valid.
   */
  async maybeRefresh(bufferSeconds?: number): Promise<AuthTokens> {
    // If the access token is still valid, return current tokens immediately.
    if (
      this.sessionManager.getAccessToken() &&
      !isTokenExpired(this.sessionManager.getAccessToken()!, bufferSeconds ?? 30)
    ) {
      return this.currentTokens();
    }

    // Otherwise, perform a refresh.
    const newTokens = await this.refresh();
    return newTokens;
  }

  /** Return the current access and refresh tokens. */
  private currentTokens(): AuthTokens {
    return {
      accessToken: this.sessionManager.getAccessToken()!,
      refreshToken: this.sessionManager.getRefreshToken()!,
      tokenType: 'Bearer',
      expiresIn: 3600,
    };
  }

  /**
   * Check if a refresh is currently in progress.
   *
   * @returns `true` while a refresh started by {@link refresh} is in flight.
   */
  isRefreshing(): boolean {
    return this.refreshQueue !== null;
  }
}

/**
 * Wire a RefreshManager to an HttpClient so that 401 Unauthorized responses
 * trigger automatic token refresh and the failed request is retried with the
 * new credentials.
 *
 * This function integrates with the HttpClient's `set401Handler` to provide
 * seamless token refresh behavior.
 *
 * @param client The HttpClient to integrate with.
 * @param refreshManager The RefreshManager instance handling the refresh lifecycle.
 * @param refreshFn Optional override for the refresh function. If omitted,
 *   the RefreshManager's configured refreshFn will be used.
 */
export function wireRefreshManagerToHttpClient(
  client: import('@astroid/core').HttpClient,
  refreshManager: RefreshManager,
  refreshFn?: (refreshToken: string) => Promise<AuthTokens>,
): void {
  const refreshFunction = refreshFn ?? refreshManager.refreshFn;

  client.set401Handler(async () => {
    try {
      await refreshManager.refresh();
      const token = refreshManager.sessionManager.getAccessToken();
      if (token) client.setAccessToken(token);
      return true;
    } catch {
      return false;
    }
  });
}

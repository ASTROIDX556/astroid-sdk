/**
 * Token rotation and refresh coordination utilities for `@astroid/auth`.
 *
 * @packageDocumentation
 */

import { AuthenticationError } from '@astroid/errors';
import type { AuthTokens } from '@astroid/types';

import { isTokenExpired } from './session.js';

/** Configuration options for {@link TokenRotator}. */
export interface TokenRotatorConfig {
  /** Buffer in seconds before actual expiration to trigger rotation. Default 30. */
  bufferSeconds?: number;
  /** Callback function to invoke when performing token refresh. */
  refreshFn?: (refreshToken: string) => Promise<AuthTokens>;
  /** Callback fired when tokens are updated. */
  onTokenUpdate?: (tokens: AuthTokens) => void | Promise<void>;
  /** Callback fired when token rotation fails (e.g. revoked or expired refresh token). */
  onRotationFailure?: (error: unknown) => void | Promise<void>;
}

/** Options for {@link rotateTokens}. */
export interface RotateTokensOptions {
  /** The refresh token to exchange. */
  refreshToken: string;
  /** The refresh function. */
  refreshFn: (refreshToken: string) => Promise<AuthTokens>;
  /** Optional callback fired when tokens are updated. */
  onTokenUpdate?: (tokens: AuthTokens) => void | Promise<void>;
}

/**
 * Check if an access token is expired or close to expiration and requires rotation.
 *
 * @param token Access token string to inspect.
 * @param bufferSeconds Buffer window in seconds. Defaults to 30.
 */
export function shouldRotateToken(token: string | undefined, bufferSeconds = 30): boolean {
  return isTokenExpired(token, bufferSeconds);
}

/**
 * Check if a token will expire within the specified buffer window.
 *
 * @param token Token string to inspect.
 * @param bufferSeconds Buffer window in seconds. Defaults to 30.
 */
export function isTokenExpiring(token: string | undefined, bufferSeconds = 30): boolean {
  return isTokenExpired(token, bufferSeconds);
}

/**
 * Coordinates safe token refresh and rotation, preventing duplicate concurrent
 * refresh calls, tracking token expiration, and propagating failure details.
 */
export class TokenRotator {
  private activeRotationPromise: Promise<AuthTokens> | null = null;
  private readonly bufferSeconds: number;
  private readonly refreshFn?: (refreshToken: string) => Promise<AuthTokens>;
  private readonly onTokenUpdate?: (tokens: AuthTokens) => void | Promise<void>;
  private readonly onRotationFailure?: (error: unknown) => void | Promise<void>;

  constructor(config: TokenRotatorConfig = {}) {
    this.bufferSeconds = config.bufferSeconds ?? 30;
    this.refreshFn = config.refreshFn;
    this.onTokenUpdate = config.onTokenUpdate;
    this.onRotationFailure = config.onRotationFailure;
  }

  /** Check if a token requires rotation based on the configured buffer. */
  shouldRotate(accessToken: string | undefined): boolean {
    return shouldRotateToken(accessToken, this.bufferSeconds);
  }

  /** Whether a rotation operation is currently in flight. */
  isRotating(): boolean {
    return this.activeRotationPromise !== null;
  }

  /**
   * Rotate tokens safely using the provided or configured refresh function.
   * Concurrent calls share the same in-flight refresh promise.
   *
   * @param refreshToken The active refresh token.
   * @param refreshFn Optional refresh callback overriding the constructor configuration.
   */
  async rotate(
    refreshToken: string,
    refreshFn?: (refreshToken: string) => Promise<AuthTokens>,
  ): Promise<AuthTokens> {
    const fn = refreshFn ?? this.refreshFn;
    if (!fn) {
      const err = new AuthenticationError('No refresh function provided for token rotation', {
        code: 'MISSING_REFRESH_FN',
        status: 401,
      });
      if (this.onRotationFailure) {
        try {
          await this.onRotationFailure(err);
        } catch {
          // swallow callback errors
        }
      }
      throw err;
    }

    if (!refreshToken || isTokenExpired(refreshToken, 0)) {
      const err = new AuthenticationError('Refresh token is missing or expired', {
        code: 'TOKEN_EXPIRED',
        status: 401,
      });
      if (this.onRotationFailure) {
        try {
          await this.onRotationFailure(err);
        } catch {
          // swallow callback errors
        }
      }
      throw err;
    }

    if (this.activeRotationPromise) {
      return this.activeRotationPromise;
    }

    this.activeRotationPromise = (async () => {
      try {
        const tokens = await fn(refreshToken);
        if (this.onTokenUpdate) {
          await this.onTokenUpdate(tokens);
        }
        return tokens;
      } catch (err) {
        if (this.onRotationFailure) {
          try {
            await this.onRotationFailure(err);
          } catch {
            // swallow callback errors
          }
        }
        if (err instanceof AuthenticationError) {
          throw err;
        }
        throw new AuthenticationError('Token rotation failed', {
          code: 'TOKEN_ROTATION_FAILED',
          status: 401,
          cause: err,
        });
      } finally {
        this.activeRotationPromise = null;
      }
    })();

    return this.activeRotationPromise;
  }
}

/**
 * Helper for single-shot token rotation.
 */
export async function rotateTokens(options: RotateTokensOptions): Promise<AuthTokens> {
  const rotator = new TokenRotator({
    onTokenUpdate: options.onTokenUpdate,
  });
  return rotator.rotate(options.refreshToken, options.refreshFn);
}

import type { HttpClient, Middleware, PreparedRequest } from '@astroid/core';
import { AuthenticationError } from '@astroid/errors';
import type { AuthTokens } from '@astroid/types';
import type { SessionManager } from './session.js';

/**
 * Wire a {@link SessionManager} to an {@link HttpClient} so that 401
 * responses trigger automatic token refresh and the failed request is
 * retried with the new credentials.
 *
 * ```ts
 * import { SessionManager, wireSessionToHttpClient } from '@astroid/auth';
 *
 * const session = new SessionManager({ storage: localStorage });
 * const client = new Astroid({ baseUrl, apiKey });
 * wireSessionToHttpClient(client, session, refreshFn);
 * ```
 */
export function wireSessionToHttpClient(
  client: HttpClient,
  sessionManager: SessionManager,
  refreshFn: (refreshToken: string) => Promise<AuthTokens>,
): void {
  // API-key sessions have no refresh cycle: attach the key header via
  // middleware instead of a 401 handler.
  if (sessionManager.mode === 'apiKey') {
    client.use(createSessionMiddleware(sessionManager, refreshFn));
    return;
  }

  client.set401Handler(async () => {
    try {
      await sessionManager.refreshSession(refreshFn);
      const token = sessionManager.getAccessToken();
      if (token) client.setAccessToken(token);
      return true;
    } catch {
      return false;
    }
  });
}

/**
 * Creates an SDK middleware interceptor that checks for token expiration
 * and automatically triggers queued session refresh before outgoing requests.
 */
export function createSessionMiddleware(
  sessionManager: SessionManager,
  refreshFn: (refreshToken: string) => Promise<AuthTokens>,
): Middleware {
  return {
    name: 'session-auto-refresh',
    async onRequest(req: PreparedRequest): Promise<PreparedRequest> {
      // API-key sessions carry a long-lived header and never refresh.
      if (sessionManager.mode === 'apiKey') {
        const apiKey = sessionManager.getApiKey();
        return apiKey ? { ...req, headers: sessionManager.applyAuthHeaders(req.headers) } : req;
      }

      // Do not intercept authentication endpoints to prevent cyclic calls
      if (
        req.url.includes('/auth/refresh') ||
        req.url.includes('/auth/login') ||
        req.url.includes('/auth/register')
      ) {
        return req;
      }

      if (sessionManager.getRefreshToken() && sessionManager.isAccessTokenExpired()) {
        try {
          const newTokens = await sessionManager.refreshSession(refreshFn);
          return {
            ...req,
            headers: {
              ...req.headers,
              authorization: `Bearer ${newTokens.accessToken}`,
            },
          };
        } catch (err) {
          if (err instanceof AuthenticationError) {
            throw err;
          }
          throw new AuthenticationError('Session expired and token refresh failed', {
            code: 'TOKEN_EXPIRED',
            status: 401,
            cause: err,
          });
        }
      }

      return req;
    },
    async onError(error: unknown, _req: PreparedRequest): Promise<void> {
      if (error instanceof AuthenticationError && error.status === 401) {
        await sessionManager.clearTokens();
      }
    },
  };
}

/**
 * `@astroid/auth` — authentication and developer-credential resource.
 *
 * Wraps the Astroid auth endpoints: registration, password login, token
 * refresh, the current session, sessions management, passkeys, and API keys.
 * On a successful login/refresh the resource pushes the new access token into
 * the shared {@link HttpClient} so subsequent calls are authenticated.
 *
 * @packageDocumentation
 */

import type { HttpClient, RequestOptionsExtras } from '@astroid/core';
import type {
  ApiKey,
  ApiKeyWithSecret,
  AuthSession,
  AuthTokens,
  CreateApiKeyInput,
  LoginInput,
  PasskeyRegisterInput,
  PasskeyVerifyInput,
  RefreshInput,
  RegisterInput,
  Session,
} from '@astroid/types';
import type { SessionManager } from './session.js';

export * from './session.js';

/** The full result of a login/register: tokens plus the resolved session. */
export interface AuthResult extends AuthTokens {
  session?: AuthSession;
}

/**
 * The `auth` namespace on the Astroid client.
 *
 * Unlike list-style resources this class talks to the {@link HttpClient}
 * directly: auth flows manage tokens and sessions rather than paginated
 * collections. After `register`, `login`, `refresh`, or `passkeyVerify`, the
 * returned access token is set on the client automatically.
 */
export class AuthResource {
  private readonly client: HttpClient;
  readonly sessionManager?: SessionManager;

  constructor(client: HttpClient, sessionManager?: SessionManager) {
    this.client = client;
    this.sessionManager = sessionManager;
  }

  /** Create a new organization and its first owner, returning auth tokens. */
  async register(input: RegisterInput, options?: RequestOptionsExtras): Promise<AuthResult> {
    const res = await this.client.post<AuthResult>('/auth/register', input, options);
    await this.adoptToken(res.data);
    return res.data;
  }

  /** Log in with email + password. Sets the access token on the client. */
  async login(input: LoginInput, options?: RequestOptionsExtras): Promise<AuthResult> {
    const res = await this.client.post<AuthResult>('/auth/login', input, options);
    await this.adoptToken(res.data);
    return res.data;
  }

  /** Exchange a refresh token for a fresh access token. */
  async refresh(input: RefreshInput, options?: RequestOptionsExtras): Promise<AuthTokens> {
    const res = await this.client.post<AuthTokens>('/auth/refresh', input, options);
    await this.adoptToken(res.data);
    return res.data;
  }

  /** Revoke the current session server-side and clear the local token. */
  async logout(options?: RequestOptionsExtras): Promise<void> {
    try {
      await this.client.post<void>('/auth/logout', undefined, options);
    } finally {
      this.client.setAccessToken(undefined);
      await this.sessionManager?.clearTokens();
    }
  }

  /** The currently authenticated user, organization, and session. */
  async me(options?: RequestOptionsExtras): Promise<AuthSession> {
    const res = await this.client.get<AuthSession>('/auth/me', options);
    return res.data;
  }

  /* ------------------------------- passkeys ------------------------------- */

  /**
   * Begin passkey (WebAuthn) registration; returns the creation options to pass
   * to the browser's `navigator.credentials.create`.
   */
  async passkeyRegister(
    input: PasskeyRegisterInput,
    options?: RequestOptionsExtras,
  ): Promise<Record<string, unknown>> {
    const res = await this.client.post<Record<string, unknown>>(
      '/auth/passkey/register',
      input,
      options,
    );
    return res.data;
  }

  /** Complete passkey authentication; sets the access token on success. */
  async passkeyVerify(
    input: PasskeyVerifyInput,
    options?: RequestOptionsExtras,
  ): Promise<AuthResult> {
    const res = await this.client.post<AuthResult>('/auth/passkey/verify', input, options);
    await this.adoptToken(res.data);
    return res.data;
  }

  /* ------------------------------- sessions ------------------------------- */

  /** List the current user's active sessions. */
  async listSessions(options?: RequestOptionsExtras): Promise<Session[]> {
    const res = await this.client.get<Session[]>('/auth/sessions', options);
    return res.data ?? [];
  }

  /** Revoke a single session by id. */
  async revokeSession(sessionId: string, options?: RequestOptionsExtras): Promise<void> {
    await this.client.delete<void>(`/auth/sessions/${encodeURIComponent(sessionId)}`, options);
  }

  /** Revoke every session except the current one. */
  async revokeOtherSessions(options?: RequestOptionsExtras): Promise<void> {
    await this.client.post<void>('/auth/sessions/revoke-others', undefined, options);
  }

  /* ------------------------------- API keys ------------------------------- */

  /** List the organization's API keys (secrets are never returned here). */
  async listApiKeys(options?: RequestOptionsExtras): Promise<ApiKey[]> {
    const res = await this.client.get<ApiKey[]>('/auth/api-keys', options);
    return res.data ?? [];
  }

  /**
   * Create an API key. The plaintext `key` is returned exactly once — persist
   * it now; it cannot be retrieved again.
   */
  async createApiKey(
    input: CreateApiKeyInput,
    options?: RequestOptionsExtras,
  ): Promise<ApiKeyWithSecret> {
    const res = await this.client.post<ApiKeyWithSecret>('/auth/api-keys', input, options);
    return res.data;
  }

  /** Revoke an API key by id. */
  async revokeApiKey(apiKeyId: string, options?: RequestOptionsExtras): Promise<void> {
    await this.client.delete<void>(`/auth/api-keys/${encodeURIComponent(apiKeyId)}`, options);
  }

  /** Push a freshly-issued access token onto the shared client, if present. */
  private async adoptToken(tokens: Partial<AuthTokens> | undefined): Promise<void> {
    if (tokens?.accessToken) {
      this.client.setAccessToken(tokens.accessToken);
      if (this.sessionManager) {
        await this.sessionManager.setTokens({
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
        });
      }
    }
  }
}

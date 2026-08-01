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

import type { HttpClient } from '@astroid/core';
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

  constructor(client: HttpClient) {
    this.client = client;
  }

  /** Create a new organization and its first owner, returning auth tokens. */
  async register(input: RegisterInput): Promise<AuthResult> {
    const res = await this.client.post<AuthResult>('/auth/register', input);
    this.adoptToken(res.data);
    return res.data;
  }

  /** Log in with email + password. Sets the access token on the client. */
  async login(input: LoginInput): Promise<AuthResult> {
    const res = await this.client.post<AuthResult>('/auth/login', input);
    this.adoptToken(res.data);
    return res.data;
  }

  /** Exchange a refresh token for a fresh access token. */
  async refresh(input: RefreshInput): Promise<AuthTokens> {
    const res = await this.client.post<AuthTokens>('/auth/refresh', input);
    this.adoptToken(res.data);
    return res.data;
  }

  /** Revoke the current session server-side and clear the local token. */
  async logout(): Promise<void> {
    await this.client.post<void>('/auth/logout');
    this.client.setAccessToken(undefined);
  }

  /** The currently authenticated user, organization, and session. */
  async me(): Promise<AuthSession> {
    const res = await this.client.get<AuthSession>('/auth/me');
    return res.data;
  }

  /* ------------------------------- passkeys ------------------------------- */

  /**
   * Begin passkey (WebAuthn) registration; returns the creation options to pass
   * to the browser's `navigator.credentials.create`.
   */
  async passkeyRegister(input: PasskeyRegisterInput): Promise<Record<string, unknown>> {
    const res = await this.client.post<Record<string, unknown>>('/auth/passkey/register', input);
    return res.data;
  }

  /** Complete passkey authentication; sets the access token on success. */
  async passkeyVerify(input: PasskeyVerifyInput): Promise<AuthResult> {
    const res = await this.client.post<AuthResult>('/auth/passkey/verify', input);
    this.adoptToken(res.data);
    return res.data;
  }

  /* ------------------------------- sessions ------------------------------- */

  /** List the current user's active sessions. */
  async listSessions(): Promise<Session[]> {
    const res = await this.client.get<Session[]>('/auth/sessions');
    return res.data ?? [];
  }

  /** Revoke a single session by id. */
  async revokeSession(sessionId: string): Promise<void> {
    await this.client.delete<void>(`/auth/sessions/${encodeURIComponent(sessionId)}`);
  }

  /** Revoke every session except the current one. */
  async revokeOtherSessions(): Promise<void> {
    await this.client.post<void>('/auth/sessions/revoke-others');
  }

  /* ------------------------------- API keys ------------------------------- */

  /** List the organization's API keys (secrets are never returned here). */
  async listApiKeys(): Promise<ApiKey[]> {
    const res = await this.client.get<ApiKey[]>('/auth/api-keys');
    return res.data ?? [];
  }

  /**
   * Create an API key. The plaintext `key` is returned exactly once — persist
   * it now; it cannot be retrieved again.
   */
  async createApiKey(input: CreateApiKeyInput): Promise<ApiKeyWithSecret> {
    const res = await this.client.post<ApiKeyWithSecret>('/auth/api-keys', input);
    return res.data;
  }

  /** Revoke an API key by id. */
  async revokeApiKey(apiKeyId: string): Promise<void> {
    await this.client.delete<void>(`/auth/api-keys/${encodeURIComponent(apiKeyId)}`);
  }

  /** Push a freshly-issued access token onto the shared client, if present. */
  private adoptToken(tokens: Partial<AuthTokens> | undefined): void {
    if (tokens?.accessToken) {
      this.client.setAccessToken(tokens.accessToken);
    }
  }
}

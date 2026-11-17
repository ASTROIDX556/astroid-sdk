import { describe, expect, it } from 'vitest';

import {
  AuthenticationError,
  AuthorizationError,
  ForbiddenError,
  isAuthenticationError,
  isForbiddenError,
} from '@astroid/errors';
import type { ApiKey, ApiKeyWithSecret } from '@astroid/types';

import {
  assertScope as assertScopeFromIndex,
  decodeSessionToken,
  extractScopes as extractScopesFromIndex,
  hasAnyScope as hasAnyScopeFromIndex,
  hasScope as hasScopeFromIndex,
  isValidScopeString as isValidScopeStringFromIndex,
  matchScope as matchScopeFromIndex,
  requireScope as requireScopeFromIndex,
  SessionManager,
  validateScope as validateScopeFromIndex,
  validateScopes as validateScopesFromIndex,
} from './index.js';
import {
  assertScope,
  extractScopes,
  hasAnyScope,
  hasScope,
  isValidScopeString,
  matchScope,
  requireScope,
  validateScope,
  validateScopes,
} from './scopes.js';

function makeJwt(
  payload: Record<string, unknown>,
  signature = 'super_secret_jwt_signature_998877',
): string {
  const b64 = (obj: Record<string, unknown>) =>
    Buffer.from(JSON.stringify(obj)).toString('base64url');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}.${signature}`;
}

function makeApiKey(overrides: Partial<ApiKey> = {}): ApiKey {
  return {
    id: 'key_01HXYZ',
    organizationId: 'org_01HXYZ',
    name: 'Agent Settlement Key',
    prefix: 'ast_live',
    permissions: ['wallets:read', 'transactions:create'],
    createdAt: '2026-01-01T00:00:00.000Z',
    expiresAt: null,
    revokedAt: null,
    ...overrides,
  };
}

describe('Scope validation helpers — Issue #455', () => {
  describe('isValidScopeString', () => {
    it('validates scope string formats', () => {
      expect(isValidScopeString('wallets:read')).toBe(true);
      expect(isValidScopeString('wallets:*')).toBe(true);
      expect(isValidScopeString('*')).toBe(true);
      expect(isValidScopeString('a:b:c')).toBe(true);

      expect(isValidScopeString('')).toBe(false);
      expect(isValidScopeString(' ')).toBe(false);
      expect(isValidScopeString('wallets: read')).toBe(false);
      expect(isValidScopeString('wallets::read')).toBe(false);
      expect(isValidScopeString('wallets:read:')).toBe(false);
      expect(isValidScopeString(null)).toBe(false);
      expect(isValidScopeString(123)).toBe(false);
    });
  });

  describe('matchScope', () => {
    it('handles exact matches', () => {
      expect(matchScope('wallets:read', 'wallets:read')).toBe(true);
      expect(matchScope('wallets:read', 'wallets:write')).toBe(false);
      expect(matchScope('transactions:create', 'wallets:create')).toBe(false);
    });

    it('handles global wildcards (*)', () => {
      expect(matchScope('*', 'wallets:read')).toBe(true);
      expect(matchScope('*', 'anything:any:action')).toBe(true);
      expect(matchScope('*:*', 'wallets:read')).toBe(true);
    });

    it('handles hierarchical wildcard matches', () => {
      expect(matchScope('wallets:*', 'wallets:read')).toBe(true);
      expect(matchScope('wallets:*', 'wallets:write')).toBe(true);
      expect(matchScope('wallets:*', 'wallets:transfers:create')).toBe(true);
      expect(matchScope('wallets:*', 'agents:read')).toBe(false);
    });

    it('fails closed on malformed inputs', () => {
      expect(matchScope('', 'wallets:read')).toBe(false);
      expect(matchScope('wallets:read', '')).toBe(false);
      expect(matchScope('wallets: read', 'wallets:read')).toBe(false);
    });
  });

  describe('validateScope', () => {
    it('validates single granted scope string or array against required scope', () => {
      expect(validateScope('wallets:read', 'wallets:read')).toBe(true);
      expect(validateScope(['agents:read', 'wallets:*'], 'wallets:write')).toBe(true);
      expect(validateScope(['agents:read'], 'wallets:write')).toBe(false);
    });

    it('fails closed when granted scopes are missing, empty, or null', () => {
      expect(validateScope(undefined, 'wallets:read')).toBe(false);
      expect(validateScope(null, 'wallets:read')).toBe(false);
      expect(validateScope([], 'wallets:read')).toBe(false);
      expect(validateScope('', 'wallets:read')).toBe(false);
    });
  });

  describe('validateScopes', () => {
    it('validates multiple required scopes (all must be satisfied)', () => {
      const granted = ['wallets:*', 'agents:read'];

      expect(validateScopes(granted, ['wallets:read', 'agents:read'])).toBe(true);
      expect(validateScopes(granted, ['wallets:read', 'agents:write'])).toBe(false);
    });

    it('fails closed when inputs are invalid', () => {
      expect(validateScopes(null, ['wallets:read'])).toBe(false);
      expect(validateScopes(['wallets:*'], [])).toBe(false);
    });
  });
});

describe('API key permission verification & token scope checking — Issue #425', () => {
  it('re-exports all scope verification utilities from @astroid/auth entry point', () => {
    expect(hasScopeFromIndex).toBe(hasScope);
    expect(hasAnyScopeFromIndex).toBe(hasAnyScope);
    expect(assertScopeFromIndex).toBe(assertScope);
    expect(requireScopeFromIndex).toBe(requireScope);
    expect(extractScopesFromIndex).toBe(extractScopes);
    expect(isValidScopeStringFromIndex).toBe(isValidScopeString);
    expect(matchScopeFromIndex).toBe(matchScope);
    expect(validateScopeFromIndex).toBe(validateScope);
    expect(validateScopesFromIndex).toBe(validateScopes);
    expect(requireScope).toBe(assertScope);
  });

  describe('hasScope with JWT tokens and payloads', () => {
    it('evaluates exact, hierarchical wildcard, and global wildcard scopes on active JWTs', () => {
      const exp = Math.floor(Date.now() / 1000) + 3600;
      const token = makeJwt({
        sub: 'agt_1',
        scopes: ['wallets:*', 'transactions:read'],
        exp,
      });

      expect(hasScope(token, 'transactions:read')).toBe(true);
      expect(hasScope(token, 'wallets:write')).toBe(true);
      expect(hasScope(token, 'wallets:transfers:approve')).toBe(true);
      expect(hasScope(token, ['wallets:read', 'transactions:read'])).toBe(true);
      expect(hasScope(token, 'policies:write')).toBe(false);
      expect(hasScope(token, ['wallets:read', 'policies:write'])).toBe(false);

      const superToken = makeJwt({ sub: 'agt_root', scopes: ['*'], exp });
      expect(hasScope(superToken, 'policies:delete')).toBe(true);
    });

    it('supports Bearer header prefix, OAuth2 space/comma-delimited scope strings, and DecodedSessionToken', () => {
      const exp = Math.floor(Date.now() / 1000) + 3600;
      const oauthToken = makeJwt({
        sub: 'agt_2',
        scope: 'wallets:read, agents:execute budgets:read',
        exp,
      });

      expect(hasScope(`Bearer ${oauthToken}`, 'wallets:read')).toBe(true);
      expect(hasScope(`bearer ${oauthToken}`, 'agents:execute')).toBe(true);
      expect(hasScope(oauthToken, 'budgets:read')).toBe(true);
      expect(hasScope(oauthToken, 'budgets:write')).toBe(false);

      const decoded = decodeSessionToken(oauthToken);
      expect(hasScope(decoded, 'agents:execute')).toBe(true);
      expect(hasScope(decoded.payload, 'wallets:read')).toBe(true);
      expect(extractScopes(decoded)).toEqual(['wallets:read', 'agents:execute', 'budgets:read']);
    });

    it('integrates with token expiration and bufferSeconds', () => {
      const expiredToken = makeJwt({
        sub: 'agt_expired',
        scopes: ['*'],
        exp: Math.floor(Date.now() / 1000) - 10,
      });

      expect(hasScope(expiredToken, 'wallets:read')).toBe(false);
      expect(extractScopes(expiredToken)).toEqual([]);
      expect(hasScope(expiredToken, 'wallets:read', { checkExpiration: false })).toBe(true);

      const decodedExpired = decodeSessionToken(expiredToken);
      expect(hasScope(decodedExpired, 'wallets:read')).toBe(false);
      expect(hasScope(decodedExpired.payload, 'wallets:read')).toBe(false);

      const soonToken = makeJwt({
        sub: 'agt_soon',
        scopes: ['wallets:read'],
        exp: Math.floor(Date.now() / 1000) + 15,
      });
      expect(hasScope(soonToken, 'wallets:read')).toBe(true);
      expect(hasScope(soonToken, 'wallets:read', { bufferSeconds: 30 })).toBe(false);
    });
  });

  describe('hasScope with SessionManager and ApiKey metadata', () => {
    it('evaluates scopes directly from SessionManager instances', () => {
      const validJwt = makeJwt({
        sub: 'agt_sm',
        scopes: ['wallets:*', 'budgets:read'],
        exp: Math.floor(Date.now() / 1000) + 600,
      });
      const activeSession = new SessionManager({ accessToken: validJwt });
      expect(hasScope(activeSession, 'wallets:transfer')).toBe(true);
      expect(hasScope(activeSession, 'budgets:write')).toBe(false);

      const expiredJwt = makeJwt({
        sub: 'agt_sm_exp',
        scopes: ['*'],
        exp: Math.floor(Date.now() / 1000) - 5,
      });
      const expiredSession = new SessionManager({ accessToken: expiredJwt });
      expect(hasScope(expiredSession, 'wallets:read')).toBe(false);

      const emptySession = new SessionManager();
      expect(hasScope(emptySession, 'wallets:read')).toBe(false);

      const opaqueKeySession = new SessionManager({ apiKey: 'ast_live_opaque_secret_12345' });
      expect(hasScope(opaqueKeySession, 'wallets:read')).toBe(false);
    });

    it('verifies ApiKey permissions, expiresAt, and revokedAt lifecycle fields', () => {
      const futureIso = new Date(Date.now() + 60_000).toISOString();
      const pastIso = new Date(Date.now() - 60_000).toISOString();

      const validKey = makeApiKey({
        permissions: ['wallets:*', 'analytics:read'],
        expiresAt: futureIso,
      });
      expect(hasScope(validKey, 'wallets:create')).toBe(true);
      expect(hasScope(validKey, ['wallets:read', 'analytics:read'])).toBe(true);
      expect(hasScope(validKey, 'policies:write')).toBe(false);

      const expiredKey = makeApiKey({
        permissions: ['*'],
        expiresAt: pastIso,
      });
      expect(hasScope(expiredKey, 'wallets:read')).toBe(false);
      expect(hasScope(expiredKey, 'wallets:read', { checkExpiration: false })).toBe(true);

      const revokedKey = makeApiKey({
        permissions: ['*'],
        revokedAt: '2026-05-01T00:00:00.000Z',
      });
      expect(hasScope(revokedKey, 'wallets:read')).toBe(false);
      // Revoked keys remain invalid even if expiration checks are disabled
      expect(hasScope(revokedKey, 'wallets:read', { checkExpiration: false })).toBe(false);
    });

    it('supports explicit scope arrays and hasAnyScope (OR semantics)', () => {
      const apiKey = makeApiKey({ permissions: ['wallets:read', 'budgets:read'] });
      expect(hasScope(['wallets:*'], 'wallets:write')).toBe(true);
      expect(hasAnyScope(apiKey, ['wallets:write', 'budgets:read'])).toBe(true);
      expect(hasAnyScope(apiKey, ['wallets:write', 'policies:write'])).toBe(false);
      expect(hasAnyScope(apiKey, [])).toBe(false);
      expect(hasAnyScope(null, ['wallets:read'])).toBe(false);
    });

    it('fails closed on null, undefined, malformed tokens, and invalid required scopes', () => {
      const validKey = makeApiKey({ permissions: ['*'] });
      expect(hasScope(null, 'wallets:read')).toBe(false);
      expect(hasScope(undefined, 'wallets:read')).toBe(false);
      expect(hasScope('', 'wallets:read')).toBe(false);
      expect(hasScope('ast_live_raw_secret_without_metadata', 'wallets:read')).toBe(false);
      expect(hasScope('not.a.valid-json-jwt', 'wallets:read')).toBe(false);
      expect(hasScope(validKey, '')).toBe(false);
      expect(hasScope(validKey, [])).toBe(false);
      expect(hasScope(validKey, 'wallets: invalid')).toBe(false);
    });
  });

  describe('assertScope / requireScope & zero credential leakage guarantees', () => {
    it('passes silently when required scopes are satisfied', () => {
      const exp = Math.floor(Date.now() / 1000) + 3600;
      const token = makeJwt({ scopes: ['wallets:*', 'transactions:create'], exp });
      expect(() => assertScope(token, 'wallets:read')).not.toThrow();
      expect(() => requireScope(token, ['wallets:write', 'transactions:create'])).not.toThrow();
    });

    it('throws ForbiddenError / AuthorizationError with missingScopes when permission is absent', () => {
      const keyWithSecret: ApiKeyWithSecret = {
        ...makeApiKey({ permissions: ['wallets:read'] }),
        key: 'ast_live_TOP_SECRET_PLAINTEXT_KEY_VALUE_DO_NOT_LEAK',
      };

      let caught: unknown;
      try {
        assertScope(keyWithSecret, ['wallets:read', 'wallets:transfer', 'policies:write']);
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(ForbiddenError);
      expect(caught).toBeInstanceOf(AuthorizationError);
      expect(isForbiddenError(caught)).toBe(true);

      const forbidden = caught as ForbiddenError;
      expect(forbidden.status).toBe(403);
      expect(forbidden.code).toBe('INSUFFICIENT_SCOPE');
      expect(forbidden.details).toEqual({
        requiredScopes: ['wallets:read', 'wallets:transfer', 'policies:write'],
        missingScopes: ['wallets:transfer', 'policies:write'],
      });

      const serialized = JSON.stringify({
        message: forbidden.message,
        details: forbidden.details,
        json: forbidden.toJSON(),
      });
      expect(serialized).not.toContain(keyWithSecret.key);
    });

    it('throws AuthenticationError for missing, malformed, expired, or revoked credentials without leaking secrets', () => {
      const secretSig = 'ultra_sensitive_hmac_sig_abcdef123456';
      const expiredJwt = makeJwt(
        { sub: 'agt_leak_test', scopes: ['*'], exp: Math.floor(Date.now() / 1000) - 60 },
        secretSig,
      );
      const rawOpaqueSecret = 'ast_live_999888777666_secret_material';

      // 1. Expired JWT
      let expiredErr: unknown;
      try {
        assertScope(expiredJwt, 'wallets:read');
      } catch (err) {
        expiredErr = err;
      }
      expect(isAuthenticationError(expiredErr)).toBe(true);
      expect((expiredErr as AuthenticationError).code).toBe('TOKEN_EXPIRED');
      expect((expiredErr as AuthenticationError).status).toBe(401);
      expect(JSON.stringify((expiredErr as AuthenticationError).toJSON())).not.toContain(
        expiredJwt,
      );
      expect(JSON.stringify((expiredErr as AuthenticationError).toJSON())).not.toContain(secretSig);

      // 2. Raw opaque API key or malformed token string
      let malformedErr: unknown;
      try {
        requireScope(rawOpaqueSecret, 'wallets:read');
      } catch (err) {
        malformedErr = err;
      }
      expect(isAuthenticationError(malformedErr)).toBe(true);
      expect((malformedErr as AuthenticationError).code).toBe('UNAUTHORIZED');
      expect(JSON.stringify((malformedErr as AuthenticationError).toJSON())).not.toContain(
        rawOpaqueSecret,
      );

      // 3. Revoked API key with secret attached
      const revokedSecretKey: ApiKeyWithSecret = {
        ...makeApiKey({ permissions: ['*'], revokedAt: '2026-06-01T00:00:00.000Z' }),
        key: rawOpaqueSecret,
      };
      let revokedErr: unknown;
      try {
        assertScope(revokedSecretKey, 'wallets:read');
      } catch (err) {
        revokedErr = err;
      }
      expect(isAuthenticationError(revokedErr)).toBe(true);
      expect((revokedErr as AuthenticationError).code).toBe('INVALID_API_KEY');
      expect(JSON.stringify((revokedErr as AuthenticationError).toJSON())).not.toContain(
        rawOpaqueSecret,
      );

      // 4. Unauthenticated session manager
      expect(() => assertScope(new SessionManager(), 'wallets:read')).toThrow(AuthenticationError);
      expect(() => assertScope(null, 'wallets:read')).toThrow(AuthenticationError);
    });
  });
});

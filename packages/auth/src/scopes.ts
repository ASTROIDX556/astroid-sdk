/**
 * Granular permission scope validation and credential inspection helpers for `@astroid/auth`.
 *
 * Supports exact matches, wildcard scopes (`*`), and colon-separated
 * hierarchical permission matching (e.g. `wallets:read`, `wallets:*`) across
 * raw JWT strings, decoded session payloads, {@link SessionManager} instances,
 * and {@link ApiKey} metadata objects. Fails closed on missing, expired,
 * revoked, or malformed credentials without leaking sensitive token material.
 *
 * @packageDocumentation
 */

import { AuthenticationError, ForbiddenError } from '@astroid/errors';
import type { ApiKey, ApiKeyWithSecret } from '@astroid/types';

import { decodeSessionToken, type DecodedSessionToken, type SessionTokenPayload } from './jwt.js';
import { isTokenExpired, SessionManager } from './session.js';

/**
 * Structural shape for inspecting API key permissions and lifecycle metadata.
 *
 * Compatible with {@link ApiKey} and {@link ApiKeyWithSecret} from `@astroid/types`.
 * If a plaintext `key` property is present on the object, it is ignored and never
 * copied into errors or diagnostic metadata.
 */
export interface ApiKeyPermissionSource {
  /** Non-sensitive API key identifier. */
  id?: string;
  /** Non-sensitive key prefix. */
  prefix?: string;
  /** Granted permission scopes on an {@link ApiKey} entity. */
  permissions?: string[] | string;
  /** Optional alternative scope list or space/comma-delimited scope claim. */
  scopes?: string[] | string;
  /** Optional OAuth2-style space/comma-delimited scope string. */
  scope?: string;
  /** Optional ISO-8601 timestamp, Unix timestamp, or `Date` when the key expires. */
  expiresAt?: string | number | Date | null;
  /** Optional ISO-8601 timestamp or `Date` when the key was revoked. */
  revokedAt?: string | Date | null;
}

/**
 * Credential, session, or permission source accepted by {@link hasScope},
 * {@link hasAnyScope}, {@link assertScope}, {@link requireScope}, and
 * {@link extractScopes}.
 *
 * - `string`: Raw JWT access token (or `Bearer <jwt>` header value).
 * - `readonly string[]`: Explicit list of already-resolved scope strings.
 * - {@link SessionManager}: Active SDK session manager instance.
 * - {@link DecodedSessionToken}: Output of {@link decodeSessionToken}.
 * - {@link SessionTokenPayload}: Decoded JWT payload claims.
 * - {@link ApiKey} / {@link ApiKeyWithSecret} / {@link ApiKeyPermissionSource}: API key metadata.
 */
export type ScopeInspectionSource =
  | string
  | readonly string[]
  | SessionManager
  | DecodedSessionToken
  | SessionTokenPayload
  | ApiKey
  | ApiKeyWithSecret
  | ApiKeyPermissionSource
  | null
  | undefined;

/**
 * Options controlling credential lifecycle checks during scope evaluation.
 */
export interface ScopeCheckOptions {
  /**
   * Whether to enforce token and API key expiration (and revocation) checks
   * before evaluating scopes.
   *
   * @defaultValue `true`
   */
  checkExpiration?: boolean;
  /**
   * Pre-expiration clock-skew buffer in seconds forwarded to {@link isTokenExpired}
   * and `expiresAt` comparisons.
   *
   * @defaultValue `0`
   */
  bufferSeconds?: number;
}

type InspectionFailureReason =
  | 'unauthenticated'
  | 'no_api_key'
  | 'malformed_token'
  | 'token_expired'
  | 'api_key_expired'
  | 'api_key_revoked';

type ScopeResolution =
  | { ok: true; scopes: string[] }
  | { ok: false; reason: InspectionFailureReason };

/**
 * Check if a string is a valid scope format.
 * Must be a non-empty string without whitespace or empty segments.
 *
 * @param scope Candidate value to validate.
 * @returns `true` if `scope` is a well-formed permission scope string.
 */
export function isValidScopeString(scope: unknown): scope is string {
  if (typeof scope !== 'string') return false;
  const trimmed = scope.trim();
  if (trimmed === '' || trimmed !== scope) return false;
  if (/\s/.test(scope)) return false;
  const parts = scope.split(':');
  if (parts.some((part) => part.length === 0)) return false;
  for (const part of parts) {
    if (!/^[a-zA-Z0-9_\-*]+$/.test(part)) return false;
  }
  return true;
}

/**
 * Check if a granted scope pattern matches a required scope.
 *
 * @param grantedScope The granted scope pattern (e.g. `wallets:*`, `*`, `wallets:read`).
 * @param requiredScope The required concrete scope (e.g. `wallets:read`).
 * @returns `true` if grantedScope satisfies requiredScope, `false` otherwise.
 */
export function matchScope(grantedScope: string, requiredScope: string): boolean {
  if (!isValidScopeString(grantedScope) || !isValidScopeString(requiredScope)) {
    return false;
  }

  if (grantedScope === '*' || grantedScope === '*:*') {
    return true;
  }

  if (grantedScope === requiredScope) {
    return true;
  }

  const gParts = grantedScope.split(':');
  const rParts = requiredScope.split(':');

  for (let i = 0; i < gParts.length; i += 1) {
    const g = gParts[i]!;

    if (g === '*') {
      // Trailing wildcard matches remainder of required scope
      if (i === gParts.length - 1) {
        return i <= rParts.length;
      }
      // Middle wildcard matches exactly one segment
      if (i >= rParts.length) {
        return false;
      }
      continue;
    }

    if (i >= rParts.length) {
      return false;
    }

    if (g !== rParts[i]) {
      return false;
    }
  }

  return gParts.length === rParts.length;
}

/**
 * Validate if a collection of granted scopes satisfies a required scope.
 * Fails closed (returns `false`) if granted or required permissions are missing or malformed.
 *
 * @param grantedScopes Single scope or list of scopes granted to the session/token.
 * @param requiredScope Scope required to perform an operation.
 */
export function validateScope(
  grantedScopes: string | readonly string[] | undefined | null,
  requiredScope: string,
): boolean {
  if (!grantedScopes || !requiredScope) {
    return false;
  }

  const scopesList: readonly string[] =
    typeof grantedScopes === 'string' ? [grantedScopes] : grantedScopes;
  if (scopesList.length === 0) {
    return false;
  }

  return scopesList.some((granted) => matchScope(granted, requiredScope));
}

/**
 * Validate if a collection of granted scopes satisfies all required scopes.
 * Fails closed (returns `false`) if granted or required permissions are missing or malformed.
 *
 * @param grantedScopes Single scope or list of scopes granted to the session/token.
 * @param requiredScopes Required scope or list of required scopes.
 */
export function validateScopes(
  grantedScopes: string | readonly string[] | undefined | null,
  requiredScopes: string | readonly string[],
): boolean {
  if (!grantedScopes || !requiredScopes) {
    return false;
  }

  const reqList: readonly string[] =
    typeof requiredScopes === 'string' ? [requiredScopes] : requiredScopes;
  if (reqList.length === 0) {
    return false;
  }

  return reqList.every((req) => validateScope(grantedScopes, req));
}

/**
 * Append well-formed scope tokens from a claim field (array or space/comma-delimited string).
 */
function collectClaimScopes(claim: unknown, target: Set<string>): void {
  if (Array.isArray(claim)) {
    for (const entry of claim) {
      if (typeof entry === 'string') {
        const trimmed = entry.trim();
        if (isValidScopeString(trimmed)) {
          target.add(trimmed);
        }
      }
    }
    return;
  }

  if (typeof claim === 'string') {
    for (const part of claim.split(/[,\s]+/)) {
      const trimmed = part.trim();
      if (trimmed && isValidScopeString(trimmed)) {
        target.add(trimmed);
      }
    }
  }
}

/**
 * Parse an API key `expiresAt` value into Unix milliseconds, or `NaN` when invalid.
 */
function parseExpiresAtMs(expiresAt: unknown): number {
  if (expiresAt instanceof Date) {
    return expiresAt.getTime();
  }
  if (typeof expiresAt === 'number') {
    if (!Number.isFinite(expiresAt)) return Number.NaN;
    // Values below 1e11 are Unix epoch seconds; larger values are milliseconds.
    return expiresAt < 1e11 ? expiresAt * 1000 : expiresAt;
  }
  if (typeof expiresAt === 'string') {
    return Date.parse(expiresAt);
  }
  return Number.NaN;
}

/**
 * Strip an optional `Bearer ` authorization header prefix without mutating raw JWTs.
 */
function stripBearerPrefix(raw: string): string {
  const trimmed = raw.trim();
  return trimmed.replace(/^bearer\s+/i, '').trim();
}

/**
 * Inspect a raw JWT string and resolve its scopes while enforcing expiration.
 */
function resolveRawJwtScopes(
  rawToken: string,
  checkExpiration: boolean,
  bufferSeconds: number,
): ScopeResolution {
  const normalized = stripBearerPrefix(rawToken);
  if (!normalized) {
    return { ok: false, reason: 'unauthenticated' };
  }

  let decoded: DecodedSessionToken;
  try {
    decoded = decodeSessionToken(normalized);
  } catch {
    return { ok: false, reason: 'malformed_token' };
  }

  if (checkExpiration && isTokenExpired(normalized, bufferSeconds)) {
    return { ok: false, reason: 'token_expired' };
  }

  const collected = new Set<string>();
  const payloadRecord = decoded.payload as Record<string, unknown>;
  collectClaimScopes(payloadRecord.permissions, collected);
  collectClaimScopes(payloadRecord.scopes, collected);
  collectClaimScopes(payloadRecord.scope, collected);

  return { ok: true, scopes: Array.from(collected) };
}

/**
 * Internal resolver that validates credential lifecycle state and extracts scopes.
 * Never copies raw tokens, signatures, or secret keys into returned structures.
 */
function resolveScopeSource(
  source: ScopeInspectionSource,
  options: ScopeCheckOptions = {},
): ScopeResolution {
  const checkExpiration = options.checkExpiration ?? true;
  const bufferSeconds = options.bufferSeconds ?? 0;

  if (source === null || source === undefined) {
    return { ok: false, reason: 'unauthenticated' };
  }

  if (typeof source === 'string') {
    return resolveRawJwtScopes(source, checkExpiration, bufferSeconds);
  }

  if (Array.isArray(source)) {
    const collected = new Set<string>();
    collectClaimScopes(source, collected);
    return { ok: true, scopes: Array.from(collected) };
  }

  if (source instanceof SessionManager) {
    if (source.mode === 'apiKey') {
      const apiKey = source.getApiKey();
      if (!apiKey) {
        return { ok: false, reason: 'no_api_key' };
      }
      // Opaque API keys carry no embedded claims unless structured as a JWT.
      if (apiKey.trim().split('.').length === 3) {
        const jwtRes = resolveRawJwtScopes(apiKey, checkExpiration, bufferSeconds);
        if (jwtRes.ok || jwtRes.reason === 'token_expired') {
          return jwtRes;
        }
      }
      return { ok: true, scopes: [] };
    }

    const accessToken = source.getAccessToken();
    if (!accessToken) {
      return { ok: false, reason: 'unauthenticated' };
    }
    return resolveRawJwtScopes(accessToken, checkExpiration, bufferSeconds);
  }

  if (typeof source !== 'object') {
    return { ok: false, reason: 'unauthenticated' };
  }

  // Handle DecodedSessionToken returned by decodeSessionToken()
  if (
    'payload' in source &&
    source.payload !== null &&
    typeof source.payload === 'object' &&
    !Array.isArray(source.payload)
  ) {
    const decoded = source as DecodedSessionToken;
    const payloadRecord = decoded.payload as Record<string, unknown>;

    if (checkExpiration) {
      if ('exp' in payloadRecord && payloadRecord.exp !== undefined && payloadRecord.exp !== null) {
        if (typeof payloadRecord.exp !== 'number' || !Number.isFinite(payloadRecord.exp)) {
          return { ok: false, reason: 'token_expired' };
        }
        const nowSeconds = Math.floor(Date.now() / 1000);
        if (nowSeconds + bufferSeconds >= payloadRecord.exp) {
          return { ok: false, reason: 'token_expired' };
        }
      } else if (decoded.isExpired === true) {
        return { ok: false, reason: 'token_expired' };
      }
    }

    const collected = new Set<string>();
    collectClaimScopes(payloadRecord.permissions, collected);
    collectClaimScopes(payloadRecord.scopes, collected);
    collectClaimScopes(payloadRecord.scope, collected);
    return { ok: true, scopes: Array.from(collected) };
  }

  // Handle SessionTokenPayload, ApiKey, ApiKeyWithSecret, or ApiKeyPermissionSource
  const record = source as Record<string, unknown>;

  if (record.revokedAt !== undefined && record.revokedAt !== null && record.revokedAt !== '') {
    return { ok: false, reason: 'api_key_revoked' };
  }

  if (checkExpiration) {
    if ('exp' in record && record.exp !== undefined && record.exp !== null) {
      if (typeof record.exp !== 'number' || !Number.isFinite(record.exp)) {
        return { ok: false, reason: 'token_expired' };
      }
      const nowSeconds = Math.floor(Date.now() / 1000);
      if (nowSeconds + bufferSeconds >= record.exp) {
        return { ok: false, reason: 'token_expired' };
      }
    }

    if (
      'expiresAt' in record &&
      record.expiresAt !== undefined &&
      record.expiresAt !== null &&
      record.expiresAt !== ''
    ) {
      const expiresAtMs = parseExpiresAtMs(record.expiresAt);
      if (Number.isNaN(expiresAtMs) || Date.now() + bufferSeconds * 1000 >= expiresAtMs) {
        return { ok: false, reason: 'api_key_expired' };
      }
    }
  }

  const collected = new Set<string>();
  collectClaimScopes(record.permissions, collected);
  collectClaimScopes(record.scopes, collected);
  collectClaimScopes(record.scope, collected);
  return { ok: true, scopes: Array.from(collected) };
}

/**
 * Convert an internal credential lifecycle failure into a redacted {@link AuthenticationError}.
 */
function buildLifecycleAuthError(reason: InspectionFailureReason): AuthenticationError {
  switch (reason) {
    case 'no_api_key':
      return new AuthenticationError('No API key is configured for this session', {
        code: 'UNAUTHENTICATED',
        status: 401,
      });
    case 'malformed_token':
      return new AuthenticationError('Invalid or malformed authentication token', {
        code: 'UNAUTHORIZED',
        status: 401,
      });
    case 'token_expired':
      return new AuthenticationError('Access token has expired', {
        code: 'TOKEN_EXPIRED',
        status: 401,
      });
    case 'api_key_expired':
      return new AuthenticationError('API key has expired', {
        code: 'TOKEN_EXPIRED',
        status: 401,
      });
    case 'api_key_revoked':
      return new AuthenticationError('API key has been revoked', {
        code: 'INVALID_API_KEY',
        status: 401,
      });
    case 'unauthenticated':
    default:
      return new AuthenticationError('Authentication credentials are required', {
        code: 'UNAUTHENTICATED',
        status: 401,
      });
  }
}

/**
 * Extract normalized permission scopes from a session token, {@link SessionManager},
 * decoded JWT payload, or {@link ApiKey} metadata object.
 *
 * Returns an empty array if the credential is missing, malformed, revoked, or
 * expired (unless `options.checkExpiration` is set to `false`).
 *
 * @param source Raw JWT, session manager, decoded token/payload, API key metadata, or scope array.
 * @param options Optional expiration and clock-skew buffer settings.
 * @returns Deduplicated array of valid granted scope strings.
 *
 * @example
 * ```ts
 * import { extractScopes } from '@astroid/auth';
 *
 * const scopes = extractScopes(accessToken);
 * // ['wallets:read', 'transactions:create']
 * ```
 */
export function extractScopes(
  source: ScopeInspectionSource,
  options?: ScopeCheckOptions,
): string[] {
  const resolution = resolveScopeSource(source, options);
  return resolution.ok ? resolution.scopes : [];
}

/**
 * Check whether an authenticated session token, {@link SessionManager}, decoded
 * payload, or {@link ApiKey} possesses the required permission scope(s).
 *
 * Supports exact matches (`wallets:read`), hierarchical wildcards (`wallets:*`),
 * and global wildcards (`*`). Integrates with {@link isTokenExpired} and API key
 * `expiresAt` / `revokedAt` metadata so expired or revoked credentials always
 * evaluate to `false` by default.
 *
 * Never throws and never logs or exposes sensitive token material.
 *
 * @param source Raw JWT, session manager, decoded token/payload, API key metadata, or scope array.
 * @param requiredScope Single required scope string or list of required scopes (all must match).
 * @param options Optional expiration and clock-skew buffer settings.
 * @returns `true` if the credential is active and grants every required scope, `false` otherwise.
 *
 * @example
 * ```ts
 * import { hasScope } from '@astroid/auth';
 *
 * if (hasScope(sessionManager, 'wallets:transfer')) {
 *   await astroid.transactions.create(input);
 * }
 * ```
 */
export function hasScope(
  source: ScopeInspectionSource,
  requiredScope: string | readonly string[],
  options?: ScopeCheckOptions,
): boolean {
  if (!requiredScope) {
    return false;
  }

  const reqList: readonly string[] =
    typeof requiredScope === 'string' ? [requiredScope] : requiredScope;
  if (reqList.length === 0 || reqList.some((req) => !isValidScopeString(req))) {
    return false;
  }

  const resolution = resolveScopeSource(source, options);
  if (!resolution.ok || resolution.scopes.length === 0) {
    return false;
  }

  return validateScopes(resolution.scopes, reqList);
}

/**
 * Check whether an authenticated session token, {@link SessionManager}, decoded
 * payload, or {@link ApiKey} possesses **at least one** of the specified scopes.
 *
 * Fails closed (`false`) if the credential is missing, malformed, revoked, or expired,
 * or if `requiredScopes` is empty or contains invalid scope strings.
 *
 * @param source Raw JWT, session manager, decoded token/payload, API key metadata, or scope array.
 * @param requiredScopes Candidate scopes where any single match grants access.
 * @param options Optional expiration and clock-skew buffer settings.
 * @returns `true` if the credential is active and grants at least one candidate scope.
 *
 * @example
 * ```ts
 * import { hasAnyScope } from '@astroid/auth';
 *
 * if (hasAnyScope(apiKey, ['wallets:write', 'wallets:admin'])) {
 *   // Proceed with write operation
 * }
 * ```
 */
export function hasAnyScope(
  source: ScopeInspectionSource,
  requiredScopes: readonly string[],
  options?: ScopeCheckOptions,
): boolean {
  if (!Array.isArray(requiredScopes) || requiredScopes.length === 0) {
    return false;
  }
  if (requiredScopes.some((req) => !isValidScopeString(req))) {
    return false;
  }

  const resolution = resolveScopeSource(source, options);
  if (!resolution.ok || resolution.scopes.length === 0) {
    return false;
  }

  return requiredScopes.some((req) => validateScope(resolution.scopes, req));
}

/**
 * Assert that an authenticated session token, {@link SessionManager}, decoded
 * payload, or {@link ApiKey} is active and possesses all required permission scopes.
 *
 * Throws an {@link AuthenticationError} (`status: 401`) if credentials are missing,
 * malformed, expired, or revoked, and throws a {@link ForbiddenError} (`status: 403`,
 * `code: 'INSUFFICIENT_SCOPE'`) when one or more required scopes are missing.
 *
 * Raw tokens, JWT signatures, and plaintext API keys are never included in thrown
 * error messages or structured `details`.
 *
 * @param source Raw JWT, session manager, decoded token/payload, API key metadata, or scope array.
 * @param requiredScope Single required scope string or list of required scopes (all must match).
 * @param options Optional expiration and clock-skew buffer settings.
 * @throws {AuthenticationError} When credentials are missing, malformed, expired, or revoked.
 * @throws {ForbiddenError} When credentials are valid but lack required scope(s).
 *
 * @example
 * ```ts
 * import { assertScope } from '@astroid/auth';
 *
 * assertScope(accessToken, ['wallets:read', 'transactions:create']);
 * ```
 */
export function assertScope(
  source: ScopeInspectionSource,
  requiredScope: string | readonly string[],
  options?: ScopeCheckOptions,
): void {
  const resolution = resolveScopeSource(source, options);
  if (!resolution.ok) {
    throw buildLifecycleAuthError(resolution.reason);
  }

  const reqList: readonly string[] =
    typeof requiredScope === 'string' ? [requiredScope] : requiredScope;

  if (!requiredScope || reqList.length === 0 || reqList.some((req) => !isValidScopeString(req))) {
    throw new ForbiddenError('Invalid or empty required permission scope', {
      code: 'INSUFFICIENT_SCOPE',
      status: 403,
      details: {
        requiredScopes: [],
        missingScopes: [],
      },
    });
  }

  const missingScopes = reqList.filter((req) => !validateScope(resolution.scopes, req));
  if (missingScopes.length > 0) {
    throw new ForbiddenError(
      `Insufficient permissions: missing required scope(s): ${missingScopes.join(', ')}`,
      {
        code: 'INSUFFICIENT_SCOPE',
        status: 403,
        details: {
          requiredScopes: [...reqList],
          missingScopes,
        },
      },
    );
  }
}

/**
 * Alias for {@link assertScope} — verifies that the provided credential is active
 * and possesses all required permission scopes, throwing on failure.
 *
 * @see {@link assertScope}
 */
export const requireScope: typeof assertScope = assertScope;

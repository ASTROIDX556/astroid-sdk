/**
 * `@astroid/auth` — lightweight, dependency-free JWT decoder and role inspection utilities.
 *
 * Provides utilities for decoding session tokens and inspecting agent permissions,
 * organizational roles, and expiration claims without making network roundtrips.
 *
 * @module
 */

import type { JwtPayload } from './session.js';

export type { JwtPayload };

/**
 * Extended JWT claims payload for Astroid agent and user sessions.
 */
export interface SessionTokenPayload extends JwtPayload {
  /** The subject identifier (user ID, agent ID, or key ID). */
  sub?: string;
  /** Organizational identifier. */
  orgId?: string;
  organizationId?: string;
  /** Assigned organizational roles or permissions. */
  roles?: string[] | string;
  role?: string;
  /** Assigned permissions/scopes. */
  scopes?: string[] | string;
  scope?: string;
  /** Expiration timestamp in seconds since Unix epoch. */
  exp?: number;
  /** Issued-at timestamp in seconds since Unix epoch. */
  iat?: number;
  /** Issuer claim. */
  iss?: string;
  /** Audience claim. */
  aud?: string | string[];
}

/**
 * Result returned by {@link decodeSessionToken}.
 */
export interface DecodedSessionToken<T extends SessionTokenPayload = SessionTokenPayload> {
  /** Raw decoded JWT header. */
  header: {
    alg?: string;
    typ?: string;
    [key: string]: unknown;
  };
  /** Strongly typed JWT payload claims. */
  payload: T;
  /** Raw signature segment from the token string. */
  signature: string;
  /** Whether the token has expired based on current local clock. */
  isExpired: boolean;
  /** Remaining lifetime in seconds until expiration (negative if already expired, null if no exp). */
  expiresInSeconds: number | null;
}

/**
 * Safely decodes a Base64 / Base64URL encoded string into UTF-8 without third-party dependencies.
 * Works uniformly across Browser and Node.js environments.
 */
function decodeBase64Url(str: string): string {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4 !== 0) {
    base64 += '=';
  }
  if (typeof atob === 'function') {
    return atob(base64);
  }
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(base64, 'base64').toString('utf-8');
  }
  throw new Error('No base64 decoding environment available');
}

/**
 * Decodes and inspects a JSON Web Token (JWT) session token without verifying cryptographic signature.
 *
 * Safely extracts header, payload, expiration timestamps, and roles without unsafe `any` casts.
 * Throws a descriptive error if the token is structurally invalid or malformed.
 *
 * @param token The raw JWT string (e.g. `header.payload.signature`).
 * @returns Strongly typed {@link DecodedSessionToken} with parsed payload and expiration metadata.
 * @throws {Error} If token format is invalid, empty, or cannot be parsed as JSON.
 *
 * @example
 * ```ts
 * import { decodeSessionToken } from '@astroid/auth';
 *
 * const session = decodeSessionToken(token);
 * console.log(session.payload.sub);
 * console.log(session.isExpired);
 * ```
 */
export function decodeSessionToken<T extends SessionTokenPayload = SessionTokenPayload>(
  token: string,
): DecodedSessionToken<T> {
  if (!token || typeof token !== 'string') {
    throw new Error('Invalid token: JWT token must be a non-empty string');
  }

  const parts = token.trim().split('.');
  if (parts.length !== 3) {
    throw new Error(`Invalid token: JWT must contain exactly 3 segments separated by dots, received ${parts.length}`);
  }

  const [rawHeader, rawPayload, signature] = parts as [string, string, string];

  let header: DecodedSessionToken<T>['header'];
  let payload: T;

  try {
    const decodedHeader = decodeBase64Url(rawHeader);
    header = JSON.parse(decodedHeader) as DecodedSessionToken<T>['header'];
  } catch (err) {
    throw new Error(`Failed to decode JWT header: ${(err as Error).message}`);
  }

  try {
    const decodedPayload = decodeBase64Url(rawPayload);
    payload = JSON.parse(decodedPayload) as T;
  } catch (err) {
    throw new Error(`Failed to decode JWT payload: ${(err as Error).message}`);
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const exp = typeof payload.exp === 'number' && Number.isFinite(payload.exp) ? payload.exp : null;
  const isExpired = exp !== null ? nowSeconds >= exp : false;
  const expiresInSeconds = exp !== null ? exp - nowSeconds : null;

  return {
    header,
    payload,
    signature,
    isExpired,
    expiresInSeconds,
  };
}

/**
 * Verifies whether a token or decoded payload possesses a specific role or permission.
 *
 * Normalizes role formats (`roles` array, single `role` string, space/comma-separated strings)
 * and safely inspects assignment without network roundtrips.
 *
 * @param tokenOrPayload The raw JWT string or decoded {@link SessionTokenPayload}.
 * @param role The role name to verify (e.g. `'admin'`, `'operator'`, `'agent'`).
 * @returns `true` if the required role is present and active, `false` otherwise.
 *
 * @example
 * ```ts
 * import { hasRole } from '@astroid/auth';
 *
 * if (hasRole(token, 'finance_agent')) {
 *   // Proceed with authorized agent operation
 * }
 * ```
 */
export function hasRole(
  tokenOrPayload: string | SessionTokenPayload | DecodedSessionToken | null | undefined,
  role: string,
): boolean {
  if (!tokenOrPayload || !role || typeof role !== 'string') {
    return false;
  }

  const targetRole = role.trim().toLowerCase();
  if (!targetRole) {
    return false;
  }

  let payload: SessionTokenPayload;

  if (typeof tokenOrPayload === 'string') {
    try {
      const decoded = decodeSessionToken(tokenOrPayload);
      payload = decoded.payload;
    } catch {
      return false;
    }
  } else if ('payload' in tokenOrPayload && tokenOrPayload.payload !== null && typeof tokenOrPayload.payload === 'object') {
    payload = tokenOrPayload.payload as SessionTokenPayload;
  } else {
    payload = tokenOrPayload as SessionTokenPayload;
  }

  const extractedRoles: string[] = [];

  // Check roles array
  if (Array.isArray(payload.roles)) {
    for (const r of payload.roles) {
      if (typeof r === 'string') extractedRoles.push(r.trim().toLowerCase());
    }
  } else if (typeof payload.roles === 'string') {
    extractedRoles.push(...payload.roles.split(/[,\s]+/).map((r) => r.trim().toLowerCase()).filter(Boolean));
  }

  // Check single role field
  if (typeof payload.role === 'string') {
    extractedRoles.push(...payload.role.split(/[,\s]+/).map((r) => r.trim().toLowerCase()).filter(Boolean));
  }

  return extractedRoles.includes(targetRole);
}

/**
 * Granular permission scope validation helpers for `@astroid/auth`.
 *
 * Supports exact matches, wildcard scopes (`*`), and colon-separated
 * hierarchical permission matching (e.g. `wallets:read`, `wallets:*`).
 * Fails closed on missing, empty, or malformed permissions.
 *
 * @packageDocumentation
 */

/**
 * Check if a string is a valid scope format.
 * Must be a non-empty string without whitespace or empty segments.
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
  grantedScopes: string | string[] | undefined | null,
  requiredScope: string,
): boolean {
  if (!grantedScopes || !requiredScope) {
    return false;
  }

  const scopesList = Array.isArray(grantedScopes) ? grantedScopes : [grantedScopes];
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
  grantedScopes: string | string[] | undefined | null,
  requiredScopes: string | string[],
): boolean {
  if (!grantedScopes || !requiredScopes) {
    return false;
  }

  const reqList = Array.isArray(requiredScopes) ? requiredScopes : [requiredScopes];
  if (reqList.length === 0) {
    return false;
  }

  return reqList.every((req) => validateScope(grantedScopes, req));
}

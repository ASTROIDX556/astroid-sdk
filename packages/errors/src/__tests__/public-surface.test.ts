/**
 * Public-surface guards for `@astroid/errors`.
 *
 * `src/AstroidError.ts` is a compatibility re-export module kept in sync by hand
 * with the package entrypoint. `AstroidTimeoutError` was added to `index.ts` and
 * `classes.ts` without being added here, so `import { AstroidTimeoutError } from
 * './AstroidError.js'` resolved to `undefined` for consumers relying on the
 * module layout documented in issue #279. These tests pin both that module and
 * the README against the real entrypoint so the surface cannot silently drift.
 */

import { describe, it, expect } from 'vitest';
import * as entry from '../index.js';
import * as compat from '../AstroidError.js';

/**
 * Every error class the compatibility module is documented to expose. These must
 * stay identical objects to the entrypoint's exports — a re-export of a
 * different binding would break `instanceof` for anyone importing the
 * compatibility path.
 */
const COMPAT_CLASS_EXPORTS = [
  'AstroidError',
  'AuthenticationError',
  'AuthorizationError',
  'ForbiddenError',
  'ValidationError',
  'NotFoundError',
  'ConflictError',
  'PolicyViolationError',
  'InsufficientFundsError',
  'BudgetExceededError',
  'ApprovalRequiredError',
  'RateLimitError',
  'ApiRateLimitError',
  'NetworkError',
  'AstroidTimeoutError',
  'InternalServerError',
  'ServerError',
] as const;

/** Runtime functions documented in the README's "Mapping helpers" section. */
const DOCUMENTED_HELPERS = [
  'toAstroidError',
  'fromErrorResponse',
  'mapStatusToError',
  'errorClassForStatus',
  'statusCodeToCode',
  'extractApiError',
  'errorClassForCode',
  'fromApiError',
  'fromStatus',
  'codeForStatus',
  'toNetworkError',
] as const;

/** Guards documented in the README's "Guards" section. */
const DOCUMENTED_GUARDS = [
  'isAstroidError',
  'isAuthenticationError',
  'isForbiddenError',
  'isValidationError',
  'isNotFoundError',
  'isConflictError',
  'isPolicyViolationError',
  'isInsufficientFundsError',
  'isRateLimitError',
  'isApiRateLimitError',
  'isNetworkError',
  'isTimeoutError',
  'isServerError',
] as const;

/** Stellar mapping surface documented in the README's "Stellar mapping" section. */
const DOCUMENTED_STELLAR = [
  'mapStellarError',
  'errorClassForStellarCode',
  'stellarCodeToApiError',
  'extractStellarResultCodes',
  'isStellarError',
] as const;

describe('AstroidError.ts compatibility re-exports', () => {
  it.each(COMPAT_CLASS_EXPORTS)('re-exports %s as the same class object', (name) => {
    const fromCompat = (compat as Record<string, unknown>)[name];
    const fromEntry = (entry as Record<string, unknown>)[name];

    expect(fromCompat, `${name} missing from AstroidError.ts`).toBeDefined();
    expect(fromCompat).toBe(fromEntry);
  });

  it('keeps instanceof working across the compatibility import path', () => {
    const err = new compat.AstroidTimeoutError(500, {
      code: 'REQUEST_TIMEOUT',
      status: 504,
    });

    expect(err).toBeInstanceOf(compat.AstroidTimeoutError);
    expect(err).toBeInstanceOf(entry.AstroidTimeoutError);
    expect(err).toBeInstanceOf(compat.NetworkError);
    expect(err).toBeInstanceOf(entry.AstroidError);
    expect(err.timeoutMs).toBe(500);
    expect(err.isRetryable).toBe(true);
  });

  it('exposes the base helpers the module documents', () => {
    expect(typeof compat.setIncludeStackInErrors).toBe('function');
    expect(typeof compat.getIncludeStackInErrors).toBe('function');
  });
});

describe('documented public surface exists', () => {
  it.each(DOCUMENTED_HELPERS)('exports helper %s as a function', (name) => {
    expect(typeof (entry as Record<string, unknown>)[name]).toBe('function');
  });

  it.each(DOCUMENTED_GUARDS)('exports guard %s as a function', (name) => {
    expect(typeof (entry as Record<string, unknown>)[name]).toBe('function');
  });

  it.each(DOCUMENTED_STELLAR)('exports Stellar helper %s as a function', (name) => {
    expect(typeof (entry as Record<string, unknown>)[name]).toBe('function');
  });

  it('exposes every Stellar error class documented in the README', () => {
    const stellarClasses = [
      'InsufficientBalanceError',
      'TrustlineMissingError',
      'StellarAuthError',
      'SequenceConflictError',
      'TransactionExpiredError',
      'StellarMalformedError',
      'StellarNetworkError',
    ] as const;

    for (const name of stellarClasses) {
      expect((entry as Record<string, unknown>)[name], `${name} missing`).toBeDefined();
    }
  });

  it('exposes the documented aliases', () => {
    expect(entry.AstroidApiError).toBe(entry.AstroidError);
    expect(entry.AstroidValidationError).toBe(entry.ValidationError);
    expect(entry.AstroidNetworkError).toBe(entry.NetworkError);
    expect(entry.AstroidInsufficientFundsError).toBe(entry.InsufficientFundsError);
    expect(entry.AstroidPolicyViolationError).toBe(entry.PolicyViolationError);
  });
});

/**
 * Unit tests for the issue #76 additions to `@astroid/errors`:
 * - `ApiRateLimitError` (issue-named rate-limit class, extending `RateLimitError`)
 * - Envelope-shaped, production-safe serialization (`toJSON`, `retryable`,
 *   `setIncludeStackInErrors`)
 * - Completed `ApiErrorCode` → error-class mapping (`PROPOSAL_EXPIRED`,
 *   `INVALID_SIGNATURE`)
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  AstroidError,
  ConflictError,
  ValidationError,
  RateLimitError,
  ApiRateLimitError,
  errorClassForCode,
  fromApiError,
  fromStatus,
  setIncludeStackInErrors,
  getIncludeStackInErrors,
  isApiRateLimitError,
  isRateLimitError,
} from '../index.js';
import { mapStatusToError } from '../index.js';

/* -------------------------------------------------------------------------- */
/* ApiRateLimitError — issue-named rate-limit class                            */
/* -------------------------------------------------------------------------- */

describe('ApiRateLimitError (issue #76)', () => {
  it('is an instance of RateLimitError and AstroidError', () => {
    const err = new ApiRateLimitError('slow down', { code: 'RATE_LIMITED', status: 429 });
    expect(err).toBeInstanceOf(ApiRateLimitError);
    expect(err).toBeInstanceOf(RateLimitError);
    expect(err).toBeInstanceOf(AstroidError);
    expect(err).toBeInstanceOf(Error);
  });

  it('is NOT an instance of sibling classes', () => {
    const err = new ApiRateLimitError('slow down', { code: 'RATE_LIMITED' });
    expect(err).not.toBeInstanceOf(ValidationError);
    expect(err).not.toBeInstanceOf(ConflictError);
  });

  it('carries the retryAfter accessor and isRetryable behaviour', () => {
    const err = new ApiRateLimitError('slow down', {
      code: 'RATE_LIMITED',
      status: 429,
      details: { retryAfter: 45 },
    });
    expect(err.retryAfter).toBe(45);
    expect(err.isRetryable).toBe(true);
    expect(err.retryable).toBe(true);
    expect(err.name).toBe('ApiRateLimitError');
  });

  it('matches RateLimitError in mapping output — instanceof RateLimitError holds', () => {
    const err = fromStatus(429, 'Too many requests');
    expect(err).toBeInstanceOf(RateLimitError);
    expect(isRateLimitError(err)).toBe(true);
    // The canonical mapping intentionally still yields the base RateLimitError;
    // ApiRateLimitError is a consumer-facing subclass alias, not the mapped class.
    expect(err).not.toBeInstanceOf(ApiRateLimitError);
  });

  it('is matched by isRateLimitError but not by isApiRateLimitError for the base class', () => {
    const base = new RateLimitError('slow', { code: 'RATE_LIMITED' });
    const alias = new ApiRateLimitError('slow', { code: 'RATE_LIMITED' });
    expect(isRateLimitError(base)).toBe(true);
    expect(isRateLimitError(alias)).toBe(true);
    expect(isApiRateLimitError(base)).toBe(false);
    expect(isApiRateLimitError(alias)).toBe(true);
  });

  it('serializes with the same envelope shape as other AstroidErrors', () => {
    const err = new ApiRateLimitError('slow', { code: 'RATE_LIMITED', status: 429 });
    const json = err.toJSON();
    expect(json).toMatchObject({ name: 'ApiRateLimitError', code: 'RATE_LIMITED', status: 429 });
  });
});

/* -------------------------------------------------------------------------- */
/* Serialization — envelope shape and production stack safety (issue #76)      */
/* -------------------------------------------------------------------------- */

describe('error serialization (issue #76)', () => {
  afterEach(() => {
    // Restore the default so other suites observe stock behaviour.
    setIncludeStackInErrors(true);
  });

  it('serializes to the API error payload structure', () => {
    const err = fromApiError(
      { code: 'POLICY_VIOLATION', message: 'Exceeds daily limit', details: { policyId: 'pol_1' } },
      { status: 422, requestId: 'req_77' },
    );
    const json = err.toJSON();

    expect(json).toEqual({
      name: 'PolicyViolationError',
      message: 'Exceeds daily limit',
      code: 'POLICY_VIOLATION',
      status: 422,
      statusCode: 422,
      requestId: 'req_77',
      details: { policyId: 'pol_1' },
      stack: expect.any(String),
    });
  });

  it('omits undefined diagnostic fields instead of serializing nulls', () => {
    const err = new ValidationError('bad', { code: 'VALIDATION_ERROR' });
    const json = err.toJSON();
    expect(json.status).toBeUndefined();
    expect(json.statusCode).toBeUndefined();
    expect(json.requestId).toBeUndefined();
    expect(json.details).toBeUndefined();
    // Undefined values must also disappear from the wire format.
    const wire = JSON.parse(JSON.stringify(json)) as Record<string, unknown>;
    expect(wire).not.toHaveProperty('status');
    expect(wire).not.toHaveProperty('statusCode');
    expect(wire).not.toHaveProperty('requestId');
    expect(wire).not.toHaveProperty('details');
    expect(wire).not.toHaveProperty('null');
    expect(JSON.stringify(json)).not.toContain('null');
  });

  it('serializes retryable both via isRetryable and the envelope-style alias', () => {
    const err = fromStatus(429, 'Too many requests');
    expect(err.isRetryable).toBe(true);
    expect(err.retryable).toBe(true);

    const notRetryable = fromStatus(404, 'gone');
    expect(notRetryable.isRetryable).toBe(false);
    expect(notRetryable.retryable).toBe(false);
  });

  it('includes the stack by default for local diagnostics', () => {
    expect(getIncludeStackInErrors()).toBe(true);
    const err = new ValidationError('bad', { code: 'VALIDATION_ERROR' });
    expect(err.toJSON().stack).toEqual(expect.any(String));
  });

  it('omits the stack when production mode is configured', () => {
    setIncludeStackInErrors(false);
    const err = new ValidationError('bad', { code: 'VALIDATION_ERROR' });
    const json = err.toJSON();
    expect(json.stack).toBeUndefined();
    expect('stack' in json).toBe(false);
  });

  it('keeps the live stack property intact when serialization is disabled', () => {
    setIncludeStackInErrors(false);
    const err = new ValidationError('bad', { code: 'VALIDATION_ERROR' });
    expect(err.stack).toEqual(expect.any(String)); // debuggability preserved
    expect(err.toJSON().stack).toBeUndefined(); // wire payload clean
  });

  it('never leaks secrets in the serialized payload', () => {
    setIncludeStackInErrors(false);
    const err = fromApiError(
      { code: 'INSUFFICIENT_FUNDS', message: 'Not enough funds' },
      { status: 402, requestId: 'req_x' },
    );
    const serialized = JSON.stringify(err.toJSON());
    expect(serialized).not.toContain('apiKey');
    expect(serialized).not.toContain('secret');
    expect(serialized).not.toContain('token');
  });
});

/* -------------------------------------------------------------------------- */
/* Completed ApiErrorCode mapping (issue #76)                                  */
/* -------------------------------------------------------------------------- */

describe('completed ApiErrorCode mapping (issue #76)', () => {
  it('maps PROPOSAL_EXPIRED to ConflictError', () => {
    expect(errorClassForCode('PROPOSAL_EXPIRED')).toBe(ConflictError);
    const err = fromApiError(
      { code: 'PROPOSAL_EXPIRED', message: 'Proposal expired' },
      { status: 409 },
    );
    expect(err).toBeInstanceOf(ConflictError);
    expect(err).toBeInstanceOf(AstroidError);
  });

  it('maps INVALID_SIGNATURE to ValidationError', () => {
    expect(errorClassForCode('INVALID_SIGNATURE')).toBe(ValidationError);
    const err = fromApiError(
      { code: 'INVALID_SIGNATURE', message: 'Signature mismatch' },
      { status: 422 },
    );
    expect(err).toBeInstanceOf(ValidationError);
  });

  it('maps PROPOSAL_EXPIRED envelopes via mapStatusToError with the body code winning', () => {
    const err = mapStatusToError(410, 'expired', {
      body: { error: { code: 'PROPOSAL_EXPIRED', message: 'expired' } },
    });
    expect(err).toBeInstanceOf(ConflictError);
    expect(err.code).toBe('PROPOSAL_EXPIRED');
  });
});

/* -------------------------------------------------------------------------- */
/* Issue-mandated hygiene                                                      */
/* -------------------------------------------------------------------------- */

describe('informative messages without internal leakage (issue #76)', () => {
  it('keeps error messages informative and self-contained', () => {
    const err = mapStatusToError(404, 'Wallet wal_123 not found');
    expect(err.message).toBe('Wallet wal_123 not found');
    expect(err.message).not.toMatch(/at .+:\d+:\d+/); // no stack frames in the message
  });
});

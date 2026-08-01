import { describe, it, expect } from 'vitest';
import {
  AstroidError,
  AuthenticationError,
  BudgetExceededError,
  NetworkError,
  NotFoundError,
  PolicyViolationError,
  RateLimitError,
  ValidationError,
  errorClassForCode,
  codeForStatus,
  fromApiError,
  fromStatus,
  isAstroidError,
} from './index.js';

describe('@astroid/errors', () => {
  it('maps API error codes to the correct error classes', () => {
    expect(errorClassForCode('POLICY_VIOLATION')).toBe(PolicyViolationError);
    expect(errorClassForCode('BUDGET_EXCEEDED')).toBe(BudgetExceededError);
    expect(errorClassForCode('AUTHENTICATION_ERROR')).toBe(AuthenticationError);
    expect(errorClassForCode('RATE_LIMITED')).toBe(RateLimitError);
    expect(errorClassForCode('NOT_FOUND')).toBe(NotFoundError);
    expect(errorClassForCode('VALIDATION_ERROR')).toBe(ValidationError);
    expect(errorClassForCode('SOMETHING_UNKNOWN')).toBe(AstroidError);
  });

  it('infers codes from HTTP status', () => {
    expect(codeForStatus(401)).toBe('AUTHENTICATION_ERROR');
    expect(codeForStatus(404)).toBe('NOT_FOUND');
    expect(codeForStatus(429)).toBe('RATE_LIMITED');
    expect(codeForStatus(503)).toBe('INTERNAL_ERROR');
  });

  it('builds a typed error from an API error envelope', () => {
    const err = fromApiError(
      { code: 'POLICY_VIOLATION', message: 'Transaction exceeds policy limits.' },
      { status: 422, requestId: 'req_abc', details: { policyId: 'pol_1' } },
    );
    expect(err).toBeInstanceOf(PolicyViolationError);
    expect(err).toBeInstanceOf(AstroidError);
    expect(err.code).toBe('POLICY_VIOLATION');
    expect(err.status).toBe(422);
    expect(err.requestId).toBe('req_abc');
    expect(err.details).toEqual({ policyId: 'pol_1' });
  });

  it('builds a typed error from a bare HTTP status', () => {
    const err = fromStatus(404, 'Not found', { requestId: 'req_x' });
    expect(err).toBeInstanceOf(NotFoundError);
    expect(err.code).toBe('NOT_FOUND');
  });

  it('marks retryable errors correctly', () => {
    expect(new RateLimitError('slow down', { code: 'RATE_LIMITED' }).isRetryable).toBe(true);
    expect(new NetworkError('offline', { code: 'NETWORK_ERROR' }).isRetryable).toBe(true);
    expect(new NotFoundError('nope', { code: 'NOT_FOUND' }).isRetryable).toBe(false);
  });

  it('exposes retryAfter on RateLimitError', () => {
    const err = new RateLimitError('slow down', {
      code: 'RATE_LIMITED',
      details: { retryAfter: 30 },
    });
    expect(err.retryAfter).toBe(30);
  });

  it('exposes fieldErrors on ValidationError', () => {
    const err = new ValidationError('invalid', {
      code: 'VALIDATION_ERROR',
      details: { fields: { email: ['must be a valid email'] } },
    });
    expect(err.fieldErrors).toEqual({ email: ['must be a valid email'] });
  });

  it('is recognisable via the type guard and serialises without secrets', () => {
    const err = fromApiError({ code: 'NOT_FOUND', message: 'gone' }, { status: 404 });
    expect(isAstroidError(err)).toBe(true);
    expect(isAstroidError(new Error('plain'))).toBe(false);
    const json = err.toJSON();
    expect(json).toMatchObject({ name: 'NotFoundError', code: 'NOT_FOUND', status: 404 });
    expect(JSON.stringify(json)).not.toContain('apiKey');
  });
});

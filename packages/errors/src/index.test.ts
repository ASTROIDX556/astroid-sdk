import { describe, it, expect } from 'vitest';
import {
  AstroidError,
  AuthenticationError,
  InsufficientFundsError,
  AuthorizationError,
  BudgetExceededError,
  ConflictError,
  NetworkError,
  NotFoundError,
  PolicyViolationError,
  RateLimitError,
  ServerError,
  ValidationError,
  errorClassForCode,
  codeForStatus,
  fromApiError,
  fromStatus,
  isAstroidError,
} from './index.js';

describe('@astroid/errors', () => {
  /* ------------------------------------------------------------------------ */
  /* errorClassForCode                                                         */
  /* ------------------------------------------------------------------------ */

  it('maps API error codes to the correct error classes', () => {
    expect(errorClassForCode('POLICY_VIOLATION')).toBe(PolicyViolationError);
    expect(errorClassForCode('BUDGET_EXCEEDED')).toBe(BudgetExceededError);
    expect(errorClassForCode('AUTHENTICATION_ERROR')).toBe(AuthenticationError);
    expect(errorClassForCode('RATE_LIMITED')).toBe(RateLimitError);
    expect(errorClassForCode('NOT_FOUND')).toBe(NotFoundError);
    expect(errorClassForCode('VALIDATION_ERROR')).toBe(ValidationError);
    expect(errorClassForCode('SOMETHING_UNKNOWN')).toBe(AstroidError);
  });

  it('maps auth codes to AuthenticationError', () => {
    expect(errorClassForCode('UNAUTHORIZED')).toBe(AuthenticationError);
    expect(errorClassForCode('INVALID_API_KEY')).toBe(AuthenticationError);
    expect(errorClassForCode('TOKEN_EXPIRED')).toBe(AuthenticationError);
  });

  it('maps FORBIDDEN to AuthorizationError', () => {
    expect(errorClassForCode('FORBIDDEN')).toBe(AuthorizationError);
  });

  it('maps BAD_REQUEST to ValidationError', () => {
    expect(errorClassForCode('BAD_REQUEST')).toBe(ValidationError);
  });

  it('maps CONFLICT to ConflictError', () => {
    expect(errorClassForCode('CONFLICT')).toBe(ConflictError);
  });

  it('maps RISK_THRESHOLD_EXCEEDED to PolicyViolationError', () => {
    expect(errorClassForCode('RISK_THRESHOLD_EXCEEDED')).toBe(PolicyViolationError);
  });

  it('maps WALLET_FROZEN to InsufficientFundsError', () => {
    expect(errorClassForCode('WALLET_FROZEN')).toBe(InsufficientFundsError);
  });

  it('maps NETWORK_ERROR and TIMEOUT to NetworkError', () => {
    expect(errorClassForCode('NETWORK_ERROR')).toBe(NetworkError);
    expect(errorClassForCode('TIMEOUT')).toBe(NetworkError);
  });

  it('maps INTERNAL_ERROR and SERVICE_UNAVAILABLE to ServerError', () => {
    expect(errorClassForCode('INTERNAL_ERROR')).toBe(ServerError);
    expect(errorClassForCode('SERVICE_UNAVAILABLE')).toBe(ServerError);
  });

  it('maps Horizon leak-through codes to InsufficientFundsError', () => {
    const InsufficientFundsErrorCtor = errorClassForCode('op_underfunded');
    const instance = new InsufficientFundsErrorCtor('underfunded', {
      code: 'op_underfunded',
    });
    expect(instance.code).toBe('op_underfunded');
  });

  /* ------------------------------------------------------------------------ */
  /* codeForStatus                                                             */
  /* ------------------------------------------------------------------------ */

  it('infers codes from HTTP status', () => {
    expect(codeForStatus(401)).toBe('AUTHENTICATION_ERROR');
    expect(codeForStatus(404)).toBe('NOT_FOUND');
    expect(codeForStatus(429)).toBe('RATE_LIMITED');
    expect(codeForStatus(503)).toBe('INTERNAL_ERROR');
  });

  it('maps 403 to FORBIDDEN', () => {
    expect(codeForStatus(403)).toBe('FORBIDDEN');
  });

  it('maps 409 to CONFLICT', () => {
    expect(codeForStatus(409)).toBe('CONFLICT');
  });

  it('maps 422 to VALIDATION_ERROR', () => {
    expect(codeForStatus(422)).toBe('VALIDATION_ERROR');
  });

  it('maps 400 to VALIDATION_ERROR', () => {
    expect(codeForStatus(400)).toBe('VALIDATION_ERROR');
  });

  it('maps 500 to INTERNAL_ERROR', () => {
    expect(codeForStatus(500)).toBe('INTERNAL_ERROR');
  });

  it('maps unknown client errors to BAD_REQUEST', () => {
    expect(codeForStatus(418)).toBe('BAD_REQUEST');
    expect(codeForStatus(451)).toBe('BAD_REQUEST');
  });

  /* ------------------------------------------------------------------------ */
  /* fromStatus — HTTP status → error class instance                            */
  /* ------------------------------------------------------------------------ */

  describe('fromStatus maps HTTP status codes to correct error classes', () => {
    it('400 → ValidationError', () => {
      const err = fromStatus(400, 'Bad request');
      expect(err).toBeInstanceOf(ValidationError);
      expect(err.status).toBe(400);
      expect(err.code).toBe('VALIDATION_ERROR');
    });

    it('401 → AuthenticationError', () => {
      const err = fromStatus(401, 'Unauthorized');
      expect(err).toBeInstanceOf(AuthenticationError);
      expect(err.status).toBe(401);
      expect(err.code).toBe('AUTHENTICATION_ERROR');
    });

    it('403 → AuthorizationError', () => {
      const err = fromStatus(403, 'Forbidden');
      expect(err).toBeInstanceOf(AuthorizationError);
      expect(err.status).toBe(403);
      expect(err.code).toBe('FORBIDDEN');
    });

    it('404 → NotFoundError', () => {
      const err = fromStatus(404, 'Not found', { requestId: 'req_x' });
      expect(err).toBeInstanceOf(NotFoundError);
      expect(err.status).toBe(404);
      expect(err.code).toBe('NOT_FOUND');
      expect(err.requestId).toBe('req_x');
    });

    it('409 → ConflictError', () => {
      const err = fromStatus(409, 'Conflict');
      expect(err).toBeInstanceOf(ConflictError);
      expect(err.status).toBe(409);
      expect(err.code).toBe('CONFLICT');
    });

    it('422 → ValidationError', () => {
      const err = fromStatus(422, 'Validation failed');
      expect(err).toBeInstanceOf(ValidationError);
      expect(err.status).toBe(422);
      expect(err.code).toBe('VALIDATION_ERROR');
    });

    it('429 → RateLimitError', () => {
      const err = fromStatus(429, 'Too many requests');
      expect(err).toBeInstanceOf(RateLimitError);
      expect(err.status).toBe(429);
      expect(err.code).toBe('RATE_LIMITED');
    });

    it('500 → ServerError', () => {
      const err = fromStatus(500, 'Internal error');
      expect(err).toBeInstanceOf(ServerError);
      expect(err.status).toBe(500);
      expect(err.code).toBe('INTERNAL_ERROR');
    });

    it('503 → ServerError', () => {
      const err = fromStatus(503, 'Service unavailable');
      expect(err).toBeInstanceOf(ServerError);
      expect(err.status).toBe(503);
      expect(err.code).toBe('INTERNAL_ERROR');
    });

    it('preserves requestId and details from context', () => {
      const err = fromStatus(422, 'Invalid', {
        requestId: 'req_ctx',
        details: { field: 'amount' },
      });
      expect(err).toBeInstanceOf(ValidationError);
      expect(err.requestId).toBe('req_ctx');
      expect(err.details).toEqual({ field: 'amount' });
    });

    it('preserves cause for stack trace', () => {
      const cause = new Error('original');
      const err = fromStatus(500, 'Server error', { cause });
      expect(err.cause).toBe(cause);
    });
  });

  /* ------------------------------------------------------------------------ */
  /* fromApiError                                                              */
  /* ------------------------------------------------------------------------ */

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

  /* ------------------------------------------------------------------------ */
  /* isRetryable                                                               */
  /* ------------------------------------------------------------------------ */

  it('marks retryable errors correctly', () => {
    expect(new RateLimitError('slow down', { code: 'RATE_LIMITED' }).isRetryable).toBe(true);
    expect(new NetworkError('offline', { code: 'NETWORK_ERROR' }).isRetryable).toBe(true);
    expect(new ServerError('oops', { code: 'INTERNAL_ERROR' }).isRetryable).toBe(true);
    expect(new NotFoundError('nope', { code: 'NOT_FOUND' }).isRetryable).toBe(false);
    expect(new ValidationError('bad', { code: 'VALIDATION_ERROR' }).isRetryable).toBe(false);
  });

  /* ------------------------------------------------------------------------ */
  /* Convenience accessors                                                     */
  /* ------------------------------------------------------------------------ */

  it('exposes retryAfter on RateLimitError', () => {
    const err = new RateLimitError('slow down', {
      code: 'RATE_LIMITED',
      details: { retryAfter: 30 },
    });
    expect(err.retryAfter).toBe(30);
  });

  it('returns undefined for retryAfter when not set', () => {
    const err = new RateLimitError('slow down', { code: 'RATE_LIMITED' });
    expect(err.retryAfter).toBeUndefined();
  });

  it('exposes fieldErrors on ValidationError', () => {
    const err = new ValidationError('invalid', {
      code: 'VALIDATION_ERROR',
      details: { fields: { email: ['must be a valid email'] } },
    });
    expect(err.fieldErrors).toEqual({ email: ['must be a valid email'] });
  });

  it('returns undefined for fieldErrors when not set', () => {
    const err = new ValidationError('bad', { code: 'VALIDATION_ERROR' });
    expect(err.fieldErrors).toBeUndefined();
  });

  /* ------------------------------------------------------------------------ */
  /* Type guard and serialisation                                              */
  /* ------------------------------------------------------------------------ */

  it('is recognisable via the type guard and serialises without secrets', () => {
    const err = fromApiError({ code: 'NOT_FOUND', message: 'gone' }, { status: 404 });
    expect(isAstroidError(err)).toBe(true);
    expect(isAstroidError(new Error('plain'))).toBe(false);
    const json = err.toJSON();
    expect(json).toMatchObject({ name: 'NotFoundError', code: 'NOT_FOUND', status: 404 });
    expect(JSON.stringify(json)).not.toContain('apiKey');
  });

  /* ------------------------------------------------------------------------ */
  /* Stack trace preservation                                                  */
  /* ------------------------------------------------------------------------ */

  it('preserves cause for stack trace via Error constructor', () => {
    const cause = new Error('original failure');
    const err = new ValidationError('wrapped', {
      code: 'VALIDATION_ERROR',
      cause,
    });
    expect(err.cause).toBe(cause);
    expect(err.stack).toBeDefined();
  });

  it('sets name to the subclass name', () => {
    expect(new AuthenticationError('auth', { code: 'AUTHENTICATION_ERROR' }).name).toBe(
      'AuthenticationError',
    );
    expect(new RateLimitError('rate', { code: 'RATE_LIMITED' }).name).toBe('RateLimitError');
    expect(new PolicyViolationError('policy', { code: 'POLICY_VIOLATION' }).name).toBe(
      'PolicyViolationError',
    );
    expect(new NotFoundError('nf', { code: 'NOT_FOUND' }).name).toBe('NotFoundError');
    expect(new ValidationError('val', { code: 'VALIDATION_ERROR' }).name).toBe('ValidationError');
    expect(new ServerError('srv', { code: 'INTERNAL_ERROR' }).name).toBe('ServerError');
  });
});

import { describe, it, expect } from 'vitest';
import {
  AstroidSDKError,
  AstroidValidationError,
  AstroidHorizonError,
  AstroidPolicyViolationError,
  AstroidServerInternalError,
  parseAstroidError,
} from './errors.js';

describe('@astroid/client errors and parser', () => {
  it('parses HTTP 400 validation error correctly with field errors', () => {
    const payload = {
      code: 'VALIDATION_ERROR',
      message: 'Validation failed',
      validationErrors: { email: ['invalid format'] },
    };
    const err = parseAstroidError(400, payload, 'req_123');
    expect(err).toBeInstanceOf(AstroidValidationError);
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.status).toBe(400);
    expect(err.requestId).toBe('req_123');
    expect(err.validationErrors).toEqual({ email: ['invalid format'] });
  });

  it('parses HTTP 422 policy blocking error correctly', () => {
    const payload = {
      code: 'POLICY_VIOLATION',
      message: 'Transaction exceeds max allowed limit',
      details: { policyId: 'pol_99' },
    };
    const err = parseAstroidError(422, payload, 'req_456');
    expect(err).toBeInstanceOf(AstroidPolicyViolationError);
    expect(err.code).toBe('POLICY_VIOLATION');
    expect(err.status).toBe(422);
    expect(err.details).toEqual({ policyId: 'pol_99' });
  });

  it('parses Stellar Horizon specific error codes and exposes horizonCode', () => {
    const payload = {
      code: 'op_underfunded',
      message: 'Stellar operation underfunded',
      horizonCode: 'op_underfunded',
    };
    const err = parseAstroidError(400, payload, 'req_789');
    expect(err).toBeInstanceOf(AstroidHorizonError);
    expect((err as AstroidHorizonError).horizonCode).toBe('op_underfunded');
  });

  it('parses HTTP 500 internal crash correctly', () => {
    const payload = {
      code: 'INTERNAL_ERROR',
      message: 'Database connection failed',
    };
    const err = parseAstroidError(500, payload, 'req_500');
    expect(err).toBeInstanceOf(AstroidServerInternalError);
    expect(err.status).toBe(500);
    expect(err.code).toBe('INTERNAL_ERROR');
  });

  it('preserves underlying error cause without loss of callstack', () => {
    const original = new Error('Socket hang up');
    const err = parseAstroidError(502, { message: 'Bad Gateway' }, 'req_gw', original);
    expect(err.cause).toBe(original);
  });
});

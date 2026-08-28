import { describe, it, expect } from 'vitest';
import {
  AstroidSDKError,
  AstroidValidationError,
  AstroidHorizonError,
  AstroidPolicyViolationError,
  parseAstroidError,
} from './errors.js';
import { AuthenticationError, ServerError } from '@astroid/errors';

describe('@astroid/client errors and parser', () => {
  it('defines the custom error hierarchy', () => {
    const base = new AstroidSDKError('test', { code: 'TEST_ERROR', status: 400 });
    expect(base).toBeInstanceOf(AstroidSDKError);

    const valErr = new AstroidValidationError('invalid', {
      code: 'VALIDATION_ERROR',
      status: 400,
      details: { fields: { email: ['required'] } },
    });
    expect(valErr).toBeInstanceOf(AstroidSDKError);
    expect(valErr.fieldErrors).toEqual({ email: ['required'] });

    const horizonErr = new AstroidHorizonError('stellar failed', {
      code: 'op_underfunded',
      status: 400,
      details: { stellarErrorCode: 'op_underfunded', horizonCode: 'bad_req' },
    });
    expect(horizonErr).toBeInstanceOf(AstroidSDKError);
    expect(horizonErr.stellarErrorCode).toBe('op_underfunded');
    expect(horizonErr.horizonCode).toBe('bad_req');

    const policyErr = new AstroidPolicyViolationError('blocked', {
      code: 'POLICY_VIOLATION',
      status: 422,
    });
    expect(policyErr).toBeInstanceOf(AstroidSDKError);
  });

  it('parses HTTP 400 validation array payload correctly', async () => {
    const res = new Response(
      JSON.stringify({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          details: { fields: { amount: ['must be positive'] } },
        },
      }),
      {
        status: 400,
        headers: { 'content-type': 'application/json', 'x-request-id': 'req_val_1' },
      },
    );

    const err = await parseAstroidError(res);
    expect(err).toBeInstanceOf(AstroidValidationError);
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.status).toBe(400);
    expect(err.requestId).toBe('req_val_1');
    expect((err as AstroidValidationError).fieldErrors).toEqual({ amount: ['must be positive'] });
  });

  it('parses HTTP 422 policy blocking payload correctly', async () => {
    const res = new Response(
      JSON.stringify({
        error: {
          code: 'POLICY_VIOLATION',
          message: 'Policy check failed',
          details: { policyId: 'pol_99' },
        },
      }),
      {
        status: 422,
        headers: { 'content-type': 'application/json', 'x-request-id': 'req_policy_1' },
      },
    );

    const err = await parseAstroidError(res);
    expect(err).toBeInstanceOf(AstroidPolicyViolationError);
    expect(err.code).toBe('POLICY_VIOLATION');
    expect(err.status).toBe(422);
    expect(err.requestId).toBe('req_policy_1');
    expect(err.details).toEqual({ policyId: 'pol_99' });
  });

  it('parses Stellar Horizon specific error codes correctly', async () => {
    const res = new Response(
      JSON.stringify({
        error: {
          code: 'op_underfunded',
          message: 'Transaction failed on Stellar ledger',
          details: { stellarErrorCode: 'op_underfunded', horizonCode: 'tx_failed' },
        },
      }),
      {
        status: 400,
        headers: { 'content-type': 'application/json', 'x-request-id': 'req_hz_1' },
      },
    );

    const err = await parseAstroidError(res);
    expect(err).toBeInstanceOf(AstroidHorizonError);
    expect((err as AstroidHorizonError).stellarErrorCode).toBe('op_underfunded');
    expect((err as AstroidHorizonError).horizonCode).toBe('tx_failed');
  });

  it('parses HTTP 500 internal crash payload correctly', async () => {
    const res = new Response(
      JSON.stringify({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Internal server error occurred',
        },
      }),
      {
        status: 500,
        headers: { 'content-type': 'application/json', 'x-request-id': 'req_500_1' },
      },
    );

    const err = await parseAstroidError(res);
    expect(err).toBeInstanceOf(ServerError);
    expect(err.code).toBe('INTERNAL_ERROR');
    expect(err.status).toBe(500);
  });

  it('handles non-JSON error responses gracefully', async () => {
    const res = new Response('Gateway Timeout', {
      status: 504,
      headers: { 'content-type': 'text/plain' },
    });

    const err = await parseAstroidError(res);
    expect(err.status).toBe(504);
    expect(err.message).toContain('Gateway Timeout');
  });
});

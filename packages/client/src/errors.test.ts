import { describe, it, expect } from 'vitest';
import {
  parseErrorResponse,
  AstroidSDKError,
  AstroidValidationError,
  AstroidPolicyViolationError,
  AstroidHorizonError,
} from './errors.js';

describe('@astroid/client error mapping & parsing', () => {
  it('parses HTTP 400 validation array into AstroidValidationError with field mappings', async () => {
    const response = new Response(
      JSON.stringify({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid input parameters',
          details: {
            fields: {
              email: ['must be a valid email'],
              amount: ['must be greater than 0'],
            },
          },
        },
      }),
      {
        status: 400,
        headers: {
          'content-type': 'application/json',
          'x-request-id': 'req_val_123',
        },
      }
    );

    const err = await parseErrorResponse(response);
    expect(err).toBeInstanceOf(AstroidValidationError);
    expect(err).toBeInstanceOf(AstroidSDKError);
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.status).toBe(400);
    expect(err.requestId).toBe('req_val_123');
    expect((err as AstroidValidationError).fieldErrors).toEqual({
      email: ['must be a valid email'],
      amount: ['must be greater than 0'],
    });
  });

  it('parses HTTP 422 policy blocking error into AstroidPolicyViolationError', async () => {
    const response = new Response(
      JSON.stringify({
        error: {
          code: 'POLICY_VIOLATION',
          message: 'Transaction blocked by policy rules',
          details: {
            policyCodes: ['MAX_AMOUNT_EXCEEDED'],
          },
        },
      }),
      {
        status: 422,
        headers: {
          'content-type': 'application/json',
          'x-request-id': 'req_pol_456',
        },
      }
    );

    const err = await parseErrorResponse(response);
    expect(err).toBeInstanceOf(AstroidPolicyViolationError);
    expect(err.code).toBe('POLICY_VIOLATION');
    expect(err.status).toBe(422);
    expect((err as AstroidPolicyViolationError).policyCodes).toEqual(['MAX_AMOUNT_EXCEEDED']);
  });

  it('parses Stellar Horizon specific error codes into AstroidHorizonError', async () => {
    const response = new Response(
      JSON.stringify({
        error: {
          code: 'op_underfunded',
          message: 'Operation failed due to lack of funds',
          details: {
            horizonCode: 'op_underfunded',
            resultCodes: { transaction: 'tx_failed', operation: 'op_underfunded' },
          },
        },
      }),
      {
        status: 400,
        headers: {
          'content-type': 'application/json',
          'x-request-id': 'req_hor_789',
        },
      }
    );

    const err = await parseErrorResponse(response);
    expect(err).toBeInstanceOf(AstroidHorizonError);
    expect((err as AstroidHorizonError).horizonCode).toBe('op_underfunded');
    expect((err as AstroidHorizonError).stellarResultCodes).toEqual({
      transaction: 'tx_failed',
      operation: 'op_underfunded',
    });
  });

  it('parses HTTP 500 internal crash with non-json or plain text safely', async () => {
    const response = new Response('Internal Server Error Crash', {
      status: 500,
      headers: {
        'content-type': 'text/plain',
        'x-request-id': 'req_500_abc',
      },
    });

    const err = await parseErrorResponse(response);
    expect(err).toBeInstanceOf(AstroidSDKError);
    expect(err.status).toBe(500);
    expect(err.requestId).toBe('req_500_abc');
    expect(err.details).toEqual({ raw: 'Internal Server Error Crash' });
  });
});

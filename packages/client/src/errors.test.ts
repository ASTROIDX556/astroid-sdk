import { describe, it, expect } from 'vitest';
import { parseAstroidError, AstroidHorizonError } from './errors.js';
import { ValidationError, PolicyViolationError, ServerError } from '@astroid/errors';

describe('packages/client/src/errors.ts', () => {
  it('parses HTTP 400 validation error correctly', async () => {
    const response = new Response(JSON.stringify({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid input',
        details: { fields: { amount: ['must be positive'] } }
      }
    }), { status: 400, headers: { 'content-type': 'application/json' } });

    const err = parseAstroidError(response, await awaitResponseJson(response), 'req_val');
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).fieldErrors).toEqual({ amount: ['must be positive'] });
    expect(err.requestId).toBe('req_val');
    expect(err.status).toBe(400);
  });

  it('parses HTTP 422 policy violation and Stellar Horizon codes', async () => {
    const response = new Response(JSON.stringify({
      error: {
        code: 'POLICY_VIOLATION',
        message: 'Policy check failed',
        details: { stellarCode: 'op_underfunded' }
      }
    }), { status: 422, headers: { 'content-type': 'application/json' } });

    const err = parseAstroidError(response, await awaitResponseJson(response), 'req_horizon');
    expect(err).toBeInstanceOf(AstroidHorizonError);
    expect((err as AstroidHorizonError).stellarCode).toBe('op_underfunded');
    expect(err.status).toBe(422);
  });

  it('parses HTTP 500 internal crash correctly', async () => {
    const response = new Response(JSON.stringify({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Internal server error'
      }
    }), { status: 500, headers: { 'content-type': 'application/json' } });

    const err = parseAstroidError(response, await awaitResponseJson(response), 'req_500');
    expect(err).toBeInstanceOf(ServerError);
    expect(err.status).toBe(500);
    expect(err.code).toBe('INTERNAL_ERROR');
  });
});

async function awaitResponseJson(res: Response): Promise<unknown> {
  return await res.json();
}

import { describe, it, expect } from 'vitest';
import { parseAstroidError, AstroidHorizonError, AstroidPolicyViolationError, AstroidValidationError } from './errors.js';
import { ServerError, RateLimitError } from '@astroid/errors';

describe('@astroid/client error mapping', () => {
  it('parses validation error with HTTP 400', () => {
    const res = new Response(JSON.stringify({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: { fields: { email: ['invalid'] } } } }), { status: 400 });
    const err = parseAstroidError(res, awaitResBody(res), 'req_1');
    expect(err).toBeInstanceOf(AstroidValidationError);
    expect(err.status).toBe(400);
    expect((err as AstroidValidationError).fieldErrors).toEqual({ email: ['invalid'] });
  });

  it('parses policy violation error with HTTP 422', () => {
    const res = new Response(JSON.stringify({ error: { code: 'POLICY_VIOLATION', message: 'Blocked by policy' } }), { status: 422 });
    const err = parseAstroidError(res, awaitResBody(res), 'req_2');
    expect(err).toBeInstanceOf(AstroidPolicyViolationError);
    expect(err.code).toBe('POLICY_VIOLATION');
  });

  it('parses Stellar Horizon error codes', () => {
    const res = new Response(JSON.stringify({ error: { code: 'STELLAR_ERROR', stellarCode: 'op_underfunded', message: 'Underfunded' } }), { status: 400 });
    const err = parseAstroidError(res, awaitResBody(res), 'req_3');
    expect(err).toBeInstanceOf(AstroidHorizonError);
    expect((err as AstroidHorizonError).stellarCode).toBe('op_underfunded');
  });

  it('parses HTTP 500 internal crash into ServerError', () => {
    const res = new Response(JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'Crash' } }), { status: 500 });
    const err = parseAstroidError(res, awaitResBody(res), 'req_500');
    expect(err).toBeInstanceOf(ServerError);
    expect(err.status).toBe(500);
  });
});

async function awaitResBody(res: Response): Promise<unknown> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

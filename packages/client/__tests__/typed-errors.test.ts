import { describe, expect, it, vi } from 'vitest';
import { Astroid } from '../src/index.js';
import {
  // Specialized classes.
  ApiRateLimitError,
  AstroidApiError,
  AstroidError,
  AuthenticationError,
  ConflictError,
  ForbiddenError,
  InternalServerError,
  NotFoundError,
  PolicyViolationError,
  RateLimitError,
  ServerError,
  TransactionSimulationError,
  ValidationError,
  // Guards.
  isApiRateLimitError,
  isAuthenticationError,
  isConflictError,
  isForbiddenError,
  isNotFoundError,
  isPolicyViolationError,
  isRateLimitError,
  isServerError,
  isValidationError,
  // Mapper helpers.
  errorClassForStatus,
  fromApiError,
  mapStatusToError,
  statusCodeToCode,
  type AstroidErrorOptions,
} from '@astroid/errors';

/**
 * Issue #373 — typed API exception classes in @astroid/client.
 *
 * Verifies, end-to-end through the `Astroid` client's fetch wrapper with mocked
 * `fetch` responses, that:
 *  - common HTTP statuses (400/401/403/404/409/422/429/5xx) map to the correct
 *    typed exception subclass,
 *  - `status` / `statusCode` / `code` are retained on the thrown error,
 *  - error message formatting falls back sanely when the body is unparseable,
 *  - the exported guards and mapper helpers behave as documented.
 */

/** Build an `Astroid` client whose transport always answers with `response`. */
function clientRespondingWith(response: () => Response): Astroid {
  const mockFetch = vi.fn().mockImplementation(async () => response());
  return new Astroid({
    apiKey: 'sk_test_matrix',
    baseUrl: 'https://api.astroid.test/v1',
    fetch: mockFetch as unknown as typeof fetch,
    // Disable retries so retryable statuses (429/5xx) throw immediately.
    retry: false,
  });
}

/** JSON error envelope response. */
function jsonError(
  status: number,
  error: { code: string; message: string; details?: Record<string, unknown> },
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

/** A non-JSON (HTML) response, as a misbehaving gateway would return. */
function htmlError(status: number): Response {
  return new Response('<html><body>502 Bad Gateway</body></html>', {
    status,
    headers: { 'content-type': 'text/html' },
  });
}

/* -------------------------------------------------------------------------- */
/* Status → typed exception matrix                                             */
/* -------------------------------------------------------------------------- */

describe('typed exception matrix — HTTP status → error class', () => {
  it('400 VALIDATION_ERROR → ValidationError', async () => {
    const client = clientRespondingWith(() =>
      jsonError(400, { code: 'VALIDATION_ERROR', message: 'amount must be positive' }),
    );
    const err = await client.wallets.get('w_1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).status).toBe(400);
    expect((err as ValidationError).message).toBe('amount must be positive');
  });

  it('401 AUTHENTICATION_ERROR → AuthenticationError', async () => {
    const client = clientRespondingWith(() =>
      jsonError(401, { code: 'AUTHENTICATION_ERROR', message: 'Invalid API key' }),
    );
    const err = await client.wallets.get('w_1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AuthenticationError);
    expect((err as AuthenticationError).status).toBe(401);
    expect((err as AuthenticationError).code).toBe('AUTHENTICATION_ERROR');
  });

  it('403 FORBIDDEN → ForbiddenError', async () => {
    const client = clientRespondingWith(() =>
      jsonError(403, { code: 'FORBIDDEN', message: 'Agent lacks scope' }),
    );
    const err = await client.wallets.get('w_1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ForbiddenError);
    expect((err as ForbiddenError).status).toBe(403);
  });

  it('404 NOT_FOUND → NotFoundError', async () => {
    const client = clientRespondingWith(() =>
      jsonError(404, { code: 'NOT_FOUND', message: 'Wallet not found' }),
    );
    const err = await client.wallets.get('w_missing').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NotFoundError);
    expect((err as NotFoundError).status).toBe(404);
    expect((err as NotFoundError).message).toBe('Wallet not found');
  });

  it('409 CONFLICT → ConflictError', async () => {
    const client = clientRespondingWith(() =>
      jsonError(409, { code: 'CONFLICT', message: 'Sequence number already used' }),
    );
    const err = await client.wallets.get('w_1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect((err as ConflictError).status).toBe(409);
  });

  it('422 POLICY_VIOLATION → PolicyViolationError', async () => {
    const client = clientRespondingWith(() =>
      jsonError(422, { code: 'POLICY_VIOLATION', message: 'Blocked by spending policy' }),
    );
    const err = await client.wallets.get('w_1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PolicyViolationError);
    expect((err as PolicyViolationError).status).toBe(422);
  });

  it('429 RATE_LIMITED → RateLimitError with retryAfter', async () => {
    const client = clientRespondingWith(() =>
      jsonError(
        429,
        {
          code: 'RATE_LIMITED',
          message: 'Too many requests',
          details: { retryAfter: 30 },
        },
        { 'retry-after': '30' },
      ),
    );
    const err = await client.wallets.get('w_1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RateLimitError);
    expect((err as RateLimitError).status).toBe(429);
    expect((err as RateLimitError).retryAfter).toBe(30);
    expect(isRateLimitError(err)).toBe(true);
    // `ApiRateLimitError` is a subclass alias of `RateLimitError` (issue #76
    // naming): every ApiRateLimitError is a RateLimitError, but the mapper
    // produces the canonical RateLimitError, so the alias guard is false here.
    expect(err).not.toBeInstanceOf(ApiRateLimitError);
    expect(isApiRateLimitError(err)).toBe(false);
    // The alias subclass itself still satisfies both guards.
    const alias = new ApiRateLimitError('slow down', { code: 'RATE_LIMITED', status: 429 });
    expect(alias).toBeInstanceOf(RateLimitError);
    expect(isRateLimitError(alias)).toBe(true);
    expect(isApiRateLimitError(alias)).toBe(true);
  });

  it('500 INTERNAL_ERROR → InternalServerError (also instanceof ServerError)', async () => {
    const client = clientRespondingWith(() =>
      jsonError(500, { code: 'INTERNAL_ERROR', message: 'Something broke' }),
    );
    const err = await client.wallets.get('w_1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(InternalServerError);
    expect(err).toBeInstanceOf(ServerError);
    expect((err as InternalServerError).status).toBe(500);
  });

  it('503 without a JSON envelope → InternalServerError with fallback message', async () => {
    const client = clientRespondingWith(() =>
      new Response('service restarting', {
        status: 503,
        headers: { 'content-type': 'text/plain' },
      }),
    );
    const err = await client.wallets.get('w_1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(InternalServerError);
    expect((err as InternalServerError).status).toBe(503);
    expect((err as InternalServerError).message).toBe('Request failed with status 503');
  });

  it('status-only mapping: 404 with an empty body → NotFoundError with formatted message', async () => {
    const client = clientRespondingWith(
      () => new Response(null, { status: 404, headers: { 'content-type': 'application/json' } }),
    );
    const err = await client.wallets.get('w_1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NotFoundError);
    expect((err as NotFoundError).message).toBe('Request failed with status 404');
    expect((err as NotFoundError).code).toBe('NOT_FOUND');
  });

  it('unparseable HTML 502 → InternalServerError, not a SyntaxError', async () => {
    const client = clientRespondingWith(() => htmlError(502));
    const err = await client.wallets.get('w_1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(InternalServerError);
    expect((err as InternalServerError).status).toBe(502);
  });
});

/* -------------------------------------------------------------------------- */
/* Status / code retention and structured details                             */
/* -------------------------------------------------------------------------- */

describe('typed exception — status retention and structured details', () => {
  it('retains status, statusCode, code, requestId and details on the thrown error', async () => {
    const client = clientRespondingWith(() =>
      jsonError(
        400,
        {
          code: 'VALIDATION_ERROR',
          message: 'Invalid wallet',
          details: { fields: { label: ['required'] } },
        },
        { 'x-request-id': 'req_matrix_1' },
      ),
    );
    const err = (await client.wallets.get('w_1').catch((e: unknown) => e)) as ValidationError;

    expect(err).toBeInstanceOf(AstroidError);
    expect(err.status).toBe(400);
    expect(err.statusCode).toBe(400); // alias parity (issue #279)
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.requestId).toBe('req_matrix_1');
    expect(err.details).toEqual({ fields: { label: ['required'] } });
    // Field-level errors surface through the ValidationError accessor.
    expect(err.fieldErrors).toEqual({ label: ['required'] });
  });

  it('serializes to a JSON-safe payload via toJSON()', async () => {
    const client = clientRespondingWith(() =>
      jsonError(404, { code: 'NOT_FOUND', message: 'Wallet not found' }, { 'x-request-id': 'req_9' }),
    );
    const err = (await client.wallets.get('w_1').catch((e: unknown) => e)) as NotFoundError;
    const serialized = err.toJSON();

    expect(serialized.name).toBe('NotFoundError');
    expect(serialized.message).toBe('Wallet not found');
    expect(serialized.code).toBe('NOT_FOUND');
    expect(serialized.status).toBe(404);
    expect(serialized.statusCode).toBe(404);
    expect(serialized.requestId).toBe('req_9');
  });

  it('every mapped error is catchable as the base AstroidError', async () => {
    const statuses = [400, 401, 403, 404, 409, 422, 429, 500];
    for (const status of statuses) {
      const client = clientRespondingWith(() =>
        jsonError(status, { code: 'INTERNAL_ERROR', message: `failed ${status}` }),
      );
      const err = await client.wallets.get('w_1').catch((e: unknown) => e);
      expect(err).toBeInstanceOf(AstroidError);
      expect(err).toBeInstanceOf(Error);
      expect((err as AstroidError).status).toBe(status);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Guards                                                                      */
/* -------------------------------------------------------------------------- */

describe('typed exception guards', () => {
  const options: AstroidErrorOptions = { code: 'TEST', status: 400 };

  it('narrow the correct subclasses and reject others', () => {
    expect(isAuthenticationError(new AuthenticationError('x', options))).toBe(true);
    expect(isAuthenticationError(new NotFoundError('x', { ...options, code: 'NOT_FOUND' }))).toBe(false);

    expect(isForbiddenError(new ForbiddenError('x', options))).toBe(true);
    expect(isValidationError(new ValidationError('x', options))).toBe(true);
    expect(isNotFoundError(new NotFoundError('x', options))).toBe(true);
    expect(isConflictError(new ConflictError('x', options))).toBe(true);
    expect(isPolicyViolationError(new PolicyViolationError('x', options))).toBe(true);
    expect(isRateLimitError(new RateLimitError('x', options))).toBe(true);
    expect(isServerError(new InternalServerError('x', options))).toBe(true);
  });

  it('reject plain Error and non-errors', () => {
    expect(isAuthenticationError(new Error('nope'))).toBe(false);
    expect(isRateLimitError('RATE_LIMITED')).toBe(false);
    expect(isServerError(undefined)).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Mapper helpers                                                              */
/* -------------------------------------------------------------------------- */

describe('status/body → typed error mappers', () => {
  it('mapStatusToError picks the class from the HTTP status alone', () => {
    expect(mapStatusToError(401)).toBeInstanceOf(AuthenticationError);
    expect(mapStatusToError(403)).toBeInstanceOf(ForbiddenError);
    expect(mapStatusToError(404)).toBeInstanceOf(NotFoundError);
    expect(mapStatusToError(409)).toBeInstanceOf(ConflictError);
    expect(mapStatusToError(422)).toBeInstanceOf(ValidationError);
    expect(mapStatusToError(429)).toBeInstanceOf(RateLimitError);
    expect(mapStatusToError(500)).toBeInstanceOf(InternalServerError);
  });

  it('mapStatusToError prefers the body code over the status', () => {
    const err = mapStatusToError(400, undefined, {
      body: { error: { code: 'NOT_FOUND', message: 'gone' } },
    });
    expect(err).toBeInstanceOf(NotFoundError);
    expect(err.message).toBe('gone');
    expect(err.status).toBe(400);
  });

  it('mapStatusToError falls back to a formatted message', () => {
    expect(mapStatusToError(418).message).toBe('Request failed with status 418');
  });

  it('fromApiError maps codes without an HTTP status (offline failures)', () => {
    const err = fromApiError({ code: 'INSUFFICIENT_FUNDS', message: 'no balance' });
    expect(err.message).toBe('no balance');
    expect(err.status).toBeUndefined();
    expect(err.code).toBe('INSUFFICIENT_FUNDS');
  });

  it('errorClassForStatus and statusCodeToCode stay in sync', () => {
    expect(errorClassForStatus(404)).toBe(NotFoundError);
    expect(statusCodeToCode(404)).toBe('NOT_FOUND');
    expect(statusCodeToCode(429)).toBe('RATE_LIMITED');
    expect(statusCodeToCode(500)).toBe('INTERNAL_ERROR');
  });

  it('an unmapped code falls back to the generic ApiError, still an AstroidApiError', () => {
    const err = fromApiError({ code: 'MYSTERY_CODE', message: 'huh' }, { status: 400 });
    expect(err).toBeInstanceOf(AstroidApiError);
    expect(err).not.toBeInstanceOf(NotFoundError);
    expect(err.code).toBe('MYSTERY_CODE');
  });
});

/* -------------------------------------------------------------------------- */
/* Transaction simulation                                                      */
/* -------------------------------------------------------------------------- */

describe('TransactionSimulationError mapping', () => {
  it('SIMULATION_FAILED code maps to TransactionSimulationError', () => {
    const err = fromApiError({ code: 'SIMULATION_FAILED', message: 'op failed' }, { status: 422 });
    expect(err).toBeInstanceOf(TransactionSimulationError);
  });
});

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  Astroid,
  parseErrorResponse,
  parseErrorBody,
  createErrorParserMiddleware,
  StellarHorizonError,
  ValidationError,
  AuthenticationError,
  NotFoundError,
  ConflictError,
  PolicyViolationError,
  BudgetExceededError,
  RateLimitError,
  ServerError,
} from './index.js';

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'x-request-id': 'req_test' },
  });
}

function errorResponse(
  status: number,
  code: string,
  message: string,
  details?: Record<string, unknown>,
): Response {
  return jsonResponse(
    { error: { code, message, details } },
    status,
  );
}


/* -------------------------------------------------------------------------- */
/* parseErrorBody — direct unit tests                                          */
/* -------------------------------------------------------------------------- */

describe('parseErrorBody', () => {
  it('maps AUTHENTICATION_ERROR code to AuthenticationError', () => {
    const body = {
      error: { code: 'AUTHENTICATION_ERROR', message: 'Invalid API key' },
    };
    const error = parseErrorBody(401, body);
    expect(error).toBeInstanceOf(AuthenticationError);
    expect(error.message).toBe('Invalid API key');
    expect(error.code).toBe('AUTHENTICATION_ERROR');
  });

  it('maps VALIDATION_ERROR with field details', () => {
    const body = {
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid input',
        details: { fields: { name: ['Required'], email: ['Invalid format'] } },
      },
    };
    const error = parseErrorBody(400, body);
    expect(error).toBeInstanceOf(ValidationError);
    expect(error.details?.fields).toEqual({
      name: ['Required'],
      email: ['Invalid format'],
    });
  });

  it('maps NOT_FOUND code to NotFoundError', () => {
    const body = { error: { code: 'NOT_FOUND', message: 'Wallet not found' } };
    const error = parseErrorBody(404, body);
    expect(error).toBeInstanceOf(NotFoundError);
  });

  it('maps CONFLICT code to ConflictError', () => {
    const body = { error: { code: 'CONFLICT', message: 'Duplicate' } };
    const error = parseErrorBody(409, body);
    expect(error).toBeInstanceOf(ConflictError);
  });

  it('maps POLICY_VIOLATION to PolicyViolationError', () => {
    const body = { error: { code: 'POLICY_VIOLATION', message: 'Blocked' } };
    const error = parseErrorBody(403, body);
    expect(error).toBeInstanceOf(PolicyViolationError);
  });

  it('maps BUDGET_EXCEEDED to BudgetExceededError', () => {
    const body = { error: { code: 'BUDGET_EXCEEDED', message: 'Over limit' } };
    const error = parseErrorBody(402, body);
    expect(error).toBeInstanceOf(BudgetExceededError);
  });

  it('maps RATE_LIMITED to RateLimitError', () => {
    const body = { error: { code: 'RATE_LIMITED', message: 'Slow down' } };
    const error = parseErrorBody(429, body);
    expect(error).toBeInstanceOf(RateLimitError);
  });

  it('maps INTERNAL_ERROR to ServerError', () => {
    const body = { error: { code: 'INTERNAL_ERROR', message: 'Boom' } };
    const error = parseErrorBody(500, body);
    expect(error).toBeInstanceOf(ServerError);
  });

  it('detects Stellar Horizon extras.result_codes (operation)', () => {
    const body = {
      extras: {
        result_codes: {
          operations: ['op_underfunded'],
          transaction: 'tx_failed',
        },
      },
    };
    const error = parseErrorBody(400, body);
    expect(error).toBeInstanceOf(StellarHorizonError);
    if (error instanceof StellarHorizonError) {
      expect(error.stellarCode).toBe('op_underfunded');
      expect(error.operationCode).toBe('op_underfunded');
    }
  });

  it('detects Stellar Horizon extras.result_codes (transaction)', () => {
    const body = {
      extras: {
        result_codes: {
          transaction: 'tx_bad_seq',
        },
      },
    };
    const error = parseErrorBody(409, body);
    expect(error).toBeInstanceOf(StellarHorizonError);
    if (error instanceof StellarHorizonError) {
      expect(error.stellarCode).toBe('tx_bad_seq');
    }
  });

  it('detects flat result_code field', () => {
    const body = { result_code: 'tx_too_late' };
    const error = parseErrorBody(410, body);
    expect(error).toBeInstanceOf(StellarHorizonError);
    if (error instanceof StellarHorizonError) {
      expect(error.stellarCode).toBe('tx_too_late');
    }
  });

  it('extracts field-level validation errors from top-level errors array', () => {
    const body = {
      errors: [
        { field: 'amount', message: 'Must be positive' },
        { field: 'asset', message: 'Unsupported asset' },
      ],
    };
    const error = parseErrorBody(400, body);
    expect(error).toBeInstanceOf(ValidationError);
    expect(error.details?.fields).toEqual({
      amount: ['Must be positive'],
      asset: ['Unsupported asset'],
    });
  });

  it('extracts field-level validation errors from validationErrors array', () => {
    const body = {
      validationErrors: [
        { field: 'name', message: 'Too short' },
      ],
    };
    const error = parseErrorBody(422, body);
    expect(error).toBeInstanceOf(ValidationError);
    expect(error.details?.fields).toEqual({
      name: ['Too short'],
    });
  });

  it('extracts field-level errors from nested error.details.validationErrors', () => {
    const body = {
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid',
        details: {
          validationErrors: [
            { field: 'wallet_id', message: 'Required' },
          ],
        },
      },
    };
    const error = parseErrorBody(400, body);
    expect(error).toBeInstanceOf(ValidationError);
    expect(error.details?.fields).toEqual({
      wallet_id: ['Required'],
    });
  });

  it('falls back to base AstroidError for unknown codes', () => {
    const body = { error: { code: 'SOMETHING_WEIRD', message: 'Oops' } };
    const error = parseErrorBody(500, body);
    expect(error.code).toBe('SOMETHING_WEIRD');
  });

  it('falls back to status-based error for empty body', () => {
    const error = parseErrorBody(404, undefined);
    expect(error.code).toBe('NOT_FOUND');
  });
});

/* -------------------------------------------------------------------------- */
/* parseErrorResponse — async tests                                            */
/* -------------------------------------------------------------------------- */

describe('parseErrorResponse', () => {
  it('parses a standard API error response', async () => {
    const response = errorResponse(401, 'AUTHENTICATION_ERROR', 'Bad key');
    const { error, parsed } = await parseErrorResponse(response);
    expect(parsed).toBe(true);
    expect(error).toBeInstanceOf(AuthenticationError);
    expect(error.message).toBe('Bad key');
  });

  it('returns parsed: false for non-JSON content type', async () => {
    const response = new Response('Internal Server Error', {
      status: 500,
      headers: { 'content-type': 'text/plain' },
    });
    const { parsed } = await parseErrorResponse(response);
    expect(parsed).toBe(false);
  });

  it('returns parsed: false for empty body', async () => {
    const response = new Response(null, { status: 204 });
    const { parsed } = await parseErrorResponse(response);
    expect(parsed).toBe(false);
  });

  it('handles Stellar Horizon errors', async () => {
    const body = {
      extras: {
        result_codes: {
          operations: ['op_underfunded'],
          transaction: 'tx_failed',
        },
      },
    };
    const response = jsonResponse(body, 400);
    const { error, parsed } = await parseErrorResponse(response);
    expect(parsed).toBe(true);
    expect(error).toBeInstanceOf(StellarHorizonError);
  });

  it('extracts x-request-id from response headers', async () => {
    const response = new Response(
      JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Nope' } }),
      {
        status: 404,
        headers: {
          'content-type': 'application/json',
          'x-request-id': 'req_abc123',
        },
      },
    );
    const { error } = await parseErrorResponse(response);
    expect(error.requestId).toBe('req_abc123');
  });
});

/* -------------------------------------------------------------------------- */
/* createErrorParserMiddleware — integration with Astroid client               */
/* -------------------------------------------------------------------------- */

describe('createErrorParserMiddleware', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is a named middleware with onResponse and onError hooks', () => {
    const mw = createErrorParserMiddleware();
    expect(mw.name).toBe('astroid-error-parser');
    expect(typeof mw.onResponse).toBe('function');
    expect(typeof mw.onError).toBe('function');
  });

  it('enriches errors with field details from validation array payloads', async () => {
    const validationBody = {
      errors: [
        { field: 'amount', message: 'Must be > 0' },
        { field: 'asset', message: 'Not supported' },
      ],
    };
    const mockFetch = vi.fn().mockImplementation(async () => {
      return new Response(JSON.stringify(validationBody), {
        status: 400,
        headers: {
          'content-type': 'application/json',
          'x-request-id': 'req_val_1',
        },
      });
    });
    vi.stubGlobal('fetch', mockFetch);

    const astroid = new Astroid({
      apiKey: 'sk_test_key',
      baseUrl: 'https://api.example.test',
      fetch: mockFetch,
    });

    await expect(
      astroid.wallets.list(),
    ).rejects.toThrow();

    try {
      await astroid.wallets.list();
    } catch (err) {
      const error = err as Record<string, unknown>;
      // The middleware enriches the error with field-level details.
      expect(error.details).toBeDefined();
      expect(error.code).toBeDefined();
    }
  });

  it('enriches errors with Stellar Horizon codes', async () => {
    const stellarBody = {
      extras: {
        result_codes: {
          operations: ['op_underfunded'],
          transaction: 'tx_failed',
        },
      },
    };
    const mockFetch = vi.fn().mockImplementation(async () => {
      return new Response(JSON.stringify(stellarBody), {
        status: 400,
        headers: {
          'content-type': 'application/json',
          'x-request-id': 'req_stellar_1',
        },
      });
    });
    vi.stubGlobal('fetch', mockFetch);

    const astroid = new Astroid({
      apiKey: 'sk_test_key',
      baseUrl: 'https://api.example.test',
      fetch: mockFetch,
    });

    try {
      await astroid.wallets.list();
      expect.fail('Should have thrown');
    } catch (err) {
      const error = err as Record<string, unknown>;
      expect(error.code).toBe('op_underfunded');
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Astroid client — parser exports integration                                 */
/* -------------------------------------------------------------------------- */

describe('Astroid client parser exports', () => {
  it('exports parseErrorResponse and parseErrorBody', () => {
    expect(typeof parseErrorResponse).toBe('function');
    expect(typeof parseErrorBody).toBe('function');
  });

  it('exports createErrorParserMiddleware', () => {
    expect(typeof createErrorParserMiddleware).toBe('function');
  });

  it('exports StellarHorizonError class', () => {
    expect(StellarHorizonError).toBeDefined();
    const err = new StellarHorizonError('test', {
      code: 'op_underfunded',
      status: 402,
      stellarCode: 'op_underfunded',
    });
    expect(err.stellarCode).toBe('op_underfunded');
    expect(err.message).toBe('test');
  });
});

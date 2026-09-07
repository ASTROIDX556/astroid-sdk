import {
  AstroidError,
  AuthenticationError,
  AuthorizationError,
  ValidationError,
  NotFoundError,
  ConflictError,
  PolicyViolationError,
  InsufficientFundsError,
  BudgetExceededError,
  ApprovalRequiredError,
  RateLimitError,
  NetworkError,
  ServerError,
  errorClassForCode,
  fromApiError,
  fromStatus,
  type AstroidErrorOptions,
} from '@astroid/errors';
import type { ApiError } from '@astroid/types';

export {
  AuthenticationError,
  AuthorizationError,
  ValidationError,
  NotFoundError,
  ConflictError,
  PolicyViolationError,
  InsufficientFundsError,
  BudgetExceededError,
  ApprovalRequiredError,
  RateLimitError,
  NetworkError,
  ServerError,
};

export class AstroidHorizonError extends AstroidError {
  readonly stellarCode: string;

  constructor(message: string, options: AstroidErrorOptions & { stellarCode: string }) {
    super(message, options);
    this.stellarCode = options.stellarCode;
  }

  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      stellarCode: this.stellarCode,
    };
  }
}

export class AstroidPolicyViolationError extends PolicyViolationError {}

export function parseAstroidError(response: Response, body: unknown, requestId?: string): AstroidError {
  const status = response.status;
  const contentType = response.headers.get('content-type') ?? '';

  let apiError: ApiError | undefined;
  let stellarCode: string | undefined;

  if (contentType.includes('application/json') && body && typeof body === 'object') {
    const obj = body as Record<string, unknown>;
    if (obj['error'] && typeof obj['error'] === 'object') {
      apiError = obj['error'] as ApiError;
    } else if (typeof obj['code'] === 'string' && typeof obj['message'] === 'string') {
      apiError = obj as unknown as ApiError;
    }

    if (typeof obj['stellarCode'] === 'string') {
      stellarCode = obj['stellarCode'];
    } else if (apiError?.details && typeof apiError.details['stellarCode'] === 'string') {
      stellarCode = apiError.details['stellarCode'] as string;
    }
  }

  const cause = new Error(`HTTP ${status} response error`);

  if (stellarCode) {
    const message = apiError?.message ?? `Stellar Horizon error: ${stellarCode}`;
    return new AstroidHorizonError(message, {
      code: apiError?.code ?? 'STELLAR_ERROR',
      status,
      requestId,
      details: apiError?.details,
      stellarCode,
      cause,
    });
  }

  if (apiError) {
    return fromApiError(apiError, {
      status,
      requestId,
      cause,
    });
  }

  const message = typeof body === 'object' && body !== null && 'message' in body ? String((body as any).message) : `Request failed with status ${status}`;
  return fromStatus(status, message, {
    requestId,
    details: typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : undefined,
    cause,
  });
}

/**
 * A generic Stellar Horizon failure that does not map to a more specific SDK
 * domain error (e.g. a Horizon `op_*` / `tx_*` result code with no dedicated
 * subclass). Carries the raw Horizon code so callers can still branch on it.
 */
export class StellarHorizonError extends AstroidError {
  /** The Horizon result code (e.g. `op_no_destination`, `tx_failed`). */
  readonly stellarCode: string;
  /** The first operation result code, when Horizon reported per-operation codes. */
  readonly operationCode: string | undefined;

  constructor(
    message: string,
    options: AstroidErrorOptions & { stellarCode: string; operationCode?: string },
  ) {
    super(message, options);
    this.stellarCode = options.stellarCode;
    this.operationCode = options.operationCode;
  }

  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      stellarCode: this.stellarCode,
      operationCode: this.operationCode,
    };
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;
}

function extractMessage(body: unknown): string | undefined {
  const obj = asRecord(body);
  if (!obj) return undefined;
  const errorField = asRecord(obj.error);
  if (errorField && typeof errorField.message === 'string') return errorField.message;
  if (typeof obj.message === 'string') return obj.message;
  if (typeof obj.error === 'string') return obj.error;
  if (typeof obj.detail === 'string') return obj.detail;
  if (typeof obj.title === 'string') return obj.title;
  return undefined;
}

function extractApiError(body: unknown): { code: string; message: string } | undefined {
  const obj = asRecord(body);
  if (!obj) return undefined;
  const errorField = asRecord(obj.error);
  if (errorField && typeof errorField.code === 'string' && typeof errorField.message === 'string') {
    return { code: errorField.code, message: errorField.message };
  }
  if (typeof obj.code === 'string' && typeof obj.message === 'string') {
    return { code: obj.code as string, message: obj.message as string };
  }
  return undefined;
}

function extractDetails(body: unknown): Record<string, unknown> | undefined {
  const obj = asRecord(body);
  if (!obj) return undefined;
  const errorField = asRecord(obj.error);
  const details = asRecord(errorField?.details) ?? asRecord(obj.details);
  if (details) return details;
  const extras = asRecord(obj.extras);
  if (extras) return extras;
  return undefined;
}

/** Detect Stellar Horizon result codes from various payload shapes. */
export function detectStellarCode(
  body: unknown,
): { stellarCode: string; operationCode?: string } | undefined {
  const obj = asRecord(body);
  if (!obj) return undefined;
  const extras = asRecord(obj.extras);
  if (extras) {
    const resultCodes = asRecord(extras.result_codes);
    if (resultCodes) {
      const transactionCode =
        typeof resultCodes.transaction === 'string' ? resultCodes.transaction : undefined;
      const operationCodes = resultCodes.operations as string[] | undefined;
      const opCode = operationCodes?.[0];
      const code = opCode ?? transactionCode;
      if (code) return { stellarCode: code, operationCode: opCode };
    }
    const extrasStellarCode =
      typeof extras.stellarCode === 'string' ? extras.stellarCode : undefined;
    if (extrasStellarCode) return { stellarCode: extrasStellarCode };
  }
  const resultCode = typeof obj.result_code === 'string' ? obj.result_code : undefined;
  const flatStellarCode = typeof obj.stellarCode === 'string' ? obj.stellarCode : undefined;
  const code = resultCode ?? flatStellarCode;
  if (code) return { stellarCode: code };
  return undefined;
}

interface FieldErrorEntry {
  field?: unknown;
  message?: unknown;
}

function entryToFields(entries: FieldErrorEntry[]): Record<string, string[]> {
  const fields: Record<string, string[]> = {};
  for (const entry of entries) {
    if (typeof entry.field === 'string' && typeof entry.message === 'string') {
      (fields[entry.field] ??= []).push(entry.message);
    }
  }
  return fields;
}

function extractFieldErrors(body: unknown): Record<string, string[]> | undefined {
  const obj = asRecord(body);
  if (!obj) return undefined;

  if (Array.isArray(obj.errors) && obj.errors.length > 0) {
    return entryToFields(obj.errors as FieldErrorEntry[]);
  }
  if (Array.isArray(obj.validationErrors) && obj.validationErrors.length > 0) {
    return entryToFields(obj.validationErrors as FieldErrorEntry[]);
  }

  const errorField = asRecord(obj.error);
  if (errorField) {
    const details = asRecord(errorField.details);
    if (details) {
      if (Array.isArray(details.validationErrors) && details.validationErrors.length > 0) {
        return entryToFields(details.validationErrors as FieldErrorEntry[]);
      }
      const nestedFields = details.fields;
      if (typeof nestedFields === 'object' && nestedFields !== null) {
        return nestedFields as Record<string, string[]>;
      }
    }
  }
  return undefined;
}

/**
 * Synchronously translate a raw HTTP error `status` + response `body` into a
 * strongly-typed {@link AstroidError}. Unlike {@link parseAstroidError} (which
 * requires a full `Response`), this is a pure function that works directly on
 * the parsed payload — suitable for middleware hooks and unit testing.
 *
 * The following payload shapes are recognized, in priority order:
 * - **Stellar Horizon result codes** (`extras.result_codes` / `result_code`) →
 *   {@link StellarHorizonError}
 * - **Standard API envelope** (`{ error: { code, message, details } }`) → mapped
 *   via `@astroid/errors` to the domain class (`PolicyViolationError`,
 *   `BudgetExceededError`, `InsufficientFundsError`, …)
 * - **Field-level validation arrays** (`errors[]` / `validationErrors[]`) →
 *   {@link ValidationError} with `details.fields`
 * - **Fallback** → a status-derived error from `@astroid/errors`
 */
export function parseErrorBody(status: number, body: unknown, requestId?: string): AstroidError {
  const stellar = detectStellarCode(body);
  if (stellar) {
    const message = (stellar.operationCode ?? stellar.stellarCode) || 'Stellar Horizon error';
    const details = extractDetails(body);
    return new StellarHorizonError(message, {
      code: stellar.stellarCode,
      status,
      requestId,
      details: details
        ? { ...details, stellarCode: stellar.stellarCode, operationCode: stellar.operationCode }
        : { stellarCode: stellar.stellarCode, operationCode: stellar.operationCode },
      stellarCode: stellar.stellarCode,
      operationCode: stellar.operationCode,
    });
  }

  const apiError = extractApiError(body);
  if (apiError) {
    const details = extractDetails(body) ?? {};
    const fields = extractFieldErrors(body);
    if (fields && !details.fields) details.fields = fields;
    const ErrorClass = errorClassForCode(apiError.code);
    return new ErrorClass(apiError.message, {
      code: apiError.code,
      status,
      requestId,
      details: Object.keys(details).length > 0 ? details : undefined,
    });
  }

  const fields = extractFieldErrors(body);
  if (fields) {
    return new ValidationError(extractMessage(body) ?? 'Validation failed', {
      code: 'VALIDATION_ERROR',
      status,
      requestId,
      details: { fields },
    });
  }

  return fromStatus(status, `Request failed with status ${status}`, { requestId });
}

/** Result of {@link parseErrorResponse}. */
export interface ParseErrorResult {
  /** Whether the response body was successfully parsed into an SDK error. */
  parsed: boolean;
  /** The translated SDK error, when `parsed` is `true`. */
  error?: AstroidError;
}

/**
 * Asynchronously parse an HTTP error `Response` into a strongly-typed
 * {@link AstroidError}. Returns `{ parsed: false }` for non-JSON content types,
 * empty bodies, and unparseable JSON so callers can fall back gracefully.
 */
export async function parseErrorResponse(response: Response): Promise<ParseErrorResult> {
  const status = response.status;
  const requestId = response.headers.get('x-request-id') ?? undefined;
  const contentType = response.headers.get('content-type') ?? '';

  if (!contentType.includes('application/json')) {
    return { parsed: false };
  }

  const text = await response.text();
  if (!text) {
    return { parsed: false };
  }

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return { parsed: false };
  }

  return { parsed: true, error: parseErrorBody(status, body, requestId) };
}

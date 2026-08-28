/**
 * Robust error mapping and error parser utility for `@astroid/client`.
 */

import {
  AstroidError,
  ValidationError,
  PolicyViolationError,
  fromApiError,
  fromStatus,
  type AstroidErrorOptions,
} from '@astroid/errors';

/**
 * Base SDK Error for `@astroid/client`, preserving status codes, tracing headers,
 * and underlying error callstacks via the standard `cause` property.
 */
export class AstroidSDKError extends AstroidError {
  readonly headers: Headers;

  constructor(message: string, options: AstroidErrorOptions & { headers?: Headers; cause?: unknown }) {
    super(message, options);
    this.headers = options.headers ?? new Headers();
  }
}

/**
 * Validation error mapping specific properties directly to input keys.
 */
export class AstroidValidationError extends AstroidSDKError {
  get fieldErrors(): Record<string, string[]> | undefined {
    return (this.details?.fields ?? this.details) as Record<string, string[]> | undefined;
  }
}

/**
 * Policy violation error containing policy block codes or details.
 */
export class AstroidPolicyViolationError extends AstroidSDKError {
  get policyCodes(): string[] | undefined {
    const codes = this.details?.policyCodes ?? this.details?.codes;
    return Array.isArray(codes) ? (codes as string[]) : undefined;
  }
}

/**
 * Error wrapping Stellar Horizon specific codes (e.g. op_underfunded, tx_bad_seq).
 */
export class AstroidHorizonError extends AstroidSDKError {
  get horizonCode(): string | undefined {
    return (this.details?.horizonCode ?? this.details?.code) as string | undefined;
  }

  get stellarResultCodes(): Record<string, unknown> | undefined {
    return this.details?.resultCodes as Record<string, unknown> | undefined;
  }
}

/**
 * Securely inspects response content-type and parses raw response bodies into
 * structured, typed, and context-rich hierarchy of custom classes.
 */
export async function parseErrorResponse(response: Response): Promise<AstroidSDKError> {
  const status = response.status;
  const requestId = response.headers.get('x-request-id') ?? undefined;
  const contentType = response.headers.get('content-type') ?? '';

  let rawBody: unknown = undefined;
  let text = '';

  if (contentType.includes('application/json')) {
    try {
      text = await response.text();
      if (text) {
        rawBody = JSON.parse(text);
      }
    } catch (parseErr) {
      rawBody = { raw: text };
    }
  } else {
    try {
      text = await response.text();
      rawBody = text ? { raw: text } : undefined;
    } catch {
      rawBody = undefined;
    }
  }

  const errorObj = rawBody && typeof rawBody === 'object' && 'error' in rawBody
    ? (rawBody as { error: any }).error
    : rawBody;

  let code = 'INTERNAL_ERROR';
  let message = response.statusText || 'Unknown error';
  let details: Record<string, unknown> | undefined = undefined;

  if (errorObj && typeof errorObj === 'object') {
    if (typeof (errorObj as any).code === 'string') {
      code = (errorObj as any).code;
    }
    if (typeof (errorObj as any).message === 'string') {
      message = (errorObj as any).message;
    }
    if ((errorObj as any).details && typeof (errorObj as any).details === 'object') {
      details = (errorObj as any).details;
    } else {
      const rest = { ...(errorObj as Record<string, unknown>) };
      delete rest.code;
      delete rest.message;
      if (Object.keys(rest).length > 0) {
        details = rest;
      }
    }
  }

  // Check for Stellar Horizon specific codes in details or top-level
  const horizonCandidate = details?.horizonCode ?? details?.stellarCode ?? (rawBody as any)?.horizonCode;
  if (horizonCandidate || code === 'HORIZON_ERROR' || code.startsWith('op_') || code.startsWith('tx_')) {
    return new AstroidHorizonError(message, {
      code,
      status,
      requestId,
      details: { ...details, horizonCode: horizonCandidate ?? code },
      headers: response.headers,
    });
  }

  if (status === 422 || code === 'POLICY_VIOLATION') {
    return new AstroidPolicyViolationError(message, {
      code,
      status,
      requestId,
      details,
      headers: response.headers,
    });
  }

  if (status === 400 || status === 422 || code === 'VALIDATION_ERROR') {
    return new AstroidValidationError(message, {
      code,
      status,
      requestId,
      details,
      headers: response.headers,
    });
  }

  const baseMapped = fromApiError(
    { code, message, details },
    { status, requestId, details }
  );

  return new AstroidSDKError(baseMapped.message, {
    code: baseMapped.code,
    status: baseMapped.status,
    requestId: baseMapped.requestId,
    details: baseMapped.details,
    headers: response.headers,
  });
}

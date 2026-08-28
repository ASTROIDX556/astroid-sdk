/**
 * `@astroid/client` error mapping and parsing utilities.
 */

import {
  AstroidError,
  AuthenticationError,
  AuthorizationError,
  ConflictError,
  NotFoundError,
  RateLimitError,
  ServerError,
  fromApiError,
  codeForStatus,
} from '@astroid/errors';

/** Base SDK error class alias or re-export */
export class AstroidSDKError extends AstroidError {}

/** Stellar Horizon ledger / transaction error details */
export interface HorizonErrorDetails {
  stellarErrorCode?: string;
  horizonCode?: string;
  extras?: Record<string, unknown>;
  [key: string]: unknown;
}

/** Error when Stellar Horizon encounters transaction/operation rejections */
export class AstroidHorizonError extends AstroidError {
  readonly stellarErrorCode: string | undefined;
  readonly horizonCode: string | undefined;

  constructor(message: string, options: { code: string; status?: number; requestId?: string; details?: Record<string, unknown>; cause?: unknown }) {
    super(message, options);
    const details = options.details as HorizonErrorDetails | undefined;
    this.stellarErrorCode = details?.stellarErrorCode ?? (details?.extras as Record<string, unknown>)?.result_codes as string | undefined;
    this.horizonCode = details?.horizonCode;
  }
}

/** Error when an operation violates spending or operational policies */
export class AstroidPolicyViolationError extends AstroidError {}

/** Error when field validation fails */
export class AstroidValidationError extends AstroidError {
  get fieldErrors(): Record<string, string[]> | undefined {
    return this.details?.fields as Record<string, string[]> | undefined;
  }
}

/**
 * Parse a raw Response or response body/headers into a structured Astroid SDK error.
 */
export async function parseAstroidError(response: Response): Promise<AstroidError> {
  let status = response.status;
  let requestId = response.headers.get('x-request-id') ?? undefined;
  let body: unknown;

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      body = await response.json();
    } catch {
      body = undefined;
    }
  } else {
    try {
      const text = await response.text();
      if (text) {
        try {
          body = JSON.parse(text);
        } catch {
          body = { message: text };
        }
      }
    } catch {
      body = undefined;
    }
  }

  let apiError: { code?: string; message?: string; details?: Record<string, unknown> } | undefined;

  if (body && typeof body === 'object') {
    const b = body as Record<string, unknown>;
    if (b.error && typeof b.error === 'object') {
      apiError = b.error as Record<string, unknown>;
    } else if (b.code && typeof b.code === 'string') {
      apiError = b as Record<string, unknown>;
    }
  }

  const code = apiError?.code ?? codeForStatus(status);
  const message = apiError?.message ?? (body && typeof body === 'object' && typeof (body as Record<string, unknown>).message === 'string' ? ((body as Record<string, unknown>).message as string) : response.statusText || 'Unknown error');
  const details = (apiError?.details ?? (body && typeof body === 'object' ? (body as Record<string, unknown>).details : undefined)) as Record<string, unknown> | undefined;

  const errPayload = {
    code,
    status,
    requestId,
    details,
  };

  if (code === 'POLICY_VIOLATION' || status === 422) {
    if (details?.stellarErrorCode || details?.horizonCode || details?.result_codes || code?.startsWith('op_') || code?.startsWith('tx_')) {
      return new AstroidHorizonError(message, errPayload);
    }
    if (code === 'POLICY_VIOLATION') {
      return new AstroidPolicyViolationError(message, errPayload);
    }
    if (code === 'VALIDATION_ERROR' || status === 400 || status === 422) {
      return new AstroidValidationError(message, errPayload);
    }
  }

  if (details?.stellarErrorCode || details?.horizonCode || code?.startsWith('op_') || code?.startsWith('tx_')) {
    return new AstroidHorizonError(message, errPayload);
  }

  switch (code) {
    case 'AUTHENTICATION_ERROR':
    case 'UNAUTHORIZED':
    case 'INVALID_API_KEY':
    case 'TOKEN_EXPIRED':
      return new AuthenticationError(message, errPayload);
    case 'FORBIDDEN':
      return new AuthorizationError(message, errPayload);
    case 'VALIDATION_ERROR':
    case 'BAD_REQUEST':
      return new AstroidValidationError(message, errPayload);
    case 'NOT_FOUND':
      return new NotFoundError(message, errPayload);
    case 'CONFLICT':
      return new ConflictError(message, errPayload);
    case 'RATE_LIMITED':
      return new RateLimitError(message, errPayload);
    case 'INTERNAL_ERROR':
    case 'SERVICE_UNAVAILABLE':
      return new ServerError(message, errPayload);
    default:
      return fromApiError({ code, message, details }, { status, requestId });
  }
}

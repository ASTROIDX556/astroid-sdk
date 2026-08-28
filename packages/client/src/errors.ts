import {
  AstroidError,
  ValidationError,
  PolicyViolationError,
  fromApiError,
  fromStatus,
  type AstroidErrorOptions,
} from '@astroid/errors';
import type { ApiError } from '@astroid/types';

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

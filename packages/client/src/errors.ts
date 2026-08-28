import {
  AstroidError,
  ValidationError,
  PolicyViolationError,
  ServerError,
  fromApiError,
  fromStatus,
} from '@astroid/errors';

export class AstroidHorizonError extends AstroidError {
  readonly stellarCode: string;

  constructor(message: string, options: { code: string; stellarCode: string; status?: number; requestId?: string; details?: Record<string, unknown>; cause?: unknown }) {
    super(message, options);
    this.stellarCode = options.stellarCode;
  }
}

export class AstroidPolicyViolationError extends PolicyViolationError {}
export class AstroidValidationError extends ValidationError {}

export function parseAstroidError(res: Response, body: unknown, requestId?: string): AstroidError {
  const status = res.status;
  
  if (body && typeof body === 'object' && 'error' in body) {
    const errObj = (body as { error: any }).error;
    if (errObj && typeof errObj === 'object') {
      const stellarCode = errObj.stellarCode ?? errObj.stellar_code;
      if (stellarCode) {
        return new AstroidHorizonError(errObj.message || 'Stellar Horizon error', {
          code: errObj.code || 'STELLAR_HORIZON_ERROR',
          stellarCode,
          status,
          requestId,
          details: errObj.details,
        });
      }
      if (errObj.code === 'POLICY_VIOLATION') {
        return new AstroidPolicyViolationError(errObj.message || 'Policy violation', {
          code: errObj.code,
          status,
          requestId,
          details: errObj.details,
        });
      }
      return fromApiError(errObj, { status, requestId });
    }
  }

  if (status === 422 || status === 400) {
    return new AstroidValidationError('Validation failed', {
      code: 'VALIDATION_ERROR',
      status,
      requestId,
      details: typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : undefined,
    });
  }

  if (status === 403 && body && typeof body === 'object' && 'policyId' in body) {
    return new AstroidPolicyViolationError('Policy violation', {
      code: 'POLICY_VIOLATION',
      status,
      requestId,
      details: body as Record<string, unknown>,
    });
  }

  return fromStatus(status, `HTTP error ${status}`, { requestId, details: typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : undefined });
}

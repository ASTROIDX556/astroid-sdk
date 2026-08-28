/**
 * `@astroid/client/errors` — robust error hierarchy, parser, and mapping layer.
 */

import type { ApiError } from '@astroid/types';

export interface AstroidSDKErrorOptions {
  code: string;
  status?: number;
  requestId?: string;
  details?: Record<string, unknown>;
  cause?: unknown;
  horizonCode?: string;
  validationErrors?: Record<string, string[]>;
}

export class AstroidSDKError extends Error {
  readonly code: string;
  readonly status: number | undefined;
  readonly requestId: string | undefined;
  readonly details: Record<string, unknown> | undefined;
  readonly horizonCode: string | undefined;
  readonly validationErrors: Record<string, string[]> | undefined;

  constructor(message: string, options: AstroidSDKErrorOptions) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = new.target.name;
    this.code = options.code;
    this.status = options.status;
    this.requestId = options.requestId;
    this.details = options.details;
    this.horizonCode = options.horizonCode;
    this.validationErrors = options.validationErrors;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      status: this.status,
      requestId: this.requestId,
      details: this.details,
      horizonCode: this.horizonCode,
      validationErrors: this.validationErrors,
    };
  }
}

export class AstroidValidationError extends AstroidSDKError {
  constructor(message: string, options: AstroidSDKErrorOptions) {
    super(message, { code: 'VALIDATION_ERROR', ...options });
  }
}

export class AstroidHorizonError extends AstroidSDKError {
  constructor(message: string, options: AstroidSDKErrorOptions) {
    super(message, { code: 'HORIZON_ERROR', ...options });
  }
}

export class AstroidPolicyViolationError extends AstroidSDKError {
  constructor(message: string, options: AstroidSDKErrorOptions) {
    super(message, { code: 'POLICY_VIOLATION', ...options });
  }
}

export class AstroidServerInternalError extends AstroidSDKError {
  constructor(message: string, options: AstroidSDKErrorOptions) {
    super(message, { code: 'INTERNAL_ERROR', ...options });
  }
}

export function parseAstroidError(
  status: number,
  body: unknown,
  requestId?: string,
  cause?: unknown,
): AstroidSDKError {
  let code = 'UNKNOWN_ERROR';
  let message = `Request failed with status ${status}`;
  let details: Record<string, unknown> | undefined;
  let horizonCode: string | undefined;
  let validationErrors: Record<string, string[]> | undefined;

  if (body && typeof body === 'object') {
    const obj = body as Record<string, unknown>;
    if (typeof obj['code'] === 'string') {
      code = obj['code'];
    }
    if (typeof obj['message'] === 'string') {
      message = obj['message'];
    } else if (obj['error'] && typeof obj['error'] === 'object') {
      const innerErr = obj['error'] as Record<string, unknown>;
      if (typeof innerErr['code'] === 'string') code = innerErr['code'];
      if (typeof innerErr['message'] === 'string') message = innerErr['message'];
      if (innerErr['details'] && typeof innerErr['details'] === 'object') {
        details = innerErr['details'] as Record<string, unknown>;
      }
    }
    if (obj['details'] && typeof obj['details'] === 'object') {
      details = { ...(details ?? {}), ...(obj['details'] as Record<string, unknown>) };
    }
    if (typeof obj['horizonCode'] === 'string') {
      horizonCode = obj['horizonCode'];
    } else if (details && typeof details['horizonCode'] === 'string') {
      horizonCode = details['horizonCode'] as string;
    }
    if (obj['validationErrors'] && typeof obj['validationErrors'] === 'object') {
      validationErrors = obj['validationErrors'] as Record<string, string[]>;
    } else if (details && details['fields'] && typeof details['fields'] === 'object') {
      validationErrors = details['fields'] as Record<string, string[]>;
    }
  }

  if (horizonCode || code.includes('HORIZON') || code === 'op_underfunded' || code === 'tx_bad_seq') {
    return new AstroidHorizonError(message, {
      code,
      status,
      requestId,
      details,
      horizonCode: horizonCode ?? code,
      validationErrors,
      cause,
    });
  }

  if (code === 'POLICY_VIOLATION' || status === 422) {
    return new AstroidPolicyViolationError(message, {
      code,
      status,
      requestId,
      details,
      horizonCode,
      validationErrors,
      cause,
    });
  }

  if (code === 'VALIDATION_ERROR' || status === 400 || validationErrors) {
    return new AstroidValidationError(message, {
      code,
      status,
      requestId,
      details,
      horizonCode,
      validationErrors,
      cause,
    });
  }

  if (status >= 500) {
    return new AstroidServerInternalError(message, {
      code,
      status,
      requestId,
      details,
      horizonCode,
      validationErrors,
      cause,
    });
  }

  return new AstroidSDKError(message, {
    code,
    status,
    requestId,
    details,
    horizonCode,
    validationErrors,
    cause,
  });
}

import { AstroidError } from '@astroid/errors';

/**
 * Error thrown when agent payload parameters fail runtime validation.
 */
export class AstroidValidationError extends AstroidError {
  constructor(message: string, details?: Record<string, unknown>, requestId?: string) {
    super(message, {
      code: 'ASTROID_VALIDATION_ERROR',
      status: 400,
      details,
      requestId,
    });
    this.name = 'AstroidValidationError';
  }
}

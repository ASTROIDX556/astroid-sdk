import { describe, it, expect } from 'vitest';
import {
  createErrorFromResponse,
  RateLimitError,
  PolicyViolationError,
  InsufficientFundsError,
  BudgetExceededError,
  ApprovalRequiredError,
  AuthenticationError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  ValidationError,
  InternalServerError,
  ApiError,
} from './index.js';

describe('createErrorFromResponse', () => {
  it('maps 429 to RateLimitError and extracts retry-after header', () => {
    const err = createErrorFromResponse({
      status: 429,
      statusText: 'Too Many Requests',
      headers: { 'retry-after': '30' },
      body: { message: 'Slow down' },
    });
    expect(err).toBeInstanceOf(RateLimitError);
    expect(err.message).toBe('Slow down');
    expect((err as RateLimitError).retryAfter).toBe(30);
  });

  it('maps 400 with POLICY_VIOLATION code to PolicyViolationError', () => {
    const err = createErrorFromResponse({
      status: 400,
      body: { code: 'POLICY_VIOLATION', message: 'Blocked by policy', policyId: 'pol_123', rule: 'no-large-tx' },
    });
    expect(err).toBeInstanceOf(PolicyViolationError);
    expect(err.message).toBe('Blocked by policy');
    expect((err as PolicyViolationError).policyId).toBe('pol_123');
    expect((err as PolicyViolationError).rule).toBe('no-large-tx');
  });

  it('maps 400 with INSUFFICIENT_FUNDS code to InsufficientFundsError', () => {
    const err = createErrorFromResponse({
      status: 400,
      body: { code: 'INSUFFICIENT_FUNDS', message: 'Not enough balance' },
    });
    expect(err).toBeInstanceOf(InsufficientFundsError);
    expect(err.message).toBe('Not enough balance');
  });

  it('maps BUDGET_EXCEEDED and APPROVAL_REQUIRED', () => {
    const err1 = createErrorFromResponse({
      status: 422,
      body: { code: 'BUDGET_EXCEEDED', message: 'Budget blown' },
    });
    expect(err1).toBeInstanceOf(BudgetExceededError);

    const err2 = createErrorFromResponse({
      status: 422,
      body: { code: 'APPROVAL_REQUIRED', message: 'Need signoff' },
    });
    expect(err2).toBeInstanceOf(ApprovalRequiredError);
  });

  it('maps standard status codes correctly', () => {
    expect(createErrorFromResponse({ status: 401, body: { message: 'Unauthorized' } })).toBeInstanceOf(AuthenticationError);
    expect(createErrorFromResponse({ status: 403, body: { message: 'Forbidden' } })).toBeInstanceOf(ForbiddenError);
    expect(createErrorFromResponse({ status: 404, body: { message: 'Not Found' } })).toBeInstanceOf(NotFoundError);
    expect(createErrorFromResponse({ status: 409, body: { message: 'Conflict' } })).toBeInstanceOf(ConflictError);
    expect(createErrorFromResponse({ status: 400, body: { message: 'Bad request' } })).toBeInstanceOf(ValidationError);
    expect(createErrorFromResponse({ status: 500, body: { message: 'Error' } })).toBeInstanceOf(InternalServerError);
    expect(createErrorFromResponse({ status: 418, body: { message: 'Tea' } })).toBeInstanceOf(ApiError);
  });
});

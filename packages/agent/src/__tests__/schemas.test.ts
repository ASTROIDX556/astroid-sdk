import { describe, expect, it, vi } from 'vitest';

import { AgentStatus } from '@astroid/types';

import { AstroidValidationError } from '../errors.js';
import { AgentResource } from '../agent.js';
import {
  AgentQueryParamsSchema,
  CreateAgentParamsSchema,
  assertValidAgentQueryParams,
  parseAgentQueryParams,
  parseCreateAgentParams,
  parseUpdateAgentParams,
} from '../schemas.js';

const VALID_CREATE = {
  name: 'TradingBot',
  capabilities: ['swap'],
  initialBudget: { currency: 'USDC', amount: '500' },
};

/** Narrow a thrown unknown value to the field-addressed validation error. */
function asValidationError(error: unknown): AstroidValidationError {
  expect(error).toBeInstanceOf(AstroidValidationError);
  return error as AstroidValidationError;
}

describe('agent Zod schemas (issue #527)', () => {
  describe('CreateAgentParamsSchema', () => {
    it('accepts a minimal valid creation payload', () => {
      expect(CreateAgentParamsSchema.safeParse(VALID_CREATE).success).toBe(true);
      expect(parseCreateAgentParams(VALID_CREATE)).toEqual(VALID_CREATE);
    });

    it('rejects a blank name and points at the field', () => {
      let caught: unknown;
      try {
        parseCreateAgentParams({ ...VALID_CREATE, name: '  ' });
      } catch (error) {
        caught = error;
      }
      const validationError = asValidationError(caught);
      expect(validationError.message).toMatch(/name/);
      expect(validationError.details?.['field']).toBe('name');
      expect(validationError.code).toBe('ASTROID_VALIDATION_ERROR');
    });

    it('rejects an empty capability list', () => {
      let caught: unknown;
      try {
        parseCreateAgentParams({ ...VALID_CREATE, capabilities: [] });
      } catch (error) {
        caught = error;
      }
      const validationError = asValidationError(caught);
      expect(validationError.message).toMatch(/capabilities/);
      expect(validationError.details?.['field']).toBe('capabilities');
    });

    it('rejects an invalid budget amount at the nested field path', () => {
      let caught: unknown;
      try {
        parseCreateAgentParams({
          ...VALID_CREATE,
          initialBudget: { currency: 'USDC', amount: '-5' },
        });
      } catch (error) {
        caught = error;
      }
      const validationError = asValidationError(caught);
      expect(validationError.details?.['field']).toBe('initialBudget.amount');
    });

    it('rejects a malformed metadata Stellar address', () => {
      let caught: unknown;
      try {
        parseCreateAgentParams({
          ...VALID_CREATE,
          metadata: { stellarAddress: 'GABC' },
        });
      } catch (error) {
        caught = error;
      }
      const validationError = asValidationError(caught);
      expect(validationError.details?.['field']).toBe('metadata.stellarAddress');
    });
  });

  describe('UpdateAgentParamsSchema', () => {
    it('accepts a single-field update', () => {
      expect(parseUpdateAgentParams({ status: AgentStatus.PAUSED })).toEqual({
        status: AgentStatus.PAUSED,
      });
    });

    it('rejects an empty update payload', () => {
      let caught: unknown;
      try {
        parseUpdateAgentParams({});
      } catch (error) {
        caught = error;
      }
      const validationError = asValidationError(caught);
      expect(validationError.details?.['field']).toBe('(root)');
      expect(validationError.message).toMatch(/at least one/i);
    });

    it('rejects an invalid status enum value', () => {
      let caught: unknown;
      try {
        parseUpdateAgentParams({ status: 'BOGUS' });
      } catch (error) {
        caught = error;
      }
      const validationError = asValidationError(caught);
      expect(validationError.details?.['field']).toBe('status');
    });
  });

  describe('AgentQueryParamsSchema', () => {
    it('accepts pagination and filter parameters', () => {
      const parsed = parseAgentQueryParams({
        page: 2,
        limit: 50,
        status: AgentStatus.ACTIVE,
        tag: 'treasury',
        search: 'bot',
      });
      expect(parsed).toEqual({
        page: 2,
        limit: 50,
        status: 'ACTIVE',
        tag: 'treasury',
        search: 'bot',
      });
    });

    it('treats missing parameters as an empty query', () => {
      expect(parseAgentQueryParams(undefined)).toEqual({});
      expect(AgentQueryParamsSchema.safeParse({}).success).toBe(true);
    });

    it('rejects a non-positive page or limit', () => {
      for (const params of [{ page: 0 }, { limit: -1 }, { limit: 1.5 }]) {
        expect(() => parseAgentQueryParams(params)).toThrow(AstroidValidationError);
      }
    });

    it('rejects an unknown status with a field-addressed error', () => {
      let caught: unknown;
      try {
        parseAgentQueryParams({ status: 'SLEEPING' });
      } catch (error) {
        caught = error;
      }
      expect(asValidationError(caught).details?.['field']).toBe('status');
    });

    it('rejects supplying both page and cursor', () => {
      let caught: unknown;
      try {
        parseAgentQueryParams({ page: 1, cursor: 'cur_1' });
      } catch (error) {
        caught = error;
      }
      expect(asValidationError(caught).details?.['field']).toBe('cursor');
    });

    it('exposes an assertion helper', () => {
      expect(() => assertValidAgentQueryParams({ limit: 10 })).not.toThrow();
      expect(() => assertValidAgentQueryParams({ limit: 0 })).toThrow(AstroidValidationError);
    });
  });

  describe('resource integration', () => {
    function createClientMock() {
      return { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() };
    }

    it('rejects invalid list query parameters before any request is sent', async () => {
      const http = createClientMock();
      const resource = new AgentResource(http as never);

      await expect(resource.list({ limit: 0 })).rejects.toBeInstanceOf(AstroidValidationError);
      expect(http.get).not.toHaveBeenCalled();
    });

    it('still validates create payloads before posting', async () => {
      const http = createClientMock();
      const resource = new AgentResource(http as never);

      await expect(
        resource.create({ name: '', capabilities: [], initialBudget: { currency: '', amount: '' } }),
      ).rejects.toBeInstanceOf(AstroidValidationError);
      expect(http.post).not.toHaveBeenCalled();
    });
  });
});

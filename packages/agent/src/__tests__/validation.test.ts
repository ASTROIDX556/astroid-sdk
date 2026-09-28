import { describe, expect, it } from 'vitest';

import { AgentRole, AgentStatus } from '@astroid/types';

import { AstroidValidationError } from '../errors.js';
import {
  assertValidAgentId,
  isValidAgentId,
  isValidAmountString,
  isValidCreateAgentParams,
  isValidStellarPublicKey,
  isValidUpdateAgentParams,
  validateCreateAgentParams,
  validateUpdateAgentParams,
} from '../validation.js';

/** A format-valid Stellar public key (`G` + 55 base-32 characters). */
const VALID_ADDRESS = `G${'A'.repeat(55)}`;

/** A minimal valid create payload, spread as the base of most cases. */
const VALID_CREATE = {
  name: 'TradingBot',
  capabilities: ['swap', 'arbitrage'],
  initialBudget: { currency: 'USDC', amount: '500' },
};

/** Narrow an unknown thrown value to the validation error for assertions. */
function asValidationError(error: unknown): AstroidValidationError {
  expect(error).toBeInstanceOf(AstroidValidationError);
  const validationError = error as AstroidValidationError;
  expect(validationError.name).toBe('AstroidValidationError');
  expect(validationError.code).toBe('ASTROID_VALIDATION_ERROR');
  expect(validationError.status).toBe(400);
  return validationError;
}

/** Assert `fn` throws a validation error whose message mentions `pattern`. */
function expectFieldError(fn: () => void, pattern: RegExp): AstroidValidationError {
  let caught: unknown;
  try {
    fn();
  } catch (error) {
    caught = error;
  }
  const validationError = asValidationError(caught);
  expect(validationError.message).toMatch(pattern);
  return validationError;
}

/* ========================================================================== */
/* CreateAgentDto                                                              */
/* ========================================================================== */

describe('Agent validation schemas', () => {
  describe('validateCreateAgentParams', () => {
    it('accepts a valid agent creation payload', () => {
      const validPayload = {
        name: 'TradingBot',
        capabilities: ['swap', 'arbitrage'],
        initialBudget: {
          currency: 'USDC',
          amount: '500',
        },
      };

      expect(() => validateCreateAgentParams(validPayload)).not.toThrow();
      expect(isValidCreateAgentParams(validPayload)).toBe(true);
    });

    it('accepts a fully-populated payload with every optional field', () => {
      expect(() =>
        validateCreateAgentParams({
          ...VALID_CREATE,
          description: 'A fully-configured agent',
          role: AgentRole.OPERATIONS,
          provider: 'anthropic',
          model: 'claude-sonnet-5',
          primaryWalletId: 'wal_123',
          metadata: { team: 'ops', tags: ['prod'], stellarAddress: VALID_ADDRESS },
        }),
      ).not.toThrow();
    });

    it('throws AstroidValidationError when payload is not an object', () => {
      expect(() => validateCreateAgentParams(null)).toThrow(AstroidValidationError);
      expect(() => validateCreateAgentParams('not-an-object')).toThrow(AstroidValidationError);
      expect(() => validateCreateAgentParams(undefined)).toThrow(AstroidValidationError);
      // Arrays and primitives are objects/values but never valid payloads.
      expect(isValidCreateAgentParams([VALID_CREATE])).toBe(false);
      expect(isValidCreateAgentParams(42)).toBe(false);
      expect(isValidCreateAgentParams(undefined)).toBe(false);
    });

    it('reports the payload root problem without a field key', () => {
      const error = expectFieldError(() => validateCreateAgentParams(null), /non-null object/);
      expect(error.details?.['received']).toBe('null');
    });

    it('validates required name field', () => {
      const missingName = {
        capabilities: ['swap'],
        initialBudget: { currency: 'USDC', amount: '100' },
      };

      expect(() => validateCreateAgentParams(missingName)).toThrowError(/name/i);
      expect(isValidCreateAgentParams({ ...missingName, name: '' })).toBe(false);
      expect(isValidCreateAgentParams({ ...missingName, name: '   ' })).toBe(false);
      expect(isValidCreateAgentParams({ ...missingName, name: 123 })).toBe(false);
      expect(isValidCreateAgentParams({ ...missingName, name: null })).toBe(false);
    });

    it('identifies the offending name field in the error details', () => {
      const error = expectFieldError(
        () => validateCreateAgentParams({ ...VALID_CREATE, name: '' }),
        /"name" is required/,
      );
      expect(error.details?.['field']).toBe('name');
    });

    it('validates required capabilities field', () => {
      const missingCaps = {
        name: 'Bot',
        initialBudget: { currency: 'USDC', amount: '100' },
      };

      expect(() => validateCreateAgentParams(missingCaps)).toThrowError(/capabilities/i);
      expect(isValidCreateAgentParams({ ...missingCaps, capabilities: [] })).toBe(false);
      expect(isValidCreateAgentParams({ ...missingCaps, capabilities: ['valid', 123] })).toBe(
        false,
      );
      expect(isValidCreateAgentParams({ ...missingCaps, capabilities: 'swap' })).toBe(false);
      expect(isValidCreateAgentParams({ ...missingCaps, capabilities: { 0: 'swap' } })).toBe(false);
      expect(isValidCreateAgentParams({ ...missingCaps, capabilities: [''] })).toBe(false);
      expect(isValidCreateAgentParams({ ...missingCaps, capabilities: ['  '] })).toBe(false);
      expect(isValidCreateAgentParams({ ...missingCaps, capabilities: [null] })).toBe(false);
    });

    it('points at the index of the invalid capability', () => {
      const error = expectFieldError(
        () => validateCreateAgentParams({ ...VALID_CREATE, capabilities: ['swap', 42] }),
        /"capabilities\[1\]"/,
      );
      expect(error.details?.['field']).toBe('capabilities[1]');
    });

    it('validates required initialBudget field and nested properties', () => {
      const missingBudget = {
        name: 'Bot',
        capabilities: ['swap'],
      };

      expect(() => validateCreateAgentParams(missingBudget)).toThrowError(/initialBudget/i);
      expect(isValidCreateAgentParams({ ...missingBudget, initialBudget: {} })).toBe(false);
      expect(
        isValidCreateAgentParams({
          ...missingBudget,
          initialBudget: { currency: '', amount: '100' },
        }),
      ).toBe(false);
      expect(
        isValidCreateAgentParams({
          ...missingBudget,
          initialBudget: { currency: 'USDC', amount: '' },
        }),
      ).toBe(false);
      expect(
        isValidCreateAgentParams({
          ...missingBudget,
          initialBudget: { currency: 'USDC', amount: 'invalid-number' },
        }),
      ).toBe(false);
      expect(
        isValidCreateAgentParams({
          ...missingBudget,
          initialBudget: { currency: 'USDC', amount: '-50' },
        }),
      ).toBe(false);
    });

    it('rejects a non-object initialBudget', () => {
      for (const budget of [null, 'USDC:100', 100, ['USDC', '100']]) {
        expect(isValidCreateAgentParams({ ...VALID_CREATE, initialBudget: budget })).toBe(false);
      }
    });

    it('rejects amounts that only coerce to a number', () => {
      // Number() would accept all of these; the API would not.
      for (const amount of [
        'Infinity',
        '-Infinity',
        'NaN',
        '0x10',
        '1e3',
        '10 20',
        '5.',
        '.5',
        '+5',
      ]) {
        expect(
          isValidCreateAgentParams({
            ...VALID_CREATE,
            initialBudget: { currency: 'USDC', amount },
          }),
          `amount "${amount}" must be rejected`,
        ).toBe(false);
      }
    });

    it('accepts plain decimal amount strings, including zero', () => {
      for (const amount of ['0', '500', '1000.00', '0.000001']) {
        expect(
          isValidCreateAgentParams({
            ...VALID_CREATE,
            initialBudget: { currency: 'USDC', amount },
          }),
          `amount "${amount}" must be accepted`,
        ).toBe(true);
      }
    });
  });

  describe('isValidStellarPublicKey', () => {
    it('accepts a format-valid Stellar public key', () => {
      expect(isValidStellarPublicKey(VALID_ADDRESS)).toBe(true);
      expect(isValidStellarPublicKey(`  ${VALID_ADDRESS}  `)).toBe(true);
    });

    it('rejects malformed keys and non-strings', () => {
      expect(isValidStellarPublicKey('')).toBe(false);
      expect(isValidStellarPublicKey('GABC')).toBe(false);
      expect(isValidStellarPublicKey(`S${'A'.repeat(55)}`)).toBe(false); // wrong prefix
      expect(isValidStellarPublicKey(`G${'a'.repeat(55)}`)).toBe(false); // lowercase base32
      expect(isValidStellarPublicKey(`G${'A'.repeat(54)}`)).toBe(false); // too short
      expect(isValidStellarPublicKey(`G${'A'.repeat(56)}`)).toBe(false); // too long
      expect(isValidStellarPublicKey(undefined)).toBe(false);
      expect(isValidStellarPublicKey(123)).toBe(false);
    });
  });

  describe('isValidAmountString', () => {
    it('accepts non-negative decimal strings', () => {
      expect(isValidAmountString('0')).toBe(true);
      expect(isValidAmountString('1000.00')).toBe(true);
      expect(isValidAmountString(' 42 ')).toBe(true);
    });

    it('rejects anything that is not a plain non-negative decimal', () => {
      expect(isValidAmountString('')).toBe(false);
      expect(isValidAmountString('-1')).toBe(false);
      expect(isValidAmountString('1e3')).toBe(false);
      expect(isValidAmountString('Infinity')).toBe(false);
      expect(isValidAmountString('0x10')).toBe(false);
      expect(isValidAmountString(100)).toBe(false);
      expect(isValidAmountString(null)).toBe(false);
    });
  });

  describe('isValidAgentId / assertValidAgentId', () => {
    it('accepts any non-blank string', () => {
      expect(isValidAgentId('agt_1')).toBe(true);
      expect(isValidAgentId('agt/special')).toBe(true);
      expect(() => assertValidAgentId('agt_1')).not.toThrow();
    });

    it('rejects blank ids and non-strings', () => {
      expect(isValidAgentId('')).toBe(false);
      expect(isValidAgentId('   ')).toBe(false);
      expect(isValidAgentId(undefined)).toBe(false);
      expect(isValidAgentId(42)).toBe(false);
      expect(() => assertValidAgentId('')).toThrow(AstroidValidationError);
    });
  });

  describe('Stellar address validation in the creation payload', () => {
    it('accepts a valid top-level stellarAddress', () => {
      expect(() =>
        validateCreateAgentParams({ ...VALID_CREATE, stellarAddress: VALID_ADDRESS }),
      ).not.toThrow();
    });

    it('accepts a valid metadata.stellarAddress', () => {
      expect(() =>
        validateCreateAgentParams({
          ...VALID_CREATE,
          metadata: { team: 'ops', stellarAddress: VALID_ADDRESS },
        }),
      ).not.toThrow();
    });

    it('throws a descriptive error for an invalid top-level stellarAddress', () => {
      expect(() =>
        validateCreateAgentParams({ ...VALID_CREATE, stellarAddress: 'not-an-address' }),
      ).toThrowError(/stellarAddress/);
      expect(isValidCreateAgentParams({ ...VALID_CREATE, stellarAddress: 'GABC' })).toBe(false);
    });

    it('throws a descriptive error for an invalid metadata.stellarAddress', () => {
      try {
        validateCreateAgentParams({
          ...VALID_CREATE,
          metadata: { stellarAddress: 'GABC' },
        });
        expect.unreachable('expected validation to throw');
      } catch (error) {
        expect(asValidationError(error).message).toContain('metadata.stellarAddress');
      }
    });

    it('rejects a non-object metadata value', () => {
      expect(isValidCreateAgentParams({ ...VALID_CREATE, metadata: 'nope' })).toBe(false);
      expect(isValidCreateAgentParams({ ...VALID_CREATE, metadata: ['nope'] })).toBe(false);
      expect(isValidCreateAgentParams({ ...VALID_CREATE, metadata: null })).toBe(false);
    });

    it('validates typed metadata keys while passing unknown keys through', () => {
      expect(isValidCreateAgentParams({ ...VALID_CREATE, metadata: { anything: [1, 2, 3] } })).toBe(
        true,
      );
      expect(isValidCreateAgentParams({ ...VALID_CREATE, metadata: { tags: 'prod' } })).toBe(false);
      expect(isValidCreateAgentParams({ ...VALID_CREATE, metadata: { tags: [1] } })).toBe(false);
      expect(isValidCreateAgentParams({ ...VALID_CREATE, metadata: { tags: [''] } })).toBe(false);
    });

    it('validates an optional primaryWalletId', () => {
      expect(isValidCreateAgentParams({ ...VALID_CREATE, primaryWalletId: 'wallet_123' })).toBe(
        true,
      );
      expect(isValidCreateAgentParams({ ...VALID_CREATE, primaryWalletId: '' })).toBe(false);
      expect(isValidCreateAgentParams({ ...VALID_CREATE, primaryWalletId: 42 })).toBe(false);
    });
  });

  describe('optional free-form fields in the creation payload', () => {
    it('validates role against the AgentRole enum', () => {
      expect(isValidCreateAgentParams({ ...VALID_CREATE, role: AgentRole.FINANCE })).toBe(true);
      expect(isValidCreateAgentParams({ ...VALID_CREATE, role: 'finance' })).toBe(false);
      expect(isValidCreateAgentParams({ ...VALID_CREATE, role: 'BOGUS' })).toBe(false);
      expect(isValidCreateAgentParams({ ...VALID_CREATE, role: 42 })).toBe(false);
    });

    it('requires description to be a string when provided', () => {
      expect(isValidCreateAgentParams({ ...VALID_CREATE, description: 'does things' })).toBe(true);
      expect(isValidCreateAgentParams({ ...VALID_CREATE, description: 123 })).toBe(false);
      expect(isValidCreateAgentParams({ ...VALID_CREATE, description: null })).toBe(false);
    });

    it('requires provider and model to be non-empty strings when provided', () => {
      expect(isValidCreateAgentParams({ ...VALID_CREATE, provider: 'anthropic' })).toBe(true);
      expect(isValidCreateAgentParams({ ...VALID_CREATE, model: 'claude-sonnet-5' })).toBe(true);
      expect(isValidCreateAgentParams({ ...VALID_CREATE, provider: '' })).toBe(false);
      expect(isValidCreateAgentParams({ ...VALID_CREATE, model: '  ' })).toBe(false);
      expect(isValidCreateAgentParams({ ...VALID_CREATE, provider: 12 })).toBe(false);
    });

    it('explains an invalid role with the list of valid values', () => {
      const error = expectFieldError(
        () => validateCreateAgentParams({ ...VALID_CREATE, role: 'BOGUS' }),
        /FINANCE/,
      );
      expect(error.details?.['field']).toBe('role');
      expect(error.details?.['expected']).toBe('AgentRole');
    });
  });
});

/* ========================================================================== */
/* UpdateAgentDto                                                              */
/* ========================================================================== */

describe('UpdateAgentDto validation', () => {
  describe('validateUpdateAgentParams', () => {
    it('accepts a single-field partial update', () => {
      expect(() => validateUpdateAgentParams({ name: 'RenamedBot' })).not.toThrow();
      expect(isValidUpdateAgentParams({ status: AgentStatus.PAUSED })).toBe(true);
      expect(isValidUpdateAgentParams({ capabilities: ['trade'] })).toBe(true);
      expect(isValidUpdateAgentParams({ metadata: { team: 'ops' } })).toBe(true);
    });

    it('accepts a fully-populated update payload', () => {
      expect(() =>
        validateUpdateAgentParams({
          name: 'RenamedBot',
          description: 'Updated description',
          role: AgentRole.RESEARCH,
          provider: 'anthropic',
          model: 'claude-sonnet-5',
          capabilities: ['trade', 'transfer'],
          status: AgentStatus.ACTIVE,
          primaryWalletId: 'wal_123',
          metadata: { team: 'ops', tags: ['prod'], stellarAddress: VALID_ADDRESS },
        }),
      ).not.toThrow();
    });

    it('throws AstroidValidationError when payload is not an object', () => {
      expect(() => validateUpdateAgentParams(null)).toThrow(AstroidValidationError);
      expect(() => validateUpdateAgentParams('not-an-object')).toThrow(AstroidValidationError);
      expect(() => validateUpdateAgentParams(undefined)).toThrow(AstroidValidationError);
      expect(isValidUpdateAgentParams([{ name: 'x' }])).toBe(false);
      expect(isValidUpdateAgentParams(null)).toBe(false);
    });

    it('rejects an empty no-op patch', () => {
      const error = expectFieldError(() => validateUpdateAgentParams({}), /at least one of/);
      expect(error.message).toContain('capabilities');
      expect(isValidUpdateAgentParams({})).toBe(false);
    });

    it('treats a payload of only-undefined fields as empty', () => {
      expect(isValidUpdateAgentParams({ name: undefined })).toBe(false);
      expect(isValidUpdateAgentParams({ unknownField: 'x' })).toBe(false);
    });

    it('validates the name field', () => {
      expect(isValidUpdateAgentParams({ name: '' })).toBe(false);
      expect(isValidUpdateAgentParams({ name: '   ' })).toBe(false);
      expect(isValidUpdateAgentParams({ name: 42 })).toBe(false);
      expect(isValidUpdateAgentParams({ name: null })).toBe(false);
    });

    it('validates the capabilities field when present', () => {
      expect(isValidUpdateAgentParams({ capabilities: [] })).toBe(false);
      expect(isValidUpdateAgentParams({ capabilities: 'trade' })).toBe(false);
      expect(isValidUpdateAgentParams({ capabilities: ['trade', 1] })).toBe(false);
      expect(isValidUpdateAgentParams({ capabilities: ['trade', '  '] })).toBe(false);
      expect(isValidUpdateAgentParams({ capabilities: ['trade', 'transfer'] })).toBe(true);
    });

    it('validates role against the AgentRole enum', () => {
      expect(isValidUpdateAgentParams({ role: AgentRole.PROCUREMENT })).toBe(true);
      expect(isValidUpdateAgentParams({ role: 'BOGUS' })).toBe(false);
      expect(isValidUpdateAgentParams({ role: 1 })).toBe(false);
    });

    it('validates status against the AgentStatus enum', () => {
      for (const status of Object.values(AgentStatus)) {
        expect(isValidUpdateAgentParams({ status }), `status ${status}`).toBe(true);
      }
      expect(isValidUpdateAgentParams({ status: 'BOGUS' })).toBe(false);
      expect(isValidUpdateAgentParams({ status: 'active' })).toBe(false);
      expect(isValidUpdateAgentParams({ status: 1 })).toBe(false);
    });

    it('allows null primaryWalletId to detach the wallet', () => {
      expect(isValidUpdateAgentParams({ primaryWalletId: null })).toBe(true);
      expect(isValidUpdateAgentParams({ primaryWalletId: 'wal_1' })).toBe(true);
      expect(isValidUpdateAgentParams({ primaryWalletId: '' })).toBe(false);
      expect(isValidUpdateAgentParams({ primaryWalletId: 42 })).toBe(false);
    });

    it('validates the metadata field', () => {
      expect(isValidUpdateAgentParams({ metadata: {} })).toBe(true);
      expect(isValidUpdateAgentParams({ metadata: { team: 'ops' } })).toBe(true);
      expect(isValidUpdateAgentParams({ metadata: 'nope' })).toBe(false);
      expect(isValidUpdateAgentParams({ metadata: null })).toBe(false);
      expect(isValidUpdateAgentParams({ metadata: { stellarAddress: 'GABC' } })).toBe(false);
      expect(isValidUpdateAgentParams({ metadata: { tags: [''] } })).toBe(false);
    });

    it('requires description to be a string when provided', () => {
      expect(isValidUpdateAgentParams({ description: 'updated' })).toBe(true);
      expect(isValidUpdateAgentParams({ description: 42 })).toBe(false);
    });

    it('requires provider and model to be non-empty strings when provided', () => {
      expect(isValidUpdateAgentParams({ provider: '' })).toBe(false);
      expect(isValidUpdateAgentParams({ model: '' })).toBe(false);
      expect(isValidUpdateAgentParams({ model: 5 })).toBe(false);
    });

    it('reports the offending field and expected type', () => {
      const error = expectFieldError(
        () => validateUpdateAgentParams({ status: 'BOGUS' }),
        /valid agent status/,
      );
      expect(error.details?.['field']).toBe('status');
      expect(error.details?.['expected']).toBe('AgentStatus');
      expect(error.details?.['received']).toBe('BOGUS');
    });
  });
});

import { describe, expect, it } from 'vitest';
import {
  validateCreateAgentParams,
  isValidCreateAgentParams,
  isValidStellarPublicKey,
} from '../validation.js';
import { AstroidValidationError } from '../errors.js';

/** A format-valid Stellar public key (`G` + 55 base-32 characters). */
const VALID_ADDRESS = `G${'A'.repeat(55)}`;

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

    it('throws AstroidValidationError when payload is not an object', () => {
      expect(() => validateCreateAgentParams(null)).toThrow(AstroidValidationError);
      expect(() => validateCreateAgentParams('not-an-object')).toThrow(AstroidValidationError);
      expect(isValidCreateAgentParams(undefined)).toBe(false);
    });

    it('validates required name field', () => {
      const missingName = {
        capabilities: ['swap'],
        initialBudget: { currency: 'USDC', amount: '100' },
      };

      expect(() => validateCreateAgentParams(missingName)).toThrowError(/name/i);
      expect(isValidCreateAgentParams({ ...missingName, name: '' })).toBe(false);
      expect(isValidCreateAgentParams({ ...missingName, name: 123 })).toBe(false);
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

  describe('Stellar address validation in the creation payload', () => {
    const basePayload = {
      name: 'TradingBot',
      capabilities: ['swap'],
      initialBudget: { currency: 'USDC', amount: '500' },
    };

    it('accepts a valid top-level stellarAddress', () => {
      expect(() =>
        validateCreateAgentParams({ ...basePayload, stellarAddress: VALID_ADDRESS }),
      ).not.toThrow();
    });

    it('accepts a valid metadata.stellarAddress', () => {
      expect(() =>
        validateCreateAgentParams({
          ...basePayload,
          metadata: { team: 'ops', stellarAddress: VALID_ADDRESS },
        }),
      ).not.toThrow();
    });

    it('throws a descriptive error for an invalid top-level stellarAddress', () => {
      expect(() =>
        validateCreateAgentParams({ ...basePayload, stellarAddress: 'not-an-address' }),
      ).toThrowError(/stellarAddress/);
      expect(isValidCreateAgentParams({ ...basePayload, stellarAddress: 'GABC' })).toBe(false);
    });

    it('throws a descriptive error for an invalid metadata.stellarAddress', () => {
      try {
        validateCreateAgentParams({
          ...basePayload,
          metadata: { stellarAddress: 'GABC' },
        });
        expect.unreachable('expected validation to throw');
      } catch (error) {
        expect(error).toBeInstanceOf(AstroidValidationError);
        expect((error as Error).message).toContain('metadata.stellarAddress');
      }
    });

    it('rejects a non-object metadata value', () => {
      expect(isValidCreateAgentParams({ ...basePayload, metadata: 'nope' })).toBe(false);
      expect(isValidCreateAgentParams({ ...basePayload, metadata: ['nope'] })).toBe(false);
    });

    it('validates an optional primaryWalletId', () => {
      expect(isValidCreateAgentParams({ ...basePayload, primaryWalletId: 'wallet_123' })).toBe(
        true,
      );
      expect(isValidCreateAgentParams({ ...basePayload, primaryWalletId: '' })).toBe(false);
      expect(isValidCreateAgentParams({ ...basePayload, primaryWalletId: 42 })).toBe(false);
    });
  });
});

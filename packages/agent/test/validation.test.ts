import { describe, expect, it } from 'vitest';
import { ValidationError, AstroidError } from '@astroid/errors';
import {
  AstroidValidationError,
  isValidAgentConfig,
  validateAgentConfig,
} from '../src/index.js';

describe('validateAgentConfig — input validation and helper utilities (#462)', () => {
  const validMinimalConfig = {
    name: 'TradingBot',
    capabilities: ['swap', 'liquidity'],
    initialBudget: {
      currency: 'USDC',
      amount: '500.00',
    },
  };

  const sampleStellarAddress = `G${'A'.repeat(51)}`;

  const validFullConfig = {
    name: 'ArbitrageBot',
    description: 'Autonomous arbitrage runner across Stellar DEX pairs',
    capabilities: ['dex_arbitrage', 'order_routing'],
    initialBudget: {
      currency: 'XLM',
      amount: '10000.50',
    },
    role: 'FINANCE' as const,
    status: 'ACTIVE' as const,
    provider: 'anthropic',
    model: 'claude-3-7-sonnet',
    stellarAddress: sampleStellarAddress,
    publicKey: sampleStellarAddress,
    primaryWalletId: 'wal_primary_123',
    policies: ['pol_max_slippage', 'pol_daily_limit'],
    metadata: {
      team: 'quant-trading',
      externalId: 'ext_agent_99',
      tags: ['production', 'high-frequency'],
      stellarAddress: sampleStellarAddress,
    },
  };

  it('validates a valid minimal agent configuration without throwing', () => {
    expect(() => validateAgentConfig(validMinimalConfig)).not.toThrow();
    expect(isValidAgentConfig(validMinimalConfig)).toBe(true);
  });

  it('validates a comprehensive agent configuration with all metadata and key fields', () => {
    expect(() => validateAgentConfig(validFullConfig)).not.toThrow();
    expect(isValidAgentConfig(validFullConfig)).toBe(true);
  });

  it('is pure and side-effect free: does not mutate the input object', () => {
    const inputCopy = JSON.parse(JSON.stringify(validFullConfig));
    const frozenInput = Object.freeze({ ...validFullConfig });

    expect(() => validateAgentConfig(frozenInput)).not.toThrow();
    expect(frozenInput).toEqual(inputCopy);
  });

  describe('required fields validation', () => {
    it('throws when root config is not a plain object', () => {
      expect(() => validateAgentConfig(null)).toThrow(ValidationError);
      expect(() => validateAgentConfig('not an object')).toThrow(ValidationError);
      expect(() => validateAgentConfig([])).toThrow(ValidationError);
      expect(isValidAgentConfig(null)).toBe(false);
    });

    it('throws when name is missing or blank', () => {
      expect(() => validateAgentConfig({ ...validMinimalConfig, name: '' })).toThrow(
        AstroidValidationError,
      );
      expect(() => validateAgentConfig({ ...validMinimalConfig, name: '   ' })).toThrow(
        ValidationError,
      );
      const withoutName = { ...validMinimalConfig };
      delete (withoutName as Record<string, unknown>).name;
      expect(() => validateAgentConfig(withoutName)).toThrow(AstroidValidationError);
    });

    it('throws when capabilities is missing, empty, or contains invalid strings', () => {
      expect(() => validateAgentConfig({ ...validMinimalConfig, capabilities: [] })).toThrow(
        ValidationError,
      );
      expect(() =>
        validateAgentConfig({ ...validMinimalConfig, capabilities: ['valid', ''] }),
      ).toThrow(ValidationError);
      expect(() =>
        validateAgentConfig({ ...validMinimalConfig, capabilities: ['valid', '   '] }),
      ).toThrow(ValidationError);
    });

    it('throws when initialBudget is missing or missing currency', () => {
      expect(() =>
        validateAgentConfig({
          name: 'Bot',
          capabilities: ['trade'],
        }),
      ).toThrow(ValidationError);

      expect(() =>
        validateAgentConfig({
          ...validMinimalConfig,
          initialBudget: { currency: '', amount: '100' },
        }),
      ).toThrow(ValidationError);
    });
  });

  describe('key formats validation', () => {
    it('throws when stellarAddress is not a valid 52-char G-prefixed Stellar public key', () => {
      expect(() =>
        validateAgentConfig({
          ...validMinimalConfig,
          stellarAddress: '0x1234567890abcdef1234567890abcdef12345678', // Ethereum address
        }),
      ).toThrow(ValidationError);

      expect(() =>
        validateAgentConfig({
          ...validMinimalConfig,
          stellarAddress: 'GSHORT',
        }),
      ).toThrow(ValidationError);

      expect(() =>
        validateAgentConfig({
          ...validMinimalConfig,
          stellarAddress: `S${'A'.repeat(51)}`, // S-prefix secret seed
        }),
      ).toThrow(ValidationError);
    });

    it('throws when publicKey is not a valid Stellar public key format', () => {
      expect(() =>
        validateAgentConfig({
          ...validMinimalConfig,
          publicKey: 'invalid_key',
        }),
      ).toThrow(ValidationError);
    });

    it('throws when primaryWalletId is empty or blank', () => {
      expect(() =>
        validateAgentConfig({
          ...validMinimalConfig,
          primaryWalletId: '',
        }),
      ).toThrow(ValidationError);
      expect(() =>
        validateAgentConfig({
          ...validMinimalConfig,
          primaryWalletId: '   ',
        }),
      ).toThrow(ValidationError);
    });
  });

  describe('boundary constraints validation', () => {
    it('throws when initial budget amount is negative, zero, or non-decimal', () => {
      expect(() =>
        validateAgentConfig({
          ...validMinimalConfig,
          initialBudget: { currency: 'USDC', amount: '-10.00' },
        }),
      ).toThrow(ValidationError);

      expect(() =>
        validateAgentConfig({
          ...validMinimalConfig,
          initialBudget: { currency: 'USDC', amount: 'abc' },
        }),
      ).toThrow(ValidationError);

      expect(() =>
        validateAgentConfig({
          ...validMinimalConfig,
          initialBudget: { currency: 'USDC', amount: 'Infinity' },
        }),
      ).toThrow(ValidationError);
    });

    it('throws when role is not a recognized AgentRole enum', () => {
      expect(() =>
        validateAgentConfig({
          ...validMinimalConfig,
          role: 'SUPER_ADMIN' as unknown as 'CUSTOM',
        }),
      ).toThrow(ValidationError);
    });

    it('throws when status is not a recognized AgentStatus enum', () => {
      expect(() =>
        validateAgentConfig({
          ...validMinimalConfig,
          status: 'DESTROYED' as unknown as 'ACTIVE',
        }),
      ).toThrow(ValidationError);
    });

    it('throws when policyIds contains non-string or blank values', () => {
      expect(() =>
        validateAgentConfig({
          ...validMinimalConfig,
          policyIds: ['pol_1', ''],
        }),
      ).toThrow(ValidationError);
    });
  });

  describe('custom error hierarchy integration', () => {
    it('thrown errors are instances of ValidationError and AstroidError with details', () => {
      try {
        validateAgentConfig({ name: '' });
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ValidationError);
        expect(err).toBeInstanceOf(AstroidError);
        expect(err).toBeInstanceOf(AstroidValidationError);
        const valErr = err as AstroidValidationError;
        expect(valErr.statusCode).toBe(400);
        expect(valErr.code).toBe('ASTROID_VALIDATION_ERROR');
        expect(valErr.details?.field).toBe('name');
      }
    });
  });
});

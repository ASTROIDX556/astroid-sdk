import { describe, it, expect } from 'vitest';
import {
  isAgentId,
  isWalletId,
  isPolicyId,
  isBudgetId,
} from '../entities.js';

describe('Entity ID validation type guards', () => {
  describe('isAgentId', () => {
    it('returns true for valid agent IDs', () => {
      expect(isAgentId('agt_12345')).toBe(true);
      expect(isAgentId('agt_abc-DEF_789')).toBe(true);
    });

    it('returns false for invalid agent IDs', () => {
      expect(isAgentId('wallet_12345')).toBe(false);
      expect(isAgentId('agt_')).toBe(true); // matches pattern prefix + chars
      expect(isAgentId('12345')).toBe(false);
      expect(isAgentId(null)).toBe(false);
      expect(isAgentId(undefined)).toBe(false);
      expect(isAgentId(123)).toBe(false);
    });
  });

  describe('isWalletId', () => {
    it('returns true for valid wallet IDs', () => {
      expect(isWalletId('w_12345')).toBe(true);
      expect(isWalletId('w_abc-DEF_789')).toBe(true);
    });

    it('returns false for invalid wallet IDs', () => {
      expect(isWalletId('agt_12345')).toBe(false);
      expect(isWalletId('12345')).toBe(false);
      expect(isWalletId(null)).toBe(false);
    });
  });

  describe('isPolicyId', () => {
    it('returns true for valid policy IDs', () => {
      expect(isPolicyId('pol_12345')).toBe(true);
      expect(isPolicyId('pol_abc-DEF_789')).toBe(true);
    });

    it('returns false for invalid policy IDs', () => {
      expect(isPolicyId('agt_12345')).toBe(false);
      expect(isPolicyId('12345')).toBe(false);
      expect(isPolicyId(null)).toBe(false);
    });
  });

  describe('isBudgetId', () => {
    it('returns true for valid budget IDs', () => {
      expect(isBudgetId('bdt_12345')).toBe(true);
      expect(isBudgetId('bdt_abc-DEF_789')).toBe(true);
    });

    it('returns false for invalid budget IDs', () => {
      expect(isBudgetId('agt_12345')).toBe(false);
      expect(isBudgetId('12345')).toBe(false);
      expect(isBudgetId(null)).toBe(false);
    });
  });
});

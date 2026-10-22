import { describe, expect, it } from 'vitest';

import {
  isValidScopeString,
  matchScope,
  validateScope,
  validateScopes,
} from './scopes.js';

describe('Scope validation helpers — Issue #455', () => {
  describe('isValidScopeString', () => {
    it('validates scope string formats', () => {
      expect(isValidScopeString('wallets:read')).toBe(true);
      expect(isValidScopeString('wallets:*')).toBe(true);
      expect(isValidScopeString('*')).toBe(true);
      expect(isValidScopeString('a:b:c')).toBe(true);

      expect(isValidScopeString('')).toBe(false);
      expect(isValidScopeString(' ')).toBe(false);
      expect(isValidScopeString('wallets: read')).toBe(false);
      expect(isValidScopeString('wallets::read')).toBe(false);
      expect(isValidScopeString('wallets:read:')).toBe(false);
      expect(isValidScopeString(null)).toBe(false);
      expect(isValidScopeString(123)).toBe(false);
    });
  });

  describe('matchScope', () => {
    it('handles exact matches', () => {
      expect(matchScope('wallets:read', 'wallets:read')).toBe(true);
      expect(matchScope('wallets:read', 'wallets:write')).toBe(false);
      expect(matchScope('transactions:create', 'wallets:create')).toBe(false);
    });

    it('handles global wildcards (*)', () => {
      expect(matchScope('*', 'wallets:read')).toBe(true);
      expect(matchScope('*', 'anything:any:action')).toBe(true);
      expect(matchScope('*:*', 'wallets:read')).toBe(true);
    });

    it('handles hierarchical wildcard matches', () => {
      expect(matchScope('wallets:*', 'wallets:read')).toBe(true);
      expect(matchScope('wallets:*', 'wallets:write')).toBe(true);
      expect(matchScope('wallets:*', 'wallets:transfers:create')).toBe(true);
      expect(matchScope('wallets:*', 'agents:read')).toBe(false);
    });

    it('fails closed on malformed inputs', () => {
      expect(matchScope('', 'wallets:read')).toBe(false);
      expect(matchScope('wallets:read', '')).toBe(false);
      expect(matchScope('wallets: read', 'wallets:read')).toBe(false);
    });
  });

  describe('validateScope', () => {
    it('validates single granted scope string or array against required scope', () => {
      expect(validateScope('wallets:read', 'wallets:read')).toBe(true);
      expect(validateScope(['agents:read', 'wallets:*'], 'wallets:write')).toBe(true);
      expect(validateScope(['agents:read'], 'wallets:write')).toBe(false);
    });

    it('fails closed when granted scopes are missing, empty, or null', () => {
      expect(validateScope(undefined, 'wallets:read')).toBe(false);
      expect(validateScope(null, 'wallets:read')).toBe(false);
      expect(validateScope([], 'wallets:read')).toBe(false);
      expect(validateScope('', 'wallets:read')).toBe(false);
    });
  });

  describe('validateScopes', () => {
    it('validates multiple required scopes (all must be satisfied)', () => {
      const granted = ['wallets:*', 'agents:read'];

      expect(validateScopes(granted, ['wallets:read', 'agents:read'])).toBe(true);
      expect(validateScopes(granted, ['wallets:read', 'agents:write'])).toBe(false);
    });

    it('fails closed when inputs are invalid', () => {
      expect(validateScopes(null, ['wallets:read'])).toBe(false);
      expect(validateScopes(['wallets:*'], [])).toBe(false);
    });
  });
});

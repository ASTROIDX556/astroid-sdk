/**
 * Unit tests for the simulation result parser.
 *
 * Covers successful simulations, failed simulations, rule violations,
 * and relevant edge cases.
 */

import { describe, expect, it } from 'vitest';
import { ValidationError } from '@astroid/errors';

import {
  extractViolatedRules,
  isSimulationFailed,
  isSimulationPassed,
  parsePolicyResult,
  parsePolicySimulationResult,
  parseSimulation,
  parseSimulationResult,
} from '../parser.js';

describe('parseSimulationResult', () => {
  describe('successful simulations', () => {
    it('parses a simple allowed result', () => {
      const result = parseSimulationResult({ allowed: true });
      expect(result.passed).toBe(true);
      expect(result.failed).toBe(false);
      expect(result.allowed).toBe(true);
      expect(result.denied).toBe(false);
      expect(result.violatedRules).toEqual([]);
      expect(result.violationCount).toBe(0);
    });

    it('parses a result with passed: true', () => {
      const result = parseSimulationResult({ passed: true });
      expect(result.passed).toBe(true);
      expect(result.allowed).toBe(true);
      expect(result.failed).toBe(false);
    });

    it('parses a result with success: true', () => {
      const result = parseSimulationResult({ success: true });
      expect(result.passed).toBe(true);
      expect(result.failed).toBe(false);
    });

    it('parses PolicySimulationResult format (allowed true, no violations)', () => {
      const result = parseSimulationResult({
        allowed: true,
        violations: [],
        requiredApprovals: [],
        risk: { score: 0.1, band: 'LOW', factors: [] },
        budgetImpact: [],
        explanation: 'All good',
      });
      expect(result.passed).toBe(true);
      expect(result.failed).toBe(false);
      expect(result.violatedRules).toEqual([]);
      expect(result.violationCount).toBe(0);
      expect(result.explanation).toBe('All good');
    });

    it('parses PolicySimulationEvaluation format', () => {
      const result = parseSimulationResult({
        policyId: 'pol_1',
        allowed: true,
        passed: true,
        violatedRules: [],
        riskScore: 0,
        risk: { score: 0, band: 'LOW', factors: [] },
        requiredApprovals: [],
        budgetImpact: [],
        explanation: 'Transaction complies with the policy.',
      });
      expect(result.passed).toBe(true);
      expect(result.allowed).toBe(true);
      expect(result.violatedRules).toEqual([]);
    });
  });

  describe('failed simulations', () => {
    it('parses a simple denied result', () => {
      const result = parseSimulationResult({ allowed: false });
      expect(result.passed).toBe(false);
      expect(result.failed).toBe(true);
      expect(result.allowed).toBe(false);
      expect(result.denied).toBe(true);
    });

    it('parses a result with failed: true', () => {
      const result = parseSimulationResult({ failed: true });
      expect(result.failed).toBe(true);
      expect(result.passed).toBe(false);
    });

    it('parses a result with denied: true', () => {
      const result = parseSimulationResult({ denied: true });
      expect(result.denied).toBe(true);
      expect(result.allowed).toBe(false);
    });

    it('derives failed status from violations when not explicitly set', () => {
      const result = parseSimulationResult({
        violations: [{ rule: 'MAX_AMOUNT', message: 'Amount too high' }],
      });
      expect(result.passed).toBe(false);
      expect(result.failed).toBe(true);
      expect(result.violationCount).toBe(1);
    });
  });

  describe('rule violations', () => {
    it('parses violations array with PolicyViolationDetail format', () => {
      const result = parseSimulationResult({
        allowed: false,
        violations: [
          {
            policyId: 'pol_1',
            policyType: 'MAX_AMOUNT',
            message: 'Amount exceeds limit',
            limit: 1000,
            actual: 1500,
          },
        ],
      });
      expect(result.failed).toBe(true);
      expect(result.violatedRules).toHaveLength(1);
      expect(result.violatedRules[0]?.rule).toBe('MAX_AMOUNT');
      expect(result.violatedRules[0]?.message).toBe('Amount exceeds limit');
      expect(result.violatedRules[0]?.policyId).toBe('pol_1');
      expect(result.violatedRules[0]?.limit).toBe(1000);
      expect(result.violatedRules[0]?.actual).toBe(1500);
    });

    it('parses violatedRules array with PolicyRuleBreach format', () => {
      const result = parseSimulationResult({
        allowed: false,
        violatedRules: [
          {
            policyId: 'pol_2',
            rule: 'BLACKLIST',
            message: 'Recipient is blacklisted',
          },
        ],
      });
      expect(result.violatedRules[0]?.rule).toBe('BLACKLIST');
      expect(result.violatedRules[0]?.policyId).toBe('pol_2');
    });

    it('parses breaches array', () => {
      const result = parseSimulationResult({
        allowed: false,
        breaches: [{ rule: 'RATE_LIMIT', message: 'Too many requests' }],
      });
      expect(result.violationCount).toBe(1);
      expect(result.violatedRules[0]?.rule).toBe('RATE_LIMIT');
    });

    it('parses violatedConstraints array', () => {
      const result = parseSimulationResult({
        valid: false,
        violatedConstraints: [
          {
            rule: 'max-250',
            check: 'address',
            success: false,
            explanation: 'Recipient not allowed',
          },
        ],
      });
      // valid is not directly mapped, but violations should be parsed
      expect(result.violatedRules.length).toBeGreaterThan(0);
    });

    it('parses string violations', () => {
      const result = parseSimulationResult({
        allowed: false,
        violations: ['Transaction exceeds spending limit'],
      });
      expect(result.violatedRules).toHaveLength(1);
      expect(result.violatedRules[0]?.rule).toBe('Transaction exceeds spending limit');
    });

    it('handles multiple violations', () => {
      const result = parseSimulationResult({
        allowed: false,
        violations: [
          { rule: 'RULE1', message: 'First violation' },
          { rule: 'RULE2', message: 'Second violation' },
          { rule: 'RULE3', message: 'Third violation' },
        ],
      });
      expect(result.violationCount).toBe(3);
      expect(result.violatedRules).toHaveLength(3);
    });
  });

  describe('edge cases and safe handling', () => {
    it('throws ValidationError for null', () => {
      expect(() => parseSimulationResult(null)).toThrow(ValidationError);
    });

    it('throws ValidationError for undefined', () => {
      expect(() => parseSimulationResult(undefined)).toThrow(ValidationError);
    });

    it('throws ValidationError for non-object', () => {
      expect(() => parseSimulationResult('string')).toThrow(ValidationError);
      expect(() => parseSimulationResult(123)).toThrow(ValidationError);
      expect(() => parseSimulationResult([])).toThrow(ValidationError);
    });

    it('handles empty object safely', () => {
      const result = parseSimulationResult({});
      expect(result.passed).toBe(true); // defaults to true if no violations
      expect(result.violatedRules).toEqual([]);
    });

    it('handles object with empty violations array', () => {
      const result = parseSimulationResult({ allowed: true, violations: [] });
      expect(result.passed).toBe(true);
      expect(result.violatedRules).toEqual([]);
    });

    it('skips invalid violation entries', () => {
      const result = parseSimulationResult({
        allowed: false,
        violations: [null, undefined, 123, '', { rule: 'VALID', message: 'ok' }],
      });
      expect(result.violatedRules).toHaveLength(1);
      expect(result.violatedRules[0]?.rule).toBe('VALID');
    });

    it('provides default message when missing', () => {
      const result = parseSimulationResult({
        allowed: false,
        violations: [{ rule: 'SOME_RULE' }],
      });
      expect(result.violatedRules[0]?.message).toBeDefined();
      expect(result.explanation).toBeDefined();
    });

    it('handles different naming conventions', () => {
      const result1 = parseSimulationResult({ permitted: true });
      expect(result1.passed).toBe(true);

      const result2 = parseSimulationResult({ permitted: false, violations: [{ rule: 'X' }] });
      expect(result2.failed).toBe(true);

      const result3 = parseSimulationResult({ blocked: true });
      expect(result3.denied).toBe(true);
    });
  });

  describe('aliases', () => {
    it('parsePolicySimulationResult works the same as parseSimulationResult', () => {
      const r1 = parseSimulationResult({ allowed: true });
      const r2 = parsePolicySimulationResult({ allowed: true });
      expect(r1.passed).toBe(r2.passed);
    });

    it('parseSimulation works the same', () => {
      const r1 = parseSimulationResult({ allowed: false, violations: [] });
      const r2 = parseSimulation({ allowed: false, violations: [] });
      expect(r1.passed).toBe(r2.passed);
    });

    it('parsePolicyResult works the same', () => {
      const r = parsePolicyResult({ passed: true });
      expect(r.passed).toBe(true);
    });
  });

  describe('utility functions', () => {
    it('extractViolatedRules returns just the violations', () => {
      const rules = extractViolatedRules({
        allowed: false,
        violations: [{ rule: 'TEST', message: 'test' }],
      });
      expect(rules).toHaveLength(1);
      expect(rules[0]?.rule).toBe('TEST');
    });

    it('isSimulationFailed returns true for failed results', () => {
      expect(isSimulationFailed({ allowed: false })).toBe(true);
      expect(isSimulationFailed({ failed: true })).toBe(true);
      expect(isSimulationFailed({ denied: true })).toBe(true);
    });

    it('isSimulationFailed returns false for passed results', () => {
      expect(isSimulationFailed({ allowed: true })).toBe(false);
    });

    it('isSimulationPassed returns true for passed results', () => {
      expect(isSimulationPassed({ allowed: true })).toBe(true);
      expect(isSimulationPassed({ passed: true })).toBe(true);
    });

    it('isSimulationPassed returns false for failed results', () => {
      expect(isSimulationPassed({ allowed: false, violations: [] })).toBe(false);
    });
  });
});

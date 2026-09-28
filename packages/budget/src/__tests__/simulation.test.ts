import { describe, expect, it } from 'vitest';

import type { Budget } from '@astroid/types';

import {
  isBudgetExpired,
  resolveBudgetRemaining,
  resolveBudgetWindow,
  toBudgetCheckResult,
  validateSimulationRequest,
} from '../simulation.js';

/** Build a monthly USDC budget that starts `daysFromNow` days ago. */
function makeBudget(overrides: Partial<Budget> = {}): Budget {
  const periodStart = new Date(Date.now() - 5 * 86_400_000).toISOString();
  return {
    id: 'bud_sim',
    organizationId: 'org_1',
    name: 'Agent Ops',
    currency: 'USDC',
    period: 'MONTHLY',
    periodStart,
    limitAmount: '1000.00',
    spent: '0.00',
    remaining: '1000.00',
    enabled: true,
    rollover: false,
    createdAt: periodStart,
    updatedAt: periodStart,
    ...overrides,
  };
}

/** A `now` inside the budget's first active window. */
const NOW_IN_WINDOW = new Date(Date.now() - 5 * 86_400_000 + 86_400_000);

describe('validateSimulationRequest', () => {
  describe('passing simulations', () => {
    it('allows a spend within the remaining allowance', () => {
      const budget = makeBudget();
      const result = validateSimulationRequest(
        budget,
        { asset: 'USDC', amount: '250' },
        { now: NOW_IN_WINDOW },
      );

      expect(result.allowed).toBe(true);
      expect(result.wouldExceed).toBe(false);
      expect(result.violations).toEqual([]);
      expect(result.expired).toBe(false);
      // Headroom after the simulated 250 USDC draw.
      expect(result.afterRemaining).toBe('750.00');
      expect(result.state).toBe('healthy');
      expect(result.currency).toBe('USDC');
    });

    it('allows a spend that exactly exhausts the budget', () => {
      const budget = makeBudget({ limitAmount: '500.00', spent: '0.00' });
      const result = validateSimulationRequest(
        budget,
        { asset: 'USDC', amount: '500' },
        { now: NOW_IN_WINDOW },
      );

      expect(result.allowed).toBe(true);
      expect(result.wouldExceed).toBe(false);
      expect(result.afterRemaining).toBe('0.00');
      expect(result.utilizationAfter).toBe(1);
      expect(result.state).toBe('exhausted');
    });
  });

  describe('limit overflows', () => {
    it('rejects a spend larger than the remaining allowance', () => {
      const budget = makeBudget({ limitAmount: '100.00', spent: '80.00', remaining: '20.00' });
      const result = validateSimulationRequest(
        budget,
        { asset: 'USDC', amount: '50' },
        { now: NOW_IN_WINDOW },
      );

      expect(result.allowed).toBe(false);
      expect(result.wouldExceed).toBe(true);
      expect(result.violations).toHaveLength(1);
      const violation = result.violations[0];
      expect(violation?.reason).toBe('LIMIT_OVERFLOW');
      expect(violation?.limit).toBe('100.00');
      expect(violation?.projectedSpend).toBe('130.00');
      expect(violation?.remaining).toBe('20.00');
      // Draw exceeds headroom: clamped at zero.
      expect(result.afterRemaining).toBe('0.00');
    });

    it('reports the state as exhausted after an overflow', () => {
      const budget = makeBudget({ limitAmount: '100.00', spent: '80.00', remaining: '20.00' });
      const result = validateSimulationRequest(
        budget,
        { asset: 'USDC', amount: '50' },
        { now: NOW_IN_WINDOW },
      );

      expect(result.utilizationAfter).toBe(1);
      expect(result.state).toBe('exhausted');
      expect(result.explanation).toContain('would exceed');
    });
  });

  describe('expired budgets', () => {
    it('rejects a spend when the active window has closed', () => {
      // Monthly budget that started 2 windows ago.
      const budget = makeBudget({ periodStart: '2026-01-01T00:00:00.000Z' });
      const result = validateSimulationRequest(
        budget,
        { asset: 'USDC', amount: '10' },
        { now: new Date('2026-09-15T00:00:00.000Z') },
      );

      expect(result.expired).toBe(true);
      expect(result.allowed).toBe(false);
      const violation = result.violations.find((v) => v.reason === 'EXPIRED_BUDGET');
      expect(violation).toBeDefined();
      expect(violation?.expiredAt).toBe('2026-02-01T00:00:00.000Z');
      expect(result.violations.some((v) => v.reason === 'LIMIT_OVERFLOW')).toBe(false);
    });

    it('does not double-report an expired budget as an overflow', () => {
      const budget = makeBudget({ periodStart: '2026-01-01T00:00:00.000Z' });
      const result = validateSimulationRequest(
        budget,
        { asset: 'USDC', amount: '99999' },
        { now: new Date('2026-09-15T00:00:00.000Z') },
      );

      expect(result.expired).toBe(true);
      expect(result.violations.map((v) => v.reason)).toContain('EXPIRED_BUDGET');
    });
  });

  describe('disabled budgets', () => {
    it('rejects any spend on a disabled budget', () => {
      const budget = makeBudget({ enabled: false });
      const result = validateSimulationRequest(
        budget,
        { asset: 'USDC', amount: '10' },
        { now: NOW_IN_WINDOW },
      );

      expect(result.allowed).toBe(false);
      expect(result.violations.map((v) => v.reason)).toContain('DISABLED');
      expect(result.explanation).toContain('disabled');
    });
  });

  describe('multi-asset conversions', () => {
    it('rejects a cross-asset request without a conversion rate', () => {
      const budget = makeBudget();
      const result = validateSimulationRequest(
        budget,
        { asset: 'XLM', amount: '100' },
        { now: NOW_IN_WINDOW },
      );

      expect(result.allowed).toBe(false);
      const violation = result.violations.find((v) => v.reason === 'CURRENCY_MISMATCH');
      expect(violation).toBeDefined();
      expect(violation?.currency).toBe('USDC');
    });

    it('converts a cross-asset request when a rate is supplied', () => {
      const budget = makeBudget();
      const result = validateSimulationRequest(
        budget,
        { asset: 'XLM', amount: '100', conversionRate: '0.5' },
        { now: NOW_IN_WINDOW },
      );

      expect(result.allowed).toBe(true);
      expect(result.convertedAmount).toBe('50');
      expect(result.appliedConversionRate).toBe('0.5');
      // 1000 - 50 USDC-equivalent draw.
      expect(result.afterRemaining).toBe('950.00');
    });

    it('rejects a converted draw that overflows the budget', () => {
      const budget = makeBudget({ limitAmount: '1000.00', spent: '990.00', remaining: '10.00' });
      const result = validateSimulationRequest(
        budget,
        { asset: 'XLM', amount: '100', conversionRate: '0.5' }, // 50 USDC draw
        { now: NOW_IN_WINDOW },
      );

      expect(result.allowed).toBe(false);
      const violation = result.violations.find((v) => v.reason === 'LIMIT_OVERFLOW');
      expect(violation).toBeDefined();
      expect(violation?.projectedSpend).toBe('1040.00');
      expect(result.convertedAmount).toBe('50');
    });

    it('matches currency case-insensitively', () => {
      const budget = makeBudget({ currency: 'usdc' });
      const result = validateSimulationRequest(
        budget,
        { asset: 'USDC', amount: '10' },
        { now: NOW_IN_WINDOW },
      );

      expect(result.allowed).toBe(true);
    });
  });

  describe('accumulates multiple violations', () => {
    it('reports expired + overflow together for a spent, expired budget', () => {
      const budget = makeBudget({
        periodStart: '2026-01-01T00:00:00.000Z',
        limitAmount: '100.00',
        spent: '90.00',
        remaining: '10.00',
      });
      const result = validateSimulationRequest(
        budget,
        { asset: 'USDC', amount: '50' },
        { now: new Date('2026-09-15T00:00:00.000Z') },
      );

      const reasons = result.violations.map((v) => v.reason);
      expect(reasons).toContain('EXPIRED_BUDGET');
      expect(reasons).toContain('LIMIT_OVERFLOW');
      expect(result.allowed).toBe(false);
    });
  });

  describe('decimal safety', () => {
    it('handles sub-cent precision without float drift', () => {
      const budget = makeBudget({ limitAmount: '0.30', spent: '0.10', remaining: '0.20' });
      const result = validateSimulationRequest(
        budget,
        { asset: 'USDC', amount: '0.2' },
        { now: NOW_IN_WINDOW },
      );

      expect(result.allowed).toBe(true);
      expect(result.afterRemaining).toBe('0.00');
    });
  });
});

describe('resolveBudgetWindow', () => {
  it('aligns MONTHLY windows to UTC month boundaries', () => {
    const window = resolveBudgetWindow({ period: 'MONTHLY', periodStart: '2026-03-17T10:00:00Z' });
    expect(window.start).toBe('2026-03-01T00:00:00.000Z');
    expect(window.end).toBe('2026-04-01T00:00:00.000Z');
  });

  it('aligns WEEKLY windows to Monday', () => {
    // 2026-01-07 is a Wednesday.
    const window = resolveBudgetWindow({ period: 'WEEKLY', periodStart: '2026-01-07T08:00:00Z' });
    expect(window.start).toBe('2026-01-05T00:00:00.000Z');
    expect(window.end).toBe('2026-01-12T00:00:00.000Z');
  });

  it('computes QUARTERLY windows', () => {
    const window = resolveBudgetWindow({ period: 'QUARTERLY', periodStart: '2026-04-10T00:00:00Z' });
    expect(window.start).toBe('2026-04-01T00:00:00.000Z');
    expect(window.end).toBe('2026-07-01T00:00:00.000Z');
  });

  it('computes YEARLY windows', () => {
    const window = resolveBudgetWindow({ period: 'YEARLY', periodStart: '2026-06-01T00:00:00Z' });
    expect(window.start).toBe('2026-01-01T00:00:00.000Z');
    expect(window.end).toBe('2027-01-01T00:00:00.000Z');
  });

  it('computes DAILY windows', () => {
    const window = resolveBudgetWindow({ period: 'DAILY', periodStart: '2026-09-15T18:30:00Z' });
    expect(window.start).toBe('2026-09-15T00:00:00.000Z');
    expect(window.end).toBe('2026-09-16T00:00:00.000Z');
  });
});

describe('isBudgetExpired', () => {
  it('returns false for a budget inside its window', () => {
    const budget = { period: 'MONTHLY' as const, periodStart: '2026-09-01T00:00:00.000Z' };
    expect(isBudgetExpired(budget, new Date('2026-09-15T00:00:00.000Z'))).toBe(false);
  });

  it('returns true at the window end boundary', () => {
    const budget = { period: 'MONTHLY' as const, periodStart: '2026-08-01T00:00:00.000Z' };
    expect(isBudgetExpired(budget, new Date('2026-09-01T00:00:00.000Z'))).toBe(true);
  });
});

describe('resolveBudgetRemaining', () => {
  it('subtracts spent from limit', () => {
    const budget = makeBudget({ limitAmount: '1000.00', spent: '250.50' });
    expect(resolveBudgetRemaining(budget)).toBe('749.50');
  });

  it('clamps at zero when spent exceeds the limit', () => {
    const budget = makeBudget({ limitAmount: '100.00', spent: '150.00' });
    expect(resolveBudgetRemaining(budget)).toBe('0.00');
  });
});

describe('toBudgetCheckResult', () => {
  it('maps the structured result onto the wire envelope', () => {
    const budget = makeBudget({ limitAmount: '100.00', spent: '80.00', remaining: '20.00' });
    const result = validateSimulationRequest(
      budget,
      { asset: 'USDC', amount: '50' },
      { now: NOW_IN_WINDOW },
    );
    const wire = toBudgetCheckResult(result);

    expect(wire.allowed).toBe(false);
    expect(wire.wouldExceed).toBe(true);
    expect(wire.violations).toHaveLength(1);
    expect(wire.violations[0]).toBeTypeOf('string');
    // Draw (50) exceeds headroom (20): clamped at zero.
    expect(wire.afterRemaining).toBe('0.00');
    expect(wire.budgetId).toBe('bud_sim');
  });
});

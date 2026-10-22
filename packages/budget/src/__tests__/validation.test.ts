import { describe, expect, it } from 'vitest';

import type { Budget, BudgetHistoryEntry } from '@astroid/types';

import { checkBudgetLimit, type SpendRequest } from '../validation.js';

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

const USD_ASSET = 'USDC';

function makeBudget(overrides: Partial<Budget> = {}): Budget {
  return {
    id: 'budget-1',
    organizationId: 'org-1',
    name: 'Test Budget',
    currency: USD_ASSET,
    limitAmount: '100',
    spent: '0',
    remaining: '100',
    period: 'DAILY',
    periodStart: '2025-06-15T00:00:00.000Z',
    rollover: false,
    enabled: true,
    createdAt: '2025-06-15T00:00:00.000Z',
    updatedAt: '2025-06-15T00:00:00.000Z',
    ...overrides,
  };
}

function makeEntry(overrides: Partial<BudgetHistoryEntry> = {}): BudgetHistoryEntry {
  return {
    id: 'entry-1',
    budgetId: 'budget-1',
    amount: '10',
    spentAfter: '10',
    createdAt: '2025-06-15T12:00:00.000Z',
    ...overrides,
  };
}

function request(asset = USD_ASSET, amount: string | number = '10'): SpendRequest {
  return { asset, amount };
}

/* -------------------------------------------------------------------------- */
/* Tests                                                                       */
/* -------------------------------------------------------------------------- */

describe('checkBudgetLimit', () => {
  describe('basic allowed / blocked decisions', () => {
    it('allows a spend that is within budget', () => {
      const budget = makeBudget({ limitAmount: '100' });
      const history = [makeEntry({ amount: '50' })];

      const result = checkBudgetLimit(budget, history, request(USD_ASSET, '40'));

      expect(result.allowed).toBe(true);
      expect(result.violated).toBe(false);
      expect(result.remaining).toBe('50');
      expect(result.spent).toBe('50');
    });

    it('blocks a spend that would exceed the budget', () => {
      const budget = makeBudget({ limitAmount: '100' });
      const history = [makeEntry({ amount: '80' })];

      const result = checkBudgetLimit(budget, history, request(USD_ASSET, '30'));

      expect(result.allowed).toBe(false);
      expect(result.violated).toBe(true);
      expect(result.restriction).toContain('budget limit');
    });

    it('allows a spend that exactly matches the remaining budget', () => {
      const budget = makeBudget({ limitAmount: '100' });
      const history = [makeEntry({ amount: '75' })];

      const result = checkBudgetLimit(budget, history, request(USD_ASSET, '25'));

      expect(result.allowed).toBe(true);
      expect(result.violated).toBe(false);
      expect(result.remaining).toBe('25');
    });

    it('allows when the history is empty (no prior spend)', () => {
      const budget = makeBudget({ limitAmount: '100' });

      const result = checkBudgetLimit(budget, [], request(USD_ASSET, '100'));

      expect(result.allowed).toBe(true);
      expect(result.violated).toBe(false);
      expect(result.spent).toBe('0');
      expect(result.remaining).toBe('100');
    });
  });

  describe('disabled budgets', () => {
    it('allows the request when the budget is disabled', () => {
      const budget = makeBudget({ enabled: false, limitAmount: '10' });
      const history = [makeEntry({ amount: '9.99' })];

      const result = checkBudgetLimit(budget, history, request(USD_ASSET, '999'));

      expect(result.allowed).toBe(true);
      expect(result.violated).toBe(false);
      expect(result.restriction).toBeNull();
    });
  });

  describe('multi-asset handling', () => {
    it('allows the request when the asset does not match the budget currency', () => {
      const budget = makeBudget({ currency: 'USDC', limitAmount: '100' });
      const history = [makeEntry({ amount: '95' })];

      const result = checkBudgetLimit(budget, history, request('XLM', '1000'));

      expect(result.allowed).toBe(true);
      expect(result.violated).toBe(false);
      expect(result.restriction).toBeNull();
    });

    it('matches assets case-insensitively', () => {
      const budget = makeBudget({ currency: 'usdc', limitAmount: '100' });

      const result = checkBudgetLimit(budget, [], request('USDC', '50'));

      expect(result.allowed).toBe(true);
      expect(result.violated).toBe(false);
    });

    it('allows XLM budget spend when only XLM entries are in history', () => {
      const budget = makeBudget({ currency: 'XLM', limitAmount: '500' });
      const history = [
        makeEntry({ amount: '200' }),
        makeEntry({ id: 'entry-2', amount: '100', createdAt: '2025-06-15T14:00:00.000Z' }),
      ];

      const result = checkBudgetLimit(budget, history, request('XLM', '150'));

      expect(result.allowed).toBe(true);
      expect(result.violated).toBe(false);
      expect(result.spent).toBe('300');
      expect(result.remaining).toBe('200');
    });

    it('handles CODE:ISSUER asset format seamlessly', () => {
      const issuer = 'GAZDAU5DKH6Y3WCDQOSQWYTLNY7H3G7YK465J6YX7VYB7RS6KXQJ6Y7G';
      const budget = makeBudget({ currency: `USDC:${issuer}`, limitAmount: '200' });
      const history = [makeEntry({ amount: '50' })];

      const result = checkBudgetLimit(budget, history, request(`USDC:${issuer}`, '100'));

      expect(result.allowed).toBe(true);
      expect(result.spent).toBe('50');
      expect(result.remaining).toBe('150');
    });

    it('does not count entries from other assets', () => {
      const budget = makeBudget({ currency: 'USDC', limitAmount: '100' });
      const history = [
        makeEntry({ amount: '50' }),
        makeEntry({ id: 'entry-xlm', amount: '999' }), // assumed USDC (budget.currency matches)
      ];

      // Both entries are counted because they're matched by the USDC budget
      const result = checkBudgetLimit(budget, history, request(USD_ASSET, '10'));

      expect(result.spent).toBe('1049');
      expect(result.remaining).toBe('0');
    });
  });

  describe('window / boundary logic', () => {
    it('counts only entries within the active daily window', () => {
      const budget = makeBudget({
        period: 'DAILY',
        periodStart: '2025-06-15T00:00:00.000Z',
      });

      const insideWindow = makeEntry({
        amount: '40',
        createdAt: '2025-06-15T18:00:00.000Z',
      });
      const outsideWindow = makeEntry({
        id: 'old',
        amount: '200',
        createdAt: '2025-06-14T12:00:00.000Z',
      });

      const result = checkBudgetLimit(
        budget,
        [insideWindow, outsideWindow],
        request(USD_ASSET, '50'),
      );

      expect(result.spent).toBe('40');
      expect(result.remaining).toBe('60');
      expect(result.allowed).toBe(true);
    });

    it('excludes entries at or beyond the window end', () => {
      const budget = makeBudget({
        period: 'DAILY',
        periodStart: '2025-06-15T00:00:00.000Z',
      });
      // Window end is 2025-06-16T00:00:00.000Z — this entry is at the boundary
      const atBoundary = makeEntry({
        amount: '50',
        createdAt: '2025-06-16T00:00:00.000Z',
      });

      const result = checkBudgetLimit(budget, [atBoundary], request(USD_ASSET, '50'));

      expect(result.spent).toBe('0');
      expect(result.allowed).toBe(true);
    });

    it('handles cross-midnight entries correctly', () => {
      const budget = makeBudget({
        period: 'DAILY',
        periodStart: '2025-06-15T22:00:00.000Z',
      });
      // periodStart is 22:00, but daily window normalises to 00:00 UTC
      // so window is 2025-06-15T00:00 – 2025-06-16T00:00
      const entryBeforeMidnight = makeEntry({
        amount: '30',
        createdAt: '2025-06-15T23:30:00.000Z',
      });
      const entryAfterMidnight = makeEntry({
        id: 'after',
        amount: '25',
        createdAt: '2025-06-16T00:30:00.000Z',
      });

      const result = checkBudgetLimit(
        budget,
        [entryBeforeMidnight, entryAfterMidnight],
        request(USD_ASSET, '60'),
      );

      // Only the before-midnight entry is in the 2025-06-15 window
      expect(result.spent).toBe('30');
      expect(result.remaining).toBe('70');
    });

    it('aligns weekly windows to Monday boundaries', () => {
      // periodStart is Wednesday 2025-06-18
      const budget = makeBudget({
        period: 'WEEKLY',
        periodStart: '2025-06-18T00:00:00.000Z',
      });
      // Window should be Monday 2025-06-16 to Monday 2025-06-23

      const monEntry = makeEntry({
        amount: '20',
        createdAt: '2025-06-16T10:00:00.000Z', // Monday — in window
      });
      const sunEntry = makeEntry({
        id: 'old-week',
        amount: '100',
        createdAt: '2025-06-15T10:00:00.000Z', // Sunday — previous week, out of window
      });

      const result = checkBudgetLimit(budget, [monEntry, sunEntry], request(USD_ASSET, '30'));

      expect(result.spent).toBe('20');
      expect(result.windowStart).toBe('2025-06-16T00:00:00.000Z');
      expect(result.windowEnd).toBe('2025-06-23T00:00:00.000Z');
    });

    it('aligns monthly windows to the first of the month', () => {
      const budget = makeBudget({
        period: 'MONTHLY',
        periodStart: '2025-06-15T00:00:00.000Z',
      });
      // Window should be 2025-06-01 to 2025-07-01

      const juneEntry = makeEntry({
        amount: '50',
        createdAt: '2025-06-28T12:00:00.000Z',
      });
      const mayEntry = makeEntry({
        id: 'old-month',
        amount: '200',
        createdAt: '2025-05-30T12:00:00.000Z',
      });

      const result = checkBudgetLimit(budget, [juneEntry, mayEntry], request(USD_ASSET, '40'));

      expect(result.spent).toBe('50');
      expect(result.windowStart).toBe('2025-06-01T00:00:00.000Z');
      expect(result.windowEnd).toBe('2025-07-01T00:00:00.000Z');
    });

    it('handles quarterly window alignment', () => {
      // Q2: April 1 to July 1
      const budget = makeBudget({
        period: 'QUARTERLY',
        periodStart: '2025-05-10T00:00:00.000Z',
      });

      const q2Entry = makeEntry({
        amount: '150',
        createdAt: '2025-06-01T12:00:00.000Z',
      });
      const q1Entry = makeEntry({
        id: 'old-q',
        amount: '300',
        createdAt: '2025-03-15T12:00:00.000Z',
      });

      const result = checkBudgetLimit(budget, [q2Entry, q1Entry], request(USD_ASSET, '100'));

      expect(result.spent).toBe('150');
      expect(result.windowStart).toBe('2025-04-01T00:00:00.000Z');
      expect(result.windowEnd).toBe('2025-07-01T00:00:00.000Z');
    });

    it('handles yearly window alignment', () => {
      const budget = makeBudget({
        period: 'YEARLY',
        periodStart: '2025-06-15T00:00:00.000Z',
      });

      const thisYear = makeEntry({
        amount: '500',
        createdAt: '2025-03-01T12:00:00.000Z',
      });
      const lastYear = makeEntry({
        id: 'old-year',
        amount: '999',
        createdAt: '2024-12-25T12:00:00.000Z',
      });

      const result = checkBudgetLimit(budget, [thisYear, lastYear], request(USD_ASSET, '200'));

      expect(result.spent).toBe('500');
      expect(result.windowStart).toBe('2025-01-01T00:00:00.000Z');
      expect(result.windowEnd).toBe('2026-01-01T00:00:00.000Z');
    });
  });

  describe('precision / decimal edge cases', () => {
    it('handles 0.1 + 0.2 without floating-point drift', () => {
      const budget = makeBudget({ limitAmount: '1' });
      const history = [
        makeEntry({ amount: '0.1' }),
        makeEntry({ id: 'e2', amount: '0.2', createdAt: '2025-06-15T13:00:00.000Z' }),
      ];

      const result = checkBudgetLimit(budget, history, request(USD_ASSET, '0.7'));

      expect(result.spent).toBe('0.3');
      expect(result.remaining).toBe('0.7');
      expect(result.allowed).toBe(true);
    });

    it('blocks when 0.1 + 0.2 + request would exceed 1.0', () => {
      const budget = makeBudget({ limitAmount: '1' });
      const history = [
        makeEntry({ amount: '0.1' }),
        makeEntry({ id: 'e2', amount: '0.2', createdAt: '2025-06-15T13:00:00.000Z' }),
      ];

      const result = checkBudgetLimit(budget, history, request(USD_ASSET, '0.8'));

      expect(result.allowed).toBe(false);
      expect(result.violated).toBe(true);
      expect(result.spent).toBe('0.3');
      expect(result.remaining).toBe('0.7');
    });

    it('handles very large amounts without precision loss', () => {
      const budget = makeBudget({ limitAmount: '999999999999999999.99' });
      const history = [makeEntry({ amount: '1' })];

      const result = checkBudgetLimit(budget, history, request(USD_ASSET, '999999999999999998.99'));

      expect(result.allowed).toBe(true);
      expect(result.violated).toBe(false);
    });

    it('handles whole-number amounts cleanly', () => {
      const budget = makeBudget({ limitAmount: '100' });
      const history = [
        makeEntry({ amount: '30' }),
        makeEntry({ id: 'e2', amount: '40', createdAt: '2025-06-15T13:00:00.000Z' }),
      ];

      const result = checkBudgetLimit(budget, history, request(USD_ASSET, '30'));

      expect(result.spent).toBe('70');
      expect(result.remaining).toBe('30');
      expect(result.allowed).toBe(true);
    });
  });

  describe('extreme over-limit attempts', () => {
    it('blocks a request that is orders of magnitude over the limit', () => {
      const budget = makeBudget({ limitAmount: '100' });
      const history = [makeEntry({ amount: '1' })];

      const result = checkBudgetLimit(budget, history, request(USD_ASSET, '1000000'));

      expect(result.allowed).toBe(false);
      expect(result.violated).toBe(true);
      expect(result.restriction).toContain('1000000');
    });

    it('blocks when history already fully consumes the budget', () => {
      const budget = makeBudget({ limitAmount: '50' });
      const history = [makeEntry({ amount: '50' })];

      const result = checkBudgetLimit(budget, history, request(USD_ASSET, '0.01'));

      expect(result.allowed).toBe(false);
      expect(result.violated).toBe(true);
      expect(result.remaining).toBe('0');
    });
  });

  describe('window metadata', () => {
    it('returns correct windowStart and windowEnd for daily budgets', () => {
      const budget = makeBudget({
        period: 'DAILY',
        periodStart: '2025-06-15T08:30:00.000Z',
      });

      const result = checkBudgetLimit(budget, [], request());

      expect(result.windowStart).toBe('2025-06-15T00:00:00.000Z');
      expect(result.windowEnd).toBe('2025-06-16T00:00:00.000Z');
    });

    it('returns correct windowStart and windowEnd for monthly budgets', () => {
      const budget = makeBudget({
        period: 'MONTHLY',
        periodStart: '2025-06-15T00:00:00.000Z',
      });

      const result = checkBudgetLimit(budget, [], request());

      expect(result.windowStart).toBe('2025-06-01T00:00:00.000Z');
      expect(result.windowEnd).toBe('2025-07-01T00:00:00.000Z');
    });
  });
});

/* -------------------------------------------------------------------------- */
/* Tests for Issue #429 Structured Spending Validation Helpers                */
/* -------------------------------------------------------------------------- */

import {
  validateRemainingAllowance,
  validateDailyLimit,
  validateAssetSpendingCap,
  validateBudgetSpending,
} from '../validation.js';

describe('Issue #429 — Structured Budget Spending Validation Helpers', () => {
  describe('validateRemainingAllowance', () => {
    it('allows spending when within remaining allowance', () => {
      const budget = makeBudget({ limitAmount: '500.00', spent: '100.00', currency: 'USDC' });
      const result = validateRemainingAllowance(budget, { asset: 'USDC', amount: '250.00' });

      expect(result.allowed).toBe(true);
      expect(result.violations).toHaveLength(0);
      expect(result.remainingAllowance).toBe('150');
      expect(result.spentInWindow).toBe('100.00');
    });

    it('allows spending exactly matching the remaining allowance (exact limit boundary)', () => {
      const budget = makeBudget({ limitAmount: '500.00', spent: '100.00', currency: 'USDC' });
      const result = validateRemainingAllowance(budget, { asset: 'USDC', amount: '400.00' });

      expect(result.allowed).toBe(true);
      expect(result.violations).toHaveLength(0);
      expect(result.remainingAllowance).toBe('0');
    });

    it('denies spending when exceeding remaining allowance by a tiny fraction (precision test)', () => {
      const budget = makeBudget({ limitAmount: '500.00', spent: '100.00', currency: 'USDC' });
      const result = validateRemainingAllowance(budget, { asset: 'USDC', amount: '400.0000001' });

      expect(result.allowed).toBe(false);
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0]?.type).toBe('REMAINING_ALLOWANCE_EXCEEDED');
      expect(result.explanation).toContain('exceeds remaining allowance');
    });

    it('handles disabled budget safely', () => {
      const budget = makeBudget({ limitAmount: '500.00', spent: '0', currency: 'USDC', enabled: false });
      const result = validateRemainingAllowance(budget, { asset: 'USDC', amount: '10.00' });

      expect(result.allowed).toBe(false);
      expect(result.violations[0]?.type).toBe('DISABLED_BUDGET');
    });

    it('handles asset currency mismatch safely', () => {
      const budget = makeBudget({ limitAmount: '500.00', spent: '0', currency: 'USDC' });
      const result = validateRemainingAllowance(budget, { asset: 'XLM', amount: '10.00' });

      expect(result.allowed).toBe(false);
      expect(result.violations[0]?.type).toBe('CURRENCY_MISMATCH');
    });

    it('handles malformed / non-numeric amounts', () => {
      const budget = makeBudget({ limitAmount: '500.00', spent: '0', currency: 'USDC' });
      const result = validateRemainingAllowance(budget, { asset: 'USDC', amount: 'invalid-amount' });

      expect(result.allowed).toBe(false);
      expect(result.violations[0]?.type).toBe('INVALID_AMOUNT');
    });
  });

  describe('validateDailyLimit', () => {
    it('allows spending within daily limit', () => {
      const budget = makeBudget({ period: 'DAILY', limitAmount: '200.00', spent: '50.00', currency: 'USDC' });
      const result = validateDailyLimit(budget, { asset: 'USDC', amount: '100.00' });

      expect(result.allowed).toBe(true);
      expect(result.remainingAllowance).toBe('50');
    });

    it('denies spending exceeding daily limit', () => {
      const budget = makeBudget({ period: 'DAILY', limitAmount: '200.00', spent: '150.00', currency: 'USDC' });
      const result = validateDailyLimit(budget, { asset: 'USDC', amount: '100.00' });

      expect(result.allowed).toBe(false);
      expect(result.violations[0]?.type).toBe('DAILY_LIMIT_EXCEEDED');
    });

    it('filters history within active daily window', () => {
      const budget = makeBudget({ period: 'DAILY', limitAmount: '200.00', currency: 'USDC' });
      const now = new Date('2025-06-15T12:00:00Z');
      const spentHistory = [
        makeEntry({ amount: '50.00', createdAt: '2025-06-15T08:00:00Z' }), // Today
        makeEntry({ amount: '100.00', createdAt: '2025-06-14T20:00:00Z' }), // Yesterday
      ];

      const result = validateDailyLimit(budget, { asset: 'USDC', amount: '120.00' }, spentHistory, {
        dailyLimit: '200.00',
        now,
      });

      expect(result.allowed).toBe(true);
      expect(result.spentInWindow).toBe('50');
    });
  });

  describe('validateAssetSpendingCap', () => {
    it('allows spending when under asset-specific cap', () => {
      const assetCaps = { XLM: '1000.00', USDC: '500.00' };
      const currentSpentByAsset = { XLM: '400.00' };

      const result = validateAssetSpendingCap({ asset: 'XLM', amount: '500.00' }, assetCaps, currentSpentByAsset);

      expect(result.allowed).toBe(true);
      expect(result.remainingAllowance).toBe('100');
    });

    it('denies spending when exceeding asset-specific cap', () => {
      const assetCaps = { XLM: '1000.00', USDC: '500.00' };
      const currentSpentByAsset = { XLM: '800.00' };

      const result = validateAssetSpendingCap({ asset: 'XLM', amount: '300.00' }, assetCaps, currentSpentByAsset);

      expect(result.allowed).toBe(false);
      expect(result.violations[0]?.type).toBe('ASSET_CAP_EXCEEDED');
    });

    it('passes when no cap is defined for asset', () => {
      const assetCaps = { USDC: '500.00' };

      const result = validateAssetSpendingCap({ asset: 'XLM', amount: '10000.00' }, assetCaps);

      expect(result.allowed).toBe(true);
      expect(result.violations).toHaveLength(0);
    });
  });

  describe('validateBudgetSpending (comprehensive)', () => {
    it('passes when all limit checks pass', () => {
      const budget = makeBudget({ limitAmount: '1000.00', spent: '200.00', currency: 'USDC', period: 'DAILY' });
      const assetCaps = { USDC: '500.00' };

      const result = validateBudgetSpending(
        budget,
        { asset: 'USDC', amount: '100.00' },
        { assetCaps, currentSpentByAsset: { USDC: '200.00' } },
      );

      expect(result.allowed).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    it('aggregates multiple violations when multiple limits are breached', () => {
      const budget = makeBudget({ limitAmount: '200.00', spent: '180.00', currency: 'USDC', period: 'DAILY' });
      const assetCaps = { USDC: '200.00' };

      const result = validateBudgetSpending(
        budget,
        { asset: 'USDC', amount: '50.00' },
        { dailyLimit: '200.00', assetCaps, currentSpentByAsset: { USDC: '180.00' } },
      );

      expect(result.allowed).toBe(false);
      expect(result.violations.length).toBeGreaterThanOrEqual(2);
      const violationTypes = result.violations.map((v) => v.type);
      expect(violationTypes).toContain('REMAINING_ALLOWANCE_EXCEEDED');
      expect(violationTypes).toContain('DAILY_LIMIT_EXCEEDED');
    });
  });
});

import { describe, it, expect } from 'vitest';
import { calculateRollingWindowBudget, getRollingWindowBounds } from '../src/calculator.js';
import type { BudgetHistoryEntry } from '@astroid/types';

describe('calculateRollingWindowBudget (Issue #34)', () => {
  it('calculates consumption and margin correctly within a rolling 30d window', () => {
    const now = new Date('2026-08-28T00:00:00.000Z');
    const history: BudgetHistoryEntry[] = [
      {
        id: '1',
        budgetId: 'b1',
        amount: '150.5',
        spentAfter: '150.5',
        createdAt: '2026-08-15T12:00:00.000Z',
      },
      {
        id: '2',
        budgetId: 'b1',
        amount: '200.0',
        spentAfter: '350.5',
        createdAt: '2026-08-20T12:00:00.000Z',
      },
      {
        id: '3',
        budgetId: 'b1',
        amount: '500.0',
        spentAfter: '850.5',
        createdAt: '2026-06-01T00:00:00.000Z', // Out of 30d window
      },
    ];

    const res = calculateRollingWindowBudget(history, {
      period: 'rolling_30d',
      limit: 500,
      evaluationTime: now,
      warningThresholdPercent: 70,
    });

    expect(res.totalLimit).toBe(500);
    expect(res.consumedAmount).toBe(350.5);
    expect(res.remainingMargin).toBe(149.5);
    expect(res.isExhausted).toBe(false);
    expect(res.isWarningTriggered).toBe(true); // 350.5 >= 350 (70%)
    expect(res.filteredEntriesCount).toBe(2);
  });

  it('handles empty history and missing timestamps without errors', () => {
    const res = calculateRollingWindowBudget([], {
      period: 'daily',
      limit: '100',
    });

    expect(res.consumedAmount).toBe(0);
    expect(res.remainingMargin).toBe(100);
    expect(res.isExhausted).toBe(false);
    expect(res.isWarningTriggered).toBe(false);
  });
});

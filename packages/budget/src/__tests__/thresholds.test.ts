import { describe, expect, it, vi } from 'vitest';
import { ValidationError } from '@astroid/errors';

import {
  DEFAULT_BUDGET_THRESHOLDS,
  createBudgetThresholdMonitor,
  evaluateBudgetThresholds,
  getHighestReachedThreshold,
  normalizeBudgetThresholds,
  type BudgetThresholdSubject,
} from '../index.js';

/** A budget-shaped subject with decimal-string amounts. */
function budget(spent: string, limitAmount: string, id = 'bud_1'): BudgetThresholdSubject {
  return { id, limitAmount, spent };
}

describe('evaluateBudgetThresholds (#530)', () => {
  it('reports no alert below the lowest threshold', () => {
    const result = evaluateBudgetThresholds(budget('25', '100'));
    expect(result.percent).toBe(25);
    expect(result.reached).toBe(false);
    expect(result.threshold).toBeNull();
    expect(result.level).toBe('healthy');
    expect(result.matches.every((match) => !match.reached)).toBe(true);
  });

  it('treats an exact threshold match as reached', () => {
    const result = evaluateBudgetThresholds(budget('80', '100'), { thresholds: [80, 95] });
    expect(result.percent).toBe(80);
    expect(result.reached).toBe(true);
    expect(result.threshold).toBe(80);
    expect(result.level).toBe('warning');
    expect(result.matches).toEqual([
      { threshold: 80, reached: true, exceeded: false },
      { threshold: 95, reached: false, exceeded: false },
    ]);
  });

  it('reports the highest reached threshold and every match', () => {
    const result = evaluateBudgetThresholds(budget('96', '100'), {
      thresholds: [50, 80, 95, 100],
    });
    expect(result.threshold).toBe(95);
    expect(result.level).toBe('critical');
    expect(result.matches.map((match) => [match.threshold, match.reached])).toEqual([
      [50, true],
      [80, true],
      [95, true],
      [100, false],
    ]);
  });

  it('marks an overspent budget as exhausted and preserves percent > 100', () => {
    const result = evaluateBudgetThresholds(budget('150', '100'));
    expect(result.percent).toBe(150);
    expect(result.exceeded).toBe(true);
    expect(result.level).toBe('exhausted');
    expect(result.threshold).toBe(100);
    expect(result.remaining).toBe(0);
    expect(result.utilization).toBe(1);
  });

  it('handles a zero balance without alerting', () => {
    const result = evaluateBudgetThresholds(budget('0', '0'), { thresholds: [50, 100] });
    expect(result.percent).toBe(0);
    expect(result.reached).toBe(false);
    expect(result.exceeded).toBe(false);
    expect(result.level).toBe('healthy');
    expect(result.remaining).toBe(0);
  });

  it('treats any spend against a zero limit as exhausted', () => {
    const result = evaluateBudgetThresholds(budget('1', '0'), { thresholds: [50, 100] });
    expect(result.percent).toBe(100);
    expect(result.exceeded).toBe(true);
    expect(result.threshold).toBe(100);
    expect(result.level).toBe('exhausted');
  });

  it('supports labelled and unsorted custom thresholds', () => {
    const result = evaluateBudgetThresholds(budget('90', '100'), {
      thresholds: [
        { percent: 95, label: 'critical' },
        { percent: 80, label: 'warning' },
        80,
      ],
    });
    expect(result.matches.map((match) => match.threshold)).toEqual([80, 95]);
    expect(result.matches[0]?.label).toBe('warning');
    expect(result.matches[1]?.reached).toBe(false);
  });

  it('requires strict comparison when inclusive is false', () => {
    const inclusive = evaluateBudgetThresholds(budget('80', '100'), { thresholds: [80] });
    const exclusive = evaluateBudgetThresholds(budget('80', '100'), {
      thresholds: [80],
      inclusive: false,
    });
    expect(inclusive.reached).toBe(true);
    expect(exclusive.reached).toBe(false);
  });

  it('tolerates malformed amount strings as zero', () => {
    const result = evaluateBudgetThresholds({
      id: 'bad',
      limitAmount: 'not-a-number' as never,
      spent: undefined as never,
    });
    expect(result.percent).toBe(0);
    expect(result.reached).toBe(false);
  });

  it('rejects invalid threshold definitions', () => {
    expect(() => evaluateBudgetThresholds(budget('10', '100'), { thresholds: [0] })).toThrow(
      ValidationError,
    );
    expect(() => evaluateBudgetThresholds(budget('10', '100'), { thresholds: [-10] })).toThrow(
      ValidationError,
    );
    expect(() =>
      evaluateBudgetThresholds(budget('10', '100'), { thresholds: [Number.NaN] }),
    ).toThrow(ValidationError);
  });

  it('exposes the default and normalized threshold lists', () => {
    expect(DEFAULT_BUDGET_THRESHOLDS).toEqual([50, 80, 95, 100]);
    expect(normalizeBudgetThresholds([100, 50, 50]).map((entry) => entry.percent)).toEqual([
      50, 100,
    ]);
  });

  it('provides a highest-threshold helper', () => {
    expect(getHighestReachedThreshold(budget('82', '100'), { thresholds: [80, 90] })).toBe(80);
    expect(getHighestReachedThreshold(budget('10', '100'), { thresholds: [80, 90] })).toBeNull();
  });
});

describe('createBudgetThresholdMonitor (#530)', () => {
  it('fires each threshold once until utilization falls back below it', () => {
    const monitor = createBudgetThresholdMonitor({ thresholds: [80, 95] });
    const listener = vi.fn();
    monitor.onThreshold(listener);

    expect(monitor.evaluate(budget('70', '100'))).toEqual([]);
    expect(listener).not.toHaveBeenCalled();

    const first = monitor.evaluate(budget('85', '100'));
    expect(first.map((alert) => alert.threshold)).toEqual([80]);
    expect(listener).toHaveBeenCalledTimes(1);

    // A second poll at the same utilization must not re-alert.
    expect(monitor.evaluate(budget('88', '100'))).toEqual([]);
    expect(listener).toHaveBeenCalledTimes(1);

    // Crossing 95 fires only the new threshold.
    const second = monitor.evaluate(budget('96', '100'));
    expect(second.map((alert) => alert.threshold)).toEqual([95]);
    expect(listener).toHaveBeenCalledTimes(2);

    // Dropping below re-arms both thresholds.
    expect(monitor.evaluate(budget('50', '100'))).toEqual([]);
    const reCrossed = monitor.evaluate(budget('99', '100'));
    expect(reCrossed.map((alert) => alert.threshold)).toEqual([80, 95]);
    expect(listener).toHaveBeenCalledTimes(4);
  });

  it('tracks budgets independently and can reset one', () => {
    const monitor = createBudgetThresholdMonitor({ thresholds: [80] });
    monitor.evaluate(budget('85', '100', 'a'));
    expect(monitor.evaluate(budget('85', '100', 'b')).map((a) => a.budgetId)).toEqual(['b']);
    expect(monitor.evaluate(budget('85', '100', 'a'))).toEqual([]);

    monitor.reset('a');
    expect(monitor.evaluate(budget('85', '100', 'a')).map((a) => a.budgetId)).toEqual(['a']);
  });

  it('isolates listener failures and supports unsubscribe', () => {
    const monitor = createBudgetThresholdMonitor({ thresholds: [80] });
    const bad = vi.fn(() => {
      throw new Error('boom');
    });
    const good = vi.fn();
    const unsubscribeBad = monitor.onThreshold(bad);
    monitor.onThreshold(good);

    expect(() => monitor.evaluate(budget('90', '100'))).not.toThrow();
    expect(bad).toHaveBeenCalledTimes(1);
    expect(good).toHaveBeenCalledTimes(1);

    unsubscribeBad();
    monitor.reset();
    monitor.evaluate(budget('90', '100'));
    expect(bad).toHaveBeenCalledTimes(1);
    expect(good).toHaveBeenCalledTimes(2);

    monitor.removeListener(good);
    monitor.reset();
    monitor.evaluate(budget('90', '100'));
    expect(good).toHaveBeenCalledTimes(2);
  });

  it('includes the evaluation and optional label on alerts', () => {
    const monitor = createBudgetThresholdMonitor({
      thresholds: [{ percent: 80, label: 'warning' }],
    });
    const alerts = monitor.evaluate(budget('80', '100'));
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      budgetId: 'bud_1',
      threshold: 80,
      label: 'warning',
      percent: 80,
    });
    expect(alerts[0]?.evaluation.matches).toHaveLength(1);
  });

  it('validates thresholds eagerly and exposes the resolved list', () => {
    expect(() => createBudgetThresholdMonitor({ thresholds: [0] })).toThrow(ValidationError);
    expect(createBudgetThresholdMonitor({ thresholds: [95, 80] }).thresholds).toEqual([80, 95]);
  });

  it('dispose clears listeners and crossings', () => {
    const monitor = createBudgetThresholdMonitor({ thresholds: [80] });
    const listener = vi.fn();
    monitor.onThreshold(listener);
    monitor.evaluate(budget('85', '100'));
    monitor.dispose();

    // dispose forgot the crossing, so a fresh evaluation is eligible again —
    // but there are no listeners left to notify.
    expect(monitor.evaluate(budget('85', '100'))).toHaveLength(1);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(monitor.evaluate(budget('85', '100'))).toEqual([]);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

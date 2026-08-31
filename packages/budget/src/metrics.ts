import type { Budget, BudgetHistoryEntry } from '@astroid/types';

export interface UtilizationResult {
  utilization: number;
  percent: number;
  spent: string;
  remaining: string;
}

export interface ThresholdResult {
  exceeded: boolean;
  level: 'ok' | 'warn' | 'critical' | 'exceeded';
  thresholdCrossed?: number;
  depleted: boolean;
}

export interface BurnRateResult {
  averagePerPeriod: number;
  periodsUntilExhaustion: number | null;
  unsustainable: boolean;
}

export interface ThresholdConfig {
  warn?: number;
  critical?: number;
}

export function calculateUtilization(
  budget: Budget,
  history?: BudgetHistoryEntry[],
  prospectiveRequest?: { asset: string; amount: string | number },
): UtilizationResult {
  let spentNum = parseFloat(budget.spent);
  if (isNaN(spentNum)) spentNum = 0;

  if (history && history.length > 0) {
    let historySpent = 0;
    for (const entry of history) {
      const amt = parseFloat(entry.amount);
      if (!isNaN(amt)) {
        historySpent += amt;
      }
    }
    spentNum = historySpent;
  }

  if (prospectiveRequest) {
    const reqAmt = parseFloat(String(prospectiveRequest.amount));
    if (!isNaN(reqAmt)) {
      spentNum += reqAmt;
    }
  }

  let limitNum = parseFloat(budget.limitAmount);
  if (isNaN(limitNum)) limitNum = 0;

  let utilization = 0;
  if (limitNum > 0) {
    utilization = spentNum / limitNum;
  }

  if (utilization > 1) {
    utilization = 1;
  }
  if (utilization < 0) {
    utilization = 0;
  }

  const percent = Number((utilization * 100).toFixed(2));
  const remainingNum = Math.max(0, limitNum - spentNum);

  return {
    utilization,
    percent,
    spent: spentNum.toString(),
    remaining: remainingNum.toString(),
  };
}

export function isThresholdExceeded(
  budget: Budget,
  config: ThresholdConfig = {},
): ThresholdResult {
  const { utilization, remaining } = calculateUtilization(budget);
  const warnThreshold = config.warn ?? 0.8;
  const criticalThreshold = config.critical ?? 0.95;
  const remainingNum = parseFloat(remaining);

  const depleted = remainingNum <= 0 || utilization >= 1;

  if (depleted) {
    return {
      exceeded: true,
      level: 'exceeded',
      depleted: true,
    };
  }

  if (utilization >= criticalThreshold) {
    return {
      exceeded: true,
      level: 'critical',
      thresholdCrossed: criticalThreshold,
      depleted: false,
    };
  }

  if (utilization >= warnThreshold) {
    return {
      exceeded: true,
      level: 'warn',
      thresholdCrossed: warnThreshold,
      depleted: false,
    };
  }

  return {
    exceeded: false,
    level: 'ok',
    depleted: false,
  };
}

export function estimateBurnRate(
  budget: Budget,
  periodsElapsed: number,
): BurnRateResult {
  let spentNum = parseFloat(budget.spent);
  if (isNaN(spentNum)) spentNum = 0;

  let limitNum = parseFloat(budget.limitAmount);
  if (isNaN(limitNum)) limitNum = 0;

  const remainingNum = Math.max(0, limitNum - spentNum);

  if (limitNum <= 0 || periodsElapsed <= 0) {
    return {
      averagePerPeriod: 0,
      periodsUntilExhaustion: null,
      unsustainable: spentNum >= limitNum,
    };
  }

  const unsustainable = spentNum >= limitNum;
  if (unsustainable || remainingNum === 0) {
    return {
      averagePerPeriod: spentNum / periodsElapsed,
      periodsUntilExhaustion: null,
      unsustainable: true,
    };
  }

  const averagePerPeriod = spentNum / periodsElapsed;
  if (averagePerPeriod <= 0) {
    return {
      averagePerPeriod,
      periodsUntilExhaustion: null,
      unsustainable: false,
    };
  }

  const periodsUntilExhaustion = remainingNum / averagePerPeriod;

  return {
    averagePerPeriod,
    periodsUntilExhaustion,
    unsustainable: false,
  };
}

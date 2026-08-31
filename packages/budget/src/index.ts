export * from './calculator.js';

// `metrics.ts` and `validation.ts` both export a `SpendRequest` alias for the
// same shape; re-export explicitly to avoid a duplicate-export ambiguity.
export {
  calculateUtilization,
  isThresholdExceeded,
  estimateBurnRate,
  type SpendRequest,
  type UtilizationResult,
  type ThresholdResult,
  type BurnRateResult,
} from './metrics.js';
export { checkBudgetLimit, type BudgetValidationResult } from './validation.js';

export * from './budget.js';
export * from './alerts.js';

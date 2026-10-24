import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  POLICY_REASON_CODE_VALUES,
  isPolicyReasonCode,
  isPolicySimulationDenied,
  type PolicyCondition,
  type PolicyReasonCode,
  type PolicyRule,
  type PolicySimulationDecision,
  type PolicySimulationRequest,
  type PolicySimulationResult,
} from './index.js';

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

const maxAmountCondition: PolicyCondition = {
  id: 'cond_max',
  type: 'MAX_AMOUNT',
  maxAmount: '250.00',
  asset: 'USDC',
  operator: 'LTE',
};

const destinationCondition: PolicyCondition = {
  type: 'ALLOWED_DESTINATION_ACCOUNTS',
  allowedRecipients: ['GABC123', 'GDEF456'],
  description: 'Only treasury and payroll destinations',
};

const timeWindowCondition: PolicyCondition = {
  type: 'TIME_WINDOW',
  timeWindow: {
    start: '2026-01-01T00:00:00.000Z',
    end: '2026-12-31T23:59:59.000Z',
    timezone: 'UTC',
  },
};

const rule: PolicyRule = {
  id: 'rule_treasury',
  name: 'treasury-guardrails',
  description: 'Caps spend and restricts destinations',
  enabled: true,
  priority: 1,
  type: 'COMPOSITE',
  conditions: [maxAmountCondition, destinationCondition, timeWindowCondition],
  allowedRecipients: ['GABC123'],
  requiredSignatures: 2,
};

const request: PolicySimulationRequest = {
  walletId: 'wlt_1',
  asset: 'USDC',
  amount: '250.00',
  recipientAddress: 'GABC123',
  memo: 'vendor payout',
  policyIds: ['pol_1'],
  metadata: { runId: 'run_1' },
};

const allowedResult: PolicySimulationResult = {
  allowed: true,
  denied: false,
  decision: 'ALLOWED',
  reasonCode: 'ALLOWED',
  violations: [],
  requiredApprovals: [],
  risk: { score: 0.1, band: 'LOW', factors: [] },
  budgetImpact: [],
  explanation: 'Allowed by all active policies.',
};

const deniedResult: PolicySimulationResult = {
  allowed: false,
  denied: true,
  decision: 'DENIED',
  reasonCode: 'MAX_AMOUNT_EXCEEDED',
  violations: [
    {
      policyId: 'pol_1',
      policyType: 'MAX_AMOUNT',
      reasonCode: 'MAX_AMOUNT_EXCEEDED',
      message: 'Amount exceeds the per-transaction limit.',
      limit: '200.00',
      actual: '250.00',
    },
  ],
  requiredApprovals: [],
  risk: { score: 0.7, band: 'HIGH', factors: [] },
  budgetImpact: [],
  explanation: 'Denied by 1 policy.',
};

/* -------------------------------------------------------------------------- */
/* Tests                                                                       */
/* -------------------------------------------------------------------------- */

describe('@astroid/types — policy DTOs (issue #391)', () => {
  it('models max-amount, destination and time-window conditions', () => {
    expect(rule.conditions).toHaveLength(3);
    expect(rule.conditions?.[0]).toBe(maxAmountCondition);
    expect(destinationCondition.allowedRecipients).toEqual(['GABC123', 'GDEF456']);
    expect(timeWindowCondition.timeWindow?.start).toBe('2026-01-01T00:00:00.000Z');
  });

  it('keeps PolicyRule backward compatible with the local-evaluation shorthand', () => {
    const simpleRule: PolicyRule = {
      name: 'signature-threshold',
      requiredSignatures: 2,
      allowedHours: { startHour: 9, endHour: 17, timezone: 'UTC' },
    };

    expect(simpleRule.name).toBe('signature-threshold');
    expect(simpleRule.requiredSignatures).toBe(2);
  });

  it('types a simulation request with wallet scope and policy ids', () => {
    expect(request.walletId).toBe('wlt_1');
    expect(request.policyIds).toEqual(['pol_1']);
  });

  it('expresses an allowed decision with the ALLOWED reason code', () => {
    expect(allowedResult.allowed).toBe(true);
    expect(allowedResult.denied).toBe(false);
    expect(allowedResult.decision).toBe('ALLOWED');
    expect(allowedResult.reasonCode).toBe('ALLOWED');
    expect(isPolicySimulationDenied(allowedResult)).toBe(false);
  });

  it('expresses a denied decision with a machine-readable reason code', () => {
    expect(deniedResult.allowed).toBe(false);
    expect(deniedResult.denied).toBe(true);
    expect(deniedResult.reasonCode).toBe('MAX_AMOUNT_EXCEEDED');
    expect(deniedResult.violations[0]?.reasonCode).toBe('MAX_AMOUNT_EXCEEDED');
    expect(isPolicySimulationDenied(deniedResult)).toBe(true);
  });

  it('exports the reason-code catalogue and its guard', () => {
    expect(POLICY_REASON_CODE_VALUES).toContain('ALLOWED');
    expect(POLICY_REASON_CODE_VALUES).toContain('RECIPIENT_NOT_ALLOWED');
    expect(POLICY_REASON_CODE_VALUES).toContain('OUTSIDE_TIME_WINDOW');

    expect(isPolicyReasonCode('MAX_AMOUNT_EXCEEDED')).toBe(true);
    expect(isPolicyReasonCode('NOT_A_REASON')).toBe(false);
    expect(isPolicyReasonCode(42)).toBe(false);
  });

  it('narrows the decision and reason-code unions at the type level', () => {
    expectTypeOf<PolicySimulationDecision>().toEqualTypeOf<'ALLOWED' | 'DENIED'>();
    expectTypeOf<PolicyReasonCode>().toEqualTypeOf<(typeof POLICY_REASON_CODE_VALUES)[number]>();
    expectTypeOf<PolicySimulationResult['reasonCode']>().toEqualTypeOf<
      PolicyReasonCode | undefined
    >();
    expectTypeOf<PolicyCondition['maxAmount']>().toEqualTypeOf<number | string | undefined>();
  });
});

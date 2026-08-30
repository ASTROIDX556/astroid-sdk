import { describe, it, expect } from 'vitest';
import {
  evaluateSignerThreshold,
  evaluateSignerThresholdWithDetails,
  buildSetOptionsThresholdOp,
} from '../src/multisig.js';

describe('Multisig Threshold Evaluator & Builder (Issue #32)', () => {
  const signers = [
    { key: 'GMASTER', weight: 10 },
    { key: 'GAGENT1', weight: 10 },
    { key: 'GAGENT2', weight: 5 },
  ];

  const thresholds = {
    lowThreshold: 5,
    medThreshold: 15,
    highThreshold: 25,
  };

  it('evaluates threshold meeting requirements', () => {
    expect(evaluateSignerThreshold(signers, ['GMASTER'], 'low', thresholds)).toBe(true);
    expect(evaluateSignerThreshold(signers, ['GMASTER', 'GAGENT1'], 'medium', thresholds)).toBe(true);
    expect(evaluateSignerThreshold(signers, ['GMASTER', 'GAGENT1'], 'high', thresholds)).toBe(false);
  });

  it('deduplicates duplicate active signer keys', () => {
    const details = evaluateSignerThresholdWithDetails(
      signers,
      ['GMASTER', 'GMASTER', 'GMASTER'],
      'medium',
      thresholds
    );
    expect(details.accumulatedWeight).toBe(10);
    expect(details.passed).toBe(false);
  });

  it('builds SetOptions operation payload safely', () => {
    const op = buildSetOptionsThresholdOp({
      low: 1,
      medium: 2,
      high: 3,
      masterWeight: 10,
    });

    expect(op.type).toBe('setOptions');
    expect(op.lowThreshold).toBe(1);
    expect(op.medThreshold).toBe(2);
    expect(op.highThreshold).toBe(3);
    expect(op.masterWeight).toBe(10);
  });
});

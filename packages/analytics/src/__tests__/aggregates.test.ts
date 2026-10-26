import { describe, it, expect } from 'vitest';
import {
  computeTelemetrySummary,
  calculateExpenditures,
  calculateSuccessRate,
  type TelemetryRecord,
} from '../aggregates.js';

describe('Analytics aggregates helper functions', () => {
  const sampleRecords: TelemetryRecord[] = [
    {
      id: 'tx-1',
      timestamp: '2026-10-01T10:00:00Z',
      amount: '100.5',
      fee: '0.01',
      gasUsed: '500',
      success: true,
      agentId: 'agent-1',
      asset: 'XLM',
    },
    {
      id: 'tx-2',
      timestamp: '2026-10-01T11:00:00Z',
      amount: '50.25',
      fee: '0.02',
      gasUsed: '1000',
      success: true,
      agentId: 'agent-1',
      asset: 'XLM',
    },
    {
      id: 'tx-3',
      timestamp: '2026-10-02T09:00:00Z',
      amount: '200',
      fee: '0.03',
      gasUsed: '1500',
      success: false,
      agentId: 'agent-2',
      asset: 'USDC',
    },
  ];

  it('computes telemetry summary across all records', () => {
    const summary = computeTelemetrySummary(sampleRecords);

    expect(summary.totalTransactions).toBe(3);
    expect(summary.successfulTransactions).toBe(2);
    expect(summary.failedTransactions).toBe(1);
    expect(summary.successRate).toBeCloseTo(2 / 3, 4);
    expect(Number(summary.totalVolume)).toBeCloseTo(350.75, 2);
    expect(Number(summary.totalFees)).toBeCloseTo(0.06, 2);
    expect(Number(summary.totalGasUsed)).toBe(3000);
    expect(Number(summary.averageFee)).toBeCloseTo(0.02, 2);
    expect(Number(summary.averageVolume)).toBeCloseTo(116.9166667, 2);
  });

  it('filters by time window', () => {
    const summary = computeTelemetrySummary(sampleRecords, {
      from: '2026-10-01T00:00:00Z',
      to: '2026-10-01T23:59:59Z',
    });

    expect(summary.totalTransactions).toBe(2);
    expect(summary.successfulTransactions).toBe(2);
    expect(summary.failedTransactions).toBe(0);
    expect(summary.successRate).toBe(1);
    expect(Number(summary.totalVolume)).toBeCloseTo(150.75, 2);
  });

  it('filters by agentId and asset', () => {
    const summary = computeTelemetrySummary(sampleRecords, {
      agentId: 'agent-2',
    });
    expect(summary.totalTransactions).toBe(1);
    expect(summary.successRate).toBe(0);
    expect(Number(summary.totalVolume)).toBe(200);

    const assetSummary = computeTelemetrySummary(sampleRecords, {
      asset: 'XLM',
    });
    expect(assetSummary.totalTransactions).toBe(2);
    expect(assetSummary.successRate).toBe(1);
  });

  it('calculates expenditures accurately', () => {
    const exp = calculateExpenditures(sampleRecords);
    expect(Number(exp.totalFees)).toBeCloseTo(0.06, 2);
    expect(Number(exp.totalGasUsed)).toBe(3000);
    expect(Number(exp.averageFee)).toBeCloseTo(0.02, 2);
  });

  it('calculates success rate cleanly', () => {
    expect(calculateSuccessRate(sampleRecords)).toBeCloseTo(2 / 3, 4);
    expect(calculateSuccessRate([])).toBe(0);
  });

  it('handles empty records cleanly', () => {
    const summary = computeTelemetrySummary([]);
    expect(summary.totalTransactions).toBe(0);
    expect(summary.totalVolume).toBe('0');
    expect(summary.totalFees).toBe('0');
    expect(summary.averageFee).toBe('0');
  });
});

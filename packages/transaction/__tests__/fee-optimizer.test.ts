import { describe, expect, it } from 'vitest';
import type { NetworkFeeStatisticsDto } from '@astroid/types';
import {
  calculateRecommendedFee,
  calculateSurgeMultiplier,
  deriveNetworkCongestionState,
} from '../src/fee-optimizer.js';

describe('calculateSurgeMultiplier', () => {
  it('returns 1.0 when network has no congestion (low fees and low capacity usage)', () => {
    const stats: NetworkFeeStatisticsDto = {
      baseFee: 100,
      modeFee: 100,
      p50Fee: 100,
      p95Fee: 100,
      ledgerCapacityUsage: 0.25,
    };
    const multiplier = calculateSurgeMultiplier(stats);
    expect(multiplier).toBe(1.0);
  });

  it('increases multiplier proportionally when fee ratio is above 1.0', () => {
    const stats: NetworkFeeStatisticsDto = {
      baseFee: 100,
      p50Fee: 250,
      p95Fee: 300,
      ledgerCapacityUsage: 0.4,
    };
    const multiplier = calculateSurgeMultiplier(stats);
    expect(multiplier).toBeGreaterThanOrEqual(3.0);
  });

  it('increases multiplier under moderate capacity usage (60% - 80%)', () => {
    const stats: NetworkFeeStatisticsDto = {
      baseFee: 100,
      modeFee: 100,
      p50Fee: 100,
      ledgerCapacityUsage: 0.7,
    };
    const multiplier = calculateSurgeMultiplier(stats);
    expect(multiplier).toBeGreaterThanOrEqual(1.3);
  });

  it('applies heavy surge under high capacity usage (80% - 95%)', () => {
    const stats: NetworkFeeStatisticsDto = {
      baseFee: 100,
      modeFee: 100,
      p50Fee: 100,
      ledgerCapacityUsage: 0.85,
    };
    const multiplier = calculateSurgeMultiplier(stats);
    expect(multiplier).toBeGreaterThanOrEqual(2.0);
  });

  it('applies maximum surge under extreme saturation (>= 95%)', () => {
    const stats: NetworkFeeStatisticsDto = {
      baseFee: 100,
      modeFee: 100,
      p50Fee: 100,
      ledgerCapacityUsage: 0.98,
    };
    const multiplier = calculateSurgeMultiplier(stats);
    expect(multiplier).toBeGreaterThanOrEqual(3.0);
  });

  it('applies surge multiplier when absolute fees exceed 5000 stroops', () => {
    const stats: NetworkFeeStatisticsDto = {
      baseFee: 100,
      p99Fee: 6000,
    };
    const multiplier = calculateSurgeMultiplier(stats);
    expect(multiplier).toBeGreaterThanOrEqual(3.0);
  });

  it('respects minSurgeMultiplier and maxSurgeMultiplier bounds', () => {
    const stats: NetworkFeeStatisticsDto = {
      baseFee: 100,
      p99Fee: 10000,
      ledgerCapacityUsage: 0.99,
    };
    const boundedMultiplier = calculateSurgeMultiplier(stats, {
      maxSurgeMultiplier: 4.5,
    });
    expect(boundedMultiplier).toBeLessThanOrEqual(4.5);

    const minBounded = calculateSurgeMultiplier(
      { baseFee: 100, modeFee: 100 },
      { minSurgeMultiplier: 1.5 },
    );
    expect(minBounded).toBe(1.5);
  });

  it('handles invalid or non-positive baseFee gracefully by using default MIN_BASE_FEE_STROOPS', () => {
    const stats: NetworkFeeStatisticsDto = {
      baseFee: 0,
      p50Fee: 200,
    };
    const multiplier = calculateSurgeMultiplier(stats);
    expect(multiplier).toBeGreaterThanOrEqual(2.0);
  });
});

describe('deriveNetworkCongestionState', () => {
  it('classifies normal network state when metrics are at baseline', () => {
    const stats: NetworkFeeStatisticsDto = {
      baseFee: 100,
      modeFee: 100,
      ledgerCapacityUsage: 0.3,
    };
    const state = deriveNetworkCongestionState(stats, 1.0);
    expect(state).toBe('normal');
  });

  it('classifies busy network state when fees or capacity are moderately high', () => {
    const stats: NetworkFeeStatisticsDto = {
      baseFee: 100,
      p50Fee: 200,
      ledgerCapacityUsage: 0.65,
    };
    const state = deriveNetworkCongestionState(stats, 1.5);
    expect(state).toBe('busy');
  });

  it('classifies congested network state when fees or capacity are very high', () => {
    const stats: NetworkFeeStatisticsDto = {
      baseFee: 100,
      p95Fee: 5500,
      ledgerCapacityUsage: 0.95,
    };
    const state = deriveNetworkCongestionState(stats, 3.5);
    expect(state).toBe('congested');
  });

  it('returns unknown state when base fee is invalid', () => {
    const stats: NetworkFeeStatisticsDto = {
      baseFee: NaN,
    };
    const state = deriveNetworkCongestionState(stats, 1.0);
    expect(state).toBe('unknown');
  });
});

describe('calculateRecommendedFee', () => {
  it('calculates recommended base fee and total fee for low congestion', () => {
    const stats: NetworkFeeStatisticsDto = {
      baseFee: 100,
      modeFee: 100,
      p50Fee: 100,
      ledgerCapacityUsage: 0.2,
    };
    const result = calculateRecommendedFee(stats, { operationCount: 1 });

    expect(result.operationCount).toBe(1);
    expect(result.minRequiredFee).toBe(100);
    expect(result.surgeMultiplier).toBe(1.0);
    expect(result.networkState).toBe('normal');
    expect(result.bufferPercentage).toBe(20);
    // 100 * 1.0 * 1.0 * (1 + 0.2) = 120 stroops
    expect(result.recommendedBaseFee).toBe(120);
    expect(result.recommendedTotalFee).toBe(120);
  });

  it('scales total fee according to operation count', () => {
    const stats: NetworkFeeStatisticsDto = {
      baseFee: 100,
      modeFee: 100,
      p50Fee: 100,
    };
    const result = calculateRecommendedFee(stats, { operationCount: 3 });

    expect(result.operationCount).toBe(3);
    expect(result.minRequiredFee).toBe(300);
    expect(result.recommendedTotalFee).toBe(result.recommendedBaseFee * 3);
  });

  it('sanitizes non-positive or invalid operation count to 1', () => {
    const stats: NetworkFeeStatisticsDto = { baseFee: 100 };
    const result = calculateRecommendedFee(stats, { operationCount: -5 });
    expect(result.operationCount).toBe(1);
    expect(result.recommendedTotalFee).toBe(result.recommendedBaseFee);

    const resultNaN = calculateRecommendedFee(stats, { operationCount: NaN });
    expect(resultNaN.operationCount).toBe(1);
  });

  it('adjusts buffer and multiplier based on priority levels', () => {
    const stats: NetworkFeeStatisticsDto = {
      baseFee: 100,
      p50Fee: 100,
    };

    const low = calculateRecommendedFee(stats, { priority: 'low' });
    const normal = calculateRecommendedFee(stats, { priority: 'normal' });
    const high = calculateRecommendedFee(stats, { priority: 'high' });
    const urgent = calculateRecommendedFee(stats, { priority: 'urgent' });

    expect(low.bufferPercentage).toBe(10);
    expect(normal.bufferPercentage).toBe(20);
    expect(high.bufferPercentage).toBe(35);
    expect(urgent.bufferPercentage).toBe(50);

    expect(low.recommendedBaseFee).toBeLessThanOrEqual(normal.recommendedBaseFee);
    expect(normal.recommendedBaseFee).toBeLessThan(high.recommendedBaseFee);
    expect(high.recommendedBaseFee).toBeLessThan(urgent.recommendedBaseFee);
  });

  it('honors customBufferPercentage override', () => {
    const stats: NetworkFeeStatisticsDto = {
      baseFee: 100,
      p50Fee: 100,
    };
    const result = calculateRecommendedFee(stats, {
      customBufferPercentage: 42,
    });
    expect(result.bufferPercentage).toBe(42);
    // 100 * 1.0 * 1.0 * 1.42 = 142
    expect(result.recommendedBaseFee).toBe(142);
  });

  it('simulates high surge pricing and congestion scenario', () => {
    const stats: NetworkFeeStatisticsDto = {
      baseFee: 100,
      p50Fee: 400,
      p95Fee: 1200,
      ledgerCapacityUsage: 0.92,
    };
    const result = calculateRecommendedFee(stats, {
      operationCount: 2,
      priority: 'urgent',
    });

    expect(result.networkState).toBe('congested');
    expect(result.surgeMultiplier).toBeGreaterThanOrEqual(2.5);
    expect(result.recommendedBaseFee).toBeGreaterThan(1000);
    expect(result.recommendedTotalFee).toBe(result.recommendedBaseFee * 2);
  });

  it('ensures recommendedBaseFee never falls below validBaseFee', () => {
    const stats: NetworkFeeStatisticsDto = {
      baseFee: 500,
      p50Fee: 10, // Unusually low metric
    };
    const result = calculateRecommendedFee(stats, { priority: 'low' });
    expect(result.recommendedBaseFee).toBeGreaterThanOrEqual(500);
  });
});

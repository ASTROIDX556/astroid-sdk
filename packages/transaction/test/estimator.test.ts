import { describe, it, expect, vi } from 'vitest';
import { estimateFee } from '../src/estimator.js';

const TESTNET = '';

// A fake fetch returning a canned Horizon fee_stats body.
function mockFetch(body: unknown, ok = true): typeof fetch {
  return (async () => {
    return {
      ok,
      status: ok ? 200 : 500,
      json: async () => body,
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

describe('estimateFee — fee estimation helper (#564)', () => {
  it('returns recommended base fee and surge multiplier from live Horizon stats', async () => {
    const body = {
      mode_fee: 200,
      ledger_base_fee: 100,
      ledger_max_fee: 500,
    };

    const result = await estimateFee({
      horizonUrl: 'https://horizon-testnet.stellar.org',
      fetch: mockFetch(body),
    });

    expect(result.recommendedBaseFee).toBe(260); // 200 + 30% buffer
    expect(result.surgeMultiplier).toBe(1.0);
    expect(result.networkState).toBe('normal');
    expect(result.live).toBe(true);
  });

  it('falls back to static base fee when Horizon query fails', async () => {
    const result = await estimateFee({
      horizonUrl: 'https://horizon-testnet.stellar.org',
      fetch: mockFetch({}, false),
    });

    expect(result.recommendedBaseFee).toBe(100); // static fallback
    expect(result.surgeMultiplier).toBe(1.0);
    expect(result.networkState).toBe('unknown');
    expect(result.live).toBe(false);
  });

  it('returns static base fee when no horizon URL or fetch is provided', async () => {
    const result = await estimateFee({});

    expect(result.recommendedBaseFee).toBe(100);
    expect(result.surgeMultiplier).toBe(1.0);
    expect(result.networkState).toBe('unknown');
    expect(result.live).toBe(false);
  });

  it('applies a custom buffer percentage', async () => {
    const body = {
      mode_fee: 100,
      ledger_base_fee: 100,
    };

    const result = await estimateFee({
      horizonUrl: 'https://horizon-testnet.stellar.org',
      fetch: mockFetch(body),
      bufferPercentage: 20,
    });

    expect(result.recommendedBaseFee).toBe(120); // 100 + 20% buffer
    expect(result.surgeMultiplier).toBe(1.0);
  });

  it('throws ValidationError when the fee stats query returns invalid data', async () => {
    const badFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ malformed: true }) as unknown as Record<string, unknown>,
    } as unknown as Response);

    await expect(estimateFee({ fetch: badFetch })).rejects.toThrow(ValidationError);
  });

  it('handles missing mode fee by falling back to ledger base fee', async () => {
    const body = {
      ledger_base_fee: 200,
      // mode_fee is missing
    };

    const result = await estimateFee({
      horizonUrl: 'https://horizon-testnet.stellar.org',
      fetch: mockFetch(body as unknown as Record<string, unknown>),
    });

    expect(result.recommendedBaseFee).toBe(260); // 200 + 30% buffer
    expect(result.live).toBe(true);
  });
});
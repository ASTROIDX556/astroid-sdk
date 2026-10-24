import { describe, expect, it } from 'vitest';

import { formatBalance, parseBalance, XLM_DECIMAL_PLACES, DEFAULT_ASSET_DECIMAL_PLACES } from '../balance.js';

describe('formatBalance', () => {
  it('formats a positive stroop amount with 7 decimal places (XLM)', () => {
    expect(formatBalance(12500000n, 7)).toBe('1.2500000');
  });

  it('formats zero balance with 7 decimal places', () => {
    expect(formatBalance(0n, 7)).toBe('0.0000000');
  });

  it('formats full XLM balance', () => {
    expect(formatBalance(10000000n, 7)).toBe('1.0000000');
  });

  it('formats a very large stroop amount', () => {
    expect(formatBalance(99999999n, 7)).toBe('9.9999999');
  });

  it('formats minimum positive stroop amount', () => {
    expect(formatBalance(1n, 7)).toBe('0.0000001');
  });

  it('formats with custom decimal places', () => {
    expect(formatBalance(5000000n, 6)).toBe('0.500000');
    expect(formatBalance(12345n, 3)).toBe('12.345');
  });

  it('throws on negative stroops', () => {
    expect(() => formatBalance(-1n, 7)).toThrow('Balance cannot be negative');
  });
});

describe('parseBalance', () => {
  it('parses a valid XLM balance string back to stroops', () => {
    expect(parseBalance('1.2500000', 7)).toBe(12500000n);
  });

  it('parses zero balance', () => {
    expect(parseBalance('0.0000000', 7)).toBe(0n);
  });

  it('parses minimum positive amount', () => {
    expect(parseBalance('0.0000001', 7)).toBe(1n);
  });

  it('parses with custom decimal places', () => {
    expect(parseBalance('0.500000', 6)).toBe(500000n);
    expect(parseBalance('12.345', 3)).toBe(12345n);
  });

  it('parses whole number without decimal point', () => {
    expect(parseBalance('1', 7)).toBe(10000000n);
    expect(parseBalance('0', 7)).toBe(0n);
  });

  it('throws on negative amounts', () => {
    expect(() => parseBalance('-1.2500000', 7)).toThrow('Balance cannot be negative');
  });

  it('handles integer-only strings', () => {
    expect(parseBalance('123', 2)).toBe(12300n);
  });
});

describe('balance utility constants', () => {
  it('XLM_DECIMAL_PLACES is 7', () => {
    expect(XLM_DECIMAL_PLACES).toBe(7);
  });

  it('DEFAULT_ASSET_DECIMAL_PLACES is 7', () => {
    expect(DEFAULT_ASSET_DECIMAL_PLACES).toBe(7);
  });
});
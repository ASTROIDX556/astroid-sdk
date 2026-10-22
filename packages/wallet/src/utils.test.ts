import { describe, it, expect } from 'vitest';
import { ValidationError } from '@astroid/errors';
import {
  STELLAR_DECIMALS,
  STROOPS_PER_UNIT,
  toBaseUnits,
  fromBaseUnits,
  formatAmount,
  isValidStellarAmount,
  type FormatRoundingMode,
} from './utils.js';

/* -------------------------------------------------------------------------- */
/* Fixtures & helpers                                                          */
/* -------------------------------------------------------------------------- */

const INT64_MAX = 9_223_372_036_854_775_807n;
const INT64_MAX_DECIMAL = '922337203685.4775807';
// 2^53 + 1: the smallest integer a double cannot represent.
const ABOVE_MAX_SAFE_INTEGER = 9_007_199_254_740_993n;

/** Run `fn` expecting a structured ValidationError, and return it. */
function captureValidationError(fn: () => unknown): ValidationError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ValidationError);
    return error as ValidationError;
  }
  throw new Error('Expected a ValidationError, but the function returned normally.');
}

/** Strip leading zeros and trailing fraction zeros from a decimal string. */
function normalise(value: string): string {
  const [intPart = '0', fracPart = ''] = value.split('.');
  const trimmed = fracPart.replace(/0+$/, '');
  return trimmed.length > 0 ? `${BigInt(intPart)}.${trimmed}` : BigInt(intPart).toString();
}

/* -------------------------------------------------------------------------- */
/* Constants                                                                   */
/* -------------------------------------------------------------------------- */

describe('amount constants', () => {
  it('exposes the 7-decimal Stellar precision', () => {
    expect(STELLAR_DECIMALS).toBe(7);
    expect(STROOPS_PER_UNIT).toBe(10_000_000n);
    expect(STROOPS_PER_UNIT).toBe(10n ** BigInt(STELLAR_DECIMALS));
  });
});

/* -------------------------------------------------------------------------- */
/* toBaseUnits                                                                 */
/* -------------------------------------------------------------------------- */

describe('toBaseUnits', () => {
  const validCases: Array<[string, bigint]> = [
    ['0', 0n],
    ['0.0', 0n],
    ['0.0000001', 1n],
    ['0.1', 1_000_000n],
    ['1', 10_000_000n],
    ['1.5', 15_000_000n],
    ['1.5000000', 15_000_000n],
    ['0001.5', 15_000_000n],
    ['10.0000000', 100_000_000n],
    ['.5', 5_000_000n],
    ['1.', 10_000_000n],
    [INT64_MAX_DECIMAL, INT64_MAX],
  ];

  it.each(validCases)('parses %s as %s base units', (amount, expected) => {
    expect(toBaseUnits(amount)).toBe(expected);
  });

  it('accepts 7 fraction digits but rejects an 8th', () => {
    expect(toBaseUnits('0.1234567')).toBe(1_234_567n);

    const error = captureValidationError(() => toBaseUnits('0.12345678'));
    expect(error.code).toBe('INVALID_AMOUNT');
    expect(error.message).toContain('"0.12345678"');
    expect(error.message).toContain('at most 7 decimal places');
    expect(error.message).toContain('received 8');
  });

  it.each([
    ['1', 0, 1n],
    ['1.23', 2, 123n],
    ['0.000000000000000001', 18, 1n],
  ])('supports %s with %i decimals', (amount, decimals, expected) => {
    expect(toBaseUnits(amount, decimals)).toBe(expected);
  });

  it('rejects more fraction digits than the configured decimals', () => {
    const error = captureValidationError(() => toBaseUnits('1.234', 2));
    expect(error.code).toBe('INVALID_AMOUNT');
    expect(error.message).toContain('at most 2 decimal places');
    expect(error.message).toContain('received 3');
  });

  const invalidCases = [
    '',
    ' ',
    'abc',
    '1e7',
    '1E7',
    '1.2.3',
    '1,000',
    '-',
    '+1',
    '-1',
    '-0',
    'NaN',
    'Infinity',
    '.',
    '1 000',
    ' 1',
    '1 ',
    '$1',
  ];

  it.each(invalidCases)('rejects malformed input %j', (amount) => {
    const error = captureValidationError(() => toBaseUnits(amount));
    expect(error.code).toBe('INVALID_AMOUNT');
    expect(error.message).toContain(amount === '' ? 'Invalid amount ""' : `"${amount}"`);
  });

  it('names the rule when a sign is supplied', () => {
    const error = captureValidationError(() => toBaseUnits('+1'));
    expect(error.message).toContain('signs are not supported');
  });

  it('rejects decimals outside the 0–18 integer range', () => {
    for (const decimals of [-1, 19, 1.5, Number.NaN]) {
      const error = captureValidationError(() => toBaseUnits('1', decimals));
      expect(error.code).toBe('INVALID_DECIMALS');
      expect(error.message).toContain(String(decimals));
      expect(error.message).toContain('between 0 and 18');
    }
  });

  it('rejects non-string input at runtime', () => {
    const error = captureValidationError(() => toBaseUnits(1.5 as unknown as string));
    expect(error.code).toBe('INVALID_AMOUNT');
    expect(error.message).toContain('1.5');
  });
});

/* -------------------------------------------------------------------------- */
/* fromBaseUnits                                                               */
/* -------------------------------------------------------------------------- */

describe('fromBaseUnits', () => {
  const cases: Array<[string | bigint, string]> = [
    ['0', '0'],
    [0n, '0'],
    ['1', '0.0000001'],
    [1n, '0.0000001'],
    ['1000000', '0.1'],
    ['10000000', '1'],
    [15_000_000n, '1.5'],
    ['00015000000', '1.5'],
    ['-15000000', '-1.5'],
    [-1n, '-0.0000001'],
    [ABOVE_MAX_SAFE_INTEGER, '900719925.4740993'],
    [INT64_MAX, INT64_MAX_DECIMAL],
  ];

  it.each(cases)('formats %s as %s', (baseUnits, expected) => {
    expect(fromBaseUnits(baseUnits)).toBe(expected);
  });

  it('trims trailing zeros by default and keeps them when asked', () => {
    expect(fromBaseUnits('15000000')).toBe('1.5');
    expect(fromBaseUnits('15000000', STELLAR_DECIMALS, { trimTrailingZeros: false })).toBe(
      '1.5000000',
    );
    expect(fromBaseUnits(0n, STELLAR_DECIMALS, { trimTrailingZeros: false })).toBe('0.0000000');
  });

  it.each([
    ['1', 0, '1'],
    ['123', 2, '1.23'],
    ['1', 18, '0.000000000000000001'],
  ])('supports %s with %i decimals', (baseUnits, decimals, expected) => {
    expect(fromBaseUnits(baseUnits, decimals)).toBe(expected);
  });

  it.each(['1.5', '', ' ', 'abc', '+1', '1e7', '-', '1,000'])(
    'rejects non-integer base units %j',
    (baseUnits) => {
      const error = captureValidationError(() => fromBaseUnits(baseUnits));
      expect(error.code).toBe('INVALID_AMOUNT');
      expect(error.message).toContain('expected an integer string of digits');
    },
  );

  it('rejects invalid decimals', () => {
    expect(captureValidationError(() => fromBaseUnits(1n, 19)).code).toBe('INVALID_DECIMALS');
  });
});

/* -------------------------------------------------------------------------- */
/* formatAmount                                                                */
/* -------------------------------------------------------------------------- */

describe('formatAmount', () => {
  it('formats the default 7-decimal precision', () => {
    expect(formatAmount(0n)).toBe('0');
    expect(formatAmount(15_000_000n)).toBe('1.5');
    expect(formatAmount('1')).toBe('0.0000001');
    expect(formatAmount('123456789012345')).toBe('12345678.9012345');
  });

  it('groups only the integer part when grouping is enabled', () => {
    expect(formatAmount('123456789012345', { grouping: true })).toBe('12,345,678.9012345');
    expect(formatAmount('123456789012345', { grouping: true, thousandsSeparator: '_' })).toBe(
      '12_345_678.9012345',
    );
    expect(formatAmount('123456789012345')).toBe('12345678.9012345');
  });

  it('applies min and max fraction digits', () => {
    expect(formatAmount(15_000_000n, { minFractionDigits: 4 })).toBe('1.5000');
    expect(formatAmount(0n, { minFractionDigits: 2 })).toBe('0.00');
    expect(formatAmount(1_234_567n, { maxFractionDigits: 6 })).toBe('0.123456');
    expect(formatAmount(15_000_000n, { maxFractionDigits: 0 })).toBe('1');
  });

  it('truncates by default and can round half-up', () => {
    const truncate: FormatRoundingMode = 'truncate';
    const halfUp: FormatRoundingMode = 'half-up';

    expect(formatAmount(1_234_567n, { maxFractionDigits: 6, rounding: truncate })).toBe('0.123456');
    expect(formatAmount(1_234_567n, { maxFractionDigits: 6, rounding: halfUp })).toBe('0.123457');
  });

  it('respects rounding boundaries without overstating the default result', () => {
    // 1234567.9999999: the default truncation keeps 1234567.99, never 1234568.
    expect(formatAmount('12345679999999', { maxFractionDigits: 2 })).toBe('1234567.99');
    expect(
      formatAmount('12345679999999', {
        maxFractionDigits: 2,
        minFractionDigits: 2,
        rounding: 'half-up',
      }),
    ).toBe('1234568.00');
    expect(formatAmount(19_999_999n, { maxFractionDigits: 0, rounding: 'half-up' })).toBe('2');
    expect(formatAmount(19_999_999n, { maxFractionDigits: 0 })).toBe('1');
  });

  it('formats negative amounts and keeps grouping', () => {
    expect(formatAmount(-15_000_000n)).toBe('-1.5');
    expect(formatAmount('-123456789012345', { grouping: true })).toBe('-12,345,678.9012345');
  });

  it('supports prefix and suffix symbols', () => {
    expect(formatAmount(15_000_000n, { symbol: 'XLM' })).toBe('1.5 XLM');
    expect(formatAmount(-15_000_000n, { symbol: 'XLM' })).toBe('-1.5 XLM');
    expect(formatAmount(15_000_000n, { symbol: '$', symbolPosition: 'prefix' })).toBe('$1.5');
    expect(formatAmount(-15_000_000n, { symbol: '$', symbolPosition: 'prefix' })).toBe('-$1.5');
  });

  it('supports other decimal precisions', () => {
    expect(formatAmount(123n, { decimals: 2 })).toBe('1.23');
    expect(formatAmount(42n, { decimals: 0 })).toBe('42');
    expect(formatAmount(1n, { decimals: 18 })).toBe('0.000000000000000001');
  });

  it('rejects invalid fraction-digit options', () => {
    const inverted = captureValidationError(() =>
      formatAmount(1n, { minFractionDigits: 3, maxFractionDigits: 1 }),
    );
    expect(inverted.code).toBe('INVALID_FRACTION_DIGITS');
    expect(inverted.message).toContain('minFractionDigits (3)');
    expect(inverted.message).toContain('maxFractionDigits (1)');

    expect(captureValidationError(() => formatAmount(1n, { maxFractionDigits: 8 })).code).toBe(
      'INVALID_FRACTION_DIGITS',
    );
    expect(captureValidationError(() => formatAmount(1n, { minFractionDigits: -1 })).code).toBe(
      'INVALID_FRACTION_DIGITS',
    );
  });

  it('rejects non-integer and invalid-decimal input', () => {
    expect(captureValidationError(() => formatAmount('1.5')).code).toBe('INVALID_AMOUNT');
    expect(captureValidationError(() => formatAmount(1n, { decimals: 19 })).code).toBe(
      'INVALID_DECIMALS',
    );
  });
});

/* -------------------------------------------------------------------------- */
/* isValidStellarAmount                                                        */
/* -------------------------------------------------------------------------- */

describe('isValidStellarAmount', () => {
  it.each([0n, 1n, ABOVE_MAX_SAFE_INTEGER, INT64_MAX, '0', '1', '0001', '9223372036854775807'])(
    'accepts in-range amount %s',
    (value) => {
      expect(isValidStellarAmount(value)).toBe(true);
    },
  );

  it.each([
    INT64_MAX + 1n,
    '9223372036854775808',
    -1n,
    '-1',
    '1.5',
    '.5',
    '+1',
    '',
    ' ',
    'abc',
    '1e7',
    '1,000',
    null,
    undefined,
    1,
    Number.MAX_SAFE_INTEGER,
  ])('rejects invalid amount %s', (value) => {
    expect(isValidStellarAmount(value)).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Round-trip properties                                                       */
/* -------------------------------------------------------------------------- */

describe('round-trip conversion', () => {
  it.each([0n, 1n, 10n, 1_000_000n, 10_000_000n, 15_000_000n, ABOVE_MAX_SAFE_INTEGER, INT64_MAX])(
    'fromBaseUnits → toBaseUnits preserves %s',
    (baseUnits) => {
      expect(toBaseUnits(fromBaseUnits(baseUnits))).toBe(baseUnits);
    },
  );

  it.each([
    '0',
    '0.0000001',
    '0.1',
    '1',
    '1.5',
    '1.5000000',
    '0001.5',
    '123456.7890123',
    '900719925.4740993',
    INT64_MAX_DECIMAL,
  ])('toBaseUnits → fromBaseUnits normalises %s', (amount) => {
    expect(fromBaseUnits(toBaseUnits(amount))).toBe(normalise(amount));
  });

  it('round-trips other precisions', () => {
    expect(toBaseUnits(fromBaseUnits(123n, 2), 2)).toBe(123n);
    expect(toBaseUnits(fromBaseUnits(1n, 18), 18)).toBe(1n);
    expect(toBaseUnits(fromBaseUnits(42n, 0), 0)).toBe(42n);
  });
});

/* -------------------------------------------------------------------------- */
/* Precision regression                                                        */
/* -------------------------------------------------------------------------- */

describe('float precision regression', () => {
  it('keeps the last stroop of 2^53 + 1 that Number math would drop', () => {
    // 2^53 + 1 = 9007199254740993 stroops. A double cannot represent that
    // integer, so Number/parseFloat/toFixed would produce ...992 (or a nearby
    // value) and lose one base unit. bigint arithmetic keeps it exact.
    expect(toBaseUnits('900719925.4740993')).toBe(ABOVE_MAX_SAFE_INTEGER);
    // Compare as bigints: the Number literal for 2^53 + 1 rounds to 2^53 too.
    expect(BigInt(Number('900719925.4740993') * 10 ** 7)).not.toBe(ABOVE_MAX_SAFE_INTEGER);
  });

  it('converts int64 max without double rounding', () => {
    // Number(9223372036854775807n) rounds up to 2^63, one stroop too many.
    expect(fromBaseUnits(INT64_MAX)).toBe(INT64_MAX_DECIMAL);
    expect(Number(INT64_MAX)).toBe(9_223_372_036_854_775_808);
  });
});

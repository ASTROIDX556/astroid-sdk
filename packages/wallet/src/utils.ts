/**
 * `@astroid/wallet` — Stellar amount conversion and display helpers.
 *
 * Stellar ledger amounts are 64-bit integer strings in base units ("stroops"
 * for XLM): one whole unit is `10^7` base units. Every helper in this module
 * works on `bigint` and digit strings — never on `Number` — so amounts beyond
 * `Number.MAX_SAFE_INTEGER` round-trip exactly.
 *
 * - {@link toBaseUnits} — strict human-readable decimal string → base units.
 * - {@link fromBaseUnits} — base units → human-readable decimal string.
 * - {@link formatAmount} — display formatter with grouping, fraction limits,
 *   explicit rounding, and an optional asset symbol.
 * - {@link isValidStellarAmount} — non-negative int64 ledger-amount guard.
 *
 * @module
 */

import { ValidationError } from '@astroid/errors';

/* -------------------------------------------------------------------------- */
/* Constants                                                                   */
/* -------------------------------------------------------------------------- */

/** Decimal places used by Stellar ledger amounts (stroops for XLM). */
export const STELLAR_DECIMALS = 7;

/** Base units in one whole unit at {@link STELLAR_DECIMALS} precision (`10^7`). */
export const STROOPS_PER_UNIT = 10_000_000n;

/** Largest value a signed 64-bit integer can hold — Stellar's ledger amount limit. */
const MAX_INT64 = 9_223_372_036_854_775_807n;

/** Smallest supported precision, in decimal places. */
const MIN_DECIMALS = 0;

/** Largest supported precision, in decimal places. */
const MAX_DECIMALS = 18;

const BASE_UNITS_PATTERN = /^-?\d+$/;
const DECIMAL_PATTERN = /^(\d*)(?:\.(\d*))?$/;

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

/** Options accepted by {@link fromBaseUnits}. */
export interface FromBaseUnitsOptions {
  /**
   * Keep the full `decimals`-length fraction instead of trimming trailing
   * zeros. Defaults to `false` ("1.5000000" → "1.5").
   */
  trimTrailingZeros?: boolean;
}

/** Rounding applied by {@link formatAmount} when digits must be dropped. */
export type FormatRoundingMode = 'truncate' | 'half-up';

/** Options accepted by {@link formatAmount}. */
export interface FormatAmountOptions {
  /** Ledger precision of the input, in decimal places. Defaults to 7. */
  decimals?: number;
  /** Minimum fraction digits to show (zero-padded). Defaults to 0. */
  minFractionDigits?: number;
  /** Maximum fraction digits to show. Defaults to `decimals`. */
  maxFractionDigits?: number;
  /** Insert a thousands separator in the integer part. Defaults to `false`. */
  grouping?: boolean;
  /** Separator used when `grouping` is enabled. Defaults to `","`. */
  thousandsSeparator?: string;
  /**
   * Rounding used when the value has more than `maxFractionDigits` fraction
   * digits. Defaults to `"truncate"` (toward zero) so a balance is never
   * overstated.
   */
  rounding?: FormatRoundingMode;
  /** Optional asset code or currency symbol, e.g. `"XLM"` or `"$"`. */
  symbol?: string;
  /** Where to place `symbol`. Defaults to `"suffix"`. */
  symbolPosition?: 'prefix' | 'suffix';
}

/* -------------------------------------------------------------------------- */
/* Internal validation                                                         */
/* -------------------------------------------------------------------------- */

/** Validate a precision value and return it unchanged. */
function assertDecimals(decimals: number): number {
  if (!Number.isInteger(decimals) || decimals < MIN_DECIMALS || decimals > MAX_DECIMALS) {
    throw new ValidationError(
      `Invalid decimals ${String(decimals)}: expected an integer between ${MIN_DECIMALS} and ${MAX_DECIMALS}.`,
      { code: 'INVALID_DECIMALS' },
    );
  }
  return decimals;
}

/** Validate a fraction-digit count for {@link formatAmount}. */
function assertFractionDigits(value: number, name: string, decimals: number): number {
  if (!Number.isInteger(value) || value < 0 || value > decimals) {
    throw new ValidationError(
      `Invalid ${name} ${String(value)}: expected an integer between 0 and ${decimals}.`,
      { code: 'INVALID_FRACTION_DIGITS' },
    );
  }
  return value;
}

/** Render an unknown value for an error message without throwing on symbols. */
function describeValue(value: unknown): string {
  return typeof value === 'string' ? value : String(value);
}

/** Parse a base-unit amount (`string` of digits or `bigint`) exactly. */
function parseBaseUnits(value: string | bigint): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value !== 'string' || !BASE_UNITS_PATTERN.test(value)) {
    throw new ValidationError(
      `Invalid base-unit amount "${describeValue(value)}": expected an integer string of digits ` +
        `(no decimal point, sign prefix, whitespace, or exponent notation).`,
      { code: 'INVALID_AMOUNT' },
    );
  }
  return BigInt(value);
}

/* -------------------------------------------------------------------------- */
/* Conversion                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Convert a human-readable decimal amount to integer base units.
 *
 * Parsing is strict: the input must be a non-negative decimal string with at
 * most `decimals` fraction digits. Signs (including `"+"`), whitespace,
 * exponent notation (`"1e7"`), thousands separators (`"1,000"`), multiple
 * decimal points, and any non-digit character are rejected. Surrounding
 * syntax `".5"` and `"1."` is accepted because both are unambiguous decimal
 * notations; leading zeros are allowed and normalised.
 *
 * All arithmetic is `bigint`-based, so no floating-point precision is lost.
 *
 * @param amount   Decimal string, e.g. `"1.5"`.
 * @param decimals Ledger precision, an integer between 0 and 18. Defaults to 7.
 * @returns The amount in base units as a `bigint`.
 * @throws {ValidationError} `INVALID_DECIMALS` when `decimals` is out of range;
 *                           `INVALID_AMOUNT` when `amount` is malformed, too
 *                           precise, or negative.
 *
 * @example
 * ```ts
 * toBaseUnits('1.5');          // 15000000n
 * toBaseUnits('.0000001');     // 1n
 * toBaseUnits('1.5', 2);       // 150n
 * ```
 */
export function toBaseUnits(amount: string, decimals: number = STELLAR_DECIMALS): bigint {
  const scale = assertDecimals(decimals);

  if (typeof amount !== 'string') {
    throw new ValidationError(
      `Invalid amount ${describeValue(amount)}: expected a decimal string.`,
      { code: 'INVALID_AMOUNT' },
    );
  }
  if (amount.length === 0) {
    throw new ValidationError('Invalid amount "": expected a non-empty decimal string.', {
      code: 'INVALID_AMOUNT',
    });
  }

  const match = DECIMAL_PATTERN.exec(amount);
  if (!match) {
    if (/^[+-]/.test(amount)) {
      throw new ValidationError(
        `Invalid amount "${amount}": signs are not supported; amounts must be non-negative ` +
          `decimal strings.`,
        { code: 'INVALID_AMOUNT' },
      );
    }
    throw new ValidationError(
      `Invalid amount "${amount}": expected digits with at most one decimal point ` +
        `(no whitespace, exponent notation, or grouping separators).`,
      { code: 'INVALID_AMOUNT' },
    );
  }

  const intPart = match[1] ?? '';
  const fracPart = match[2] ?? '';
  if (intPart.length === 0 && fracPart.length === 0) {
    throw new ValidationError(
      `Invalid amount "${amount}": expected at least one digit before or after the decimal point.`,
      { code: 'INVALID_AMOUNT' },
    );
  }
  if (fracPart.length > scale) {
    throw new ValidationError(
      `Invalid amount "${amount}": at most ${scale} decimal place${scale === 1 ? '' : 's'} ` +
        `allowed, received ${fracPart.length}.`,
      { code: 'INVALID_AMOUNT' },
    );
  }

  return BigInt((intPart || '0') + fracPart.padEnd(scale, '0'));
}

/**
 * Convert integer base units to a human-readable decimal string.
 *
 * Works for any integer size (`bigint` internally) and preserves sign, so
 * int64 max formats exactly as `"922337203685.4775807"`. Trailing fraction
 * zeros are trimmed unless `trimTrailingZeros` is `false`.
 *
 * @param baseUnits Base units as a `bigint` or an integer string.
 * @param decimals  Ledger precision, an integer between 0 and 18. Defaults to 7.
 * @param options   `trimTrailingZeros` (default `true`).
 * @returns Decimal string such as `"1.5"`, `"0.0000001"`, or `"0"`.
 * @throws {ValidationError} `INVALID_DECIMALS` when `decimals` is out of range;
 *                           `INVALID_AMOUNT` when `baseUnits` is not an integer.
 *
 * @example
 * ```ts
 * fromBaseUnits(15000000n);                    // '1.5'
 * fromBaseUnits('1');                          // '0.0000001'
 * fromBaseUnits(15000000n, 7, { trimTrailingZeros: false }); // '1.5000000'
 * ```
 */
export function fromBaseUnits(
  baseUnits: string | bigint,
  decimals: number = STELLAR_DECIMALS,
  options: FromBaseUnitsOptions = {},
): string {
  const scale = assertDecimals(decimals);
  const value = parseBaseUnits(baseUnits);
  const negative = value < 0n;
  const abs = negative ? -value : value;

  const digits = abs.toString().padStart(scale + 1, '0');
  const intPart = digits.slice(0, digits.length - scale);
  let fracPart = digits.slice(digits.length - scale);

  if (options.trimTrailingZeros !== false) {
    fracPart = fracPart.replace(/0+$/, '');
  }

  const sign = negative ? '-' : '';
  return fracPart.length > 0 ? `${sign}${intPart}.${fracPart}` : `${sign}${intPart}`;
}

/**
 * Format integer base units for display in an agent UI.
 *
 * Built on {@link fromBaseUnits}, so the numeric value never passes through
 * `Number`. Grouping is applied to the integer digits only. Rounding defaults
 * to truncation toward zero (never overstates a non-negative balance); pass
 * `rounding: "half-up"` for conventional half-away-from-zero rounding.
 *
 * @param baseUnits Base units as a `bigint` or an integer string.
 * @param options   Display options; see {@link FormatAmountOptions}.
 * @returns Formatted amount, e.g. `"12,345,678.9012345 XLM"`.
 * @throws {ValidationError} `INVALID_DECIMALS` / `INVALID_FRACTION_DIGITS` for
 *                           bad options; `INVALID_AMOUNT` for malformed input.
 *
 * @example
 * ```ts
 * formatAmount(15000000n);                                          // '1.5'
 * formatAmount(123456789012345n, { grouping: true, symbol: 'XLM' }); // '12,345,678.9012345 XLM'
 * formatAmount(1234567n, { maxFractionDigits: 6, rounding: 'half-up' }); // '0.123457'
 * ```
 */
export function formatAmount(
  baseUnits: string | bigint,
  options: FormatAmountOptions = {},
): string {
  const scale = assertDecimals(options.decimals ?? STELLAR_DECIMALS);
  const minDigits = assertFractionDigits(
    options.minFractionDigits ?? 0,
    'minFractionDigits',
    scale,
  );
  const maxDigits = assertFractionDigits(
    options.maxFractionDigits ?? scale,
    'maxFractionDigits',
    scale,
  );
  if (minDigits > maxDigits) {
    throw new ValidationError(
      `Invalid fraction digits: minFractionDigits (${minDigits}) must not exceed ` +
        `maxFractionDigits (${maxDigits}).`,
      { code: 'INVALID_FRACTION_DIGITS' },
    );
  }

  const value = parseBaseUnits(baseUnits);
  const negative = value < 0n;
  let scaled = negative ? -value : value;

  // Reduce to `maxDigits` fraction digits using bigint arithmetic only.
  if (maxDigits < scale) {
    const divisor = 10n ** BigInt(scale - maxDigits);
    const quotient = scaled / divisor;
    if (options.rounding === 'half-up' && (scaled % divisor) * 2n >= divisor) {
      scaled = quotient + 1n;
    } else {
      scaled = quotient;
    }
  }

  const digits =
    maxDigits === 0 ? scaled.toString() : scaled.toString().padStart(maxDigits + 1, '0');
  let intPart = maxDigits === 0 ? digits : digits.slice(0, digits.length - maxDigits);
  let fracPart = maxDigits === 0 ? '' : digits.slice(digits.length - maxDigits);

  while (fracPart.length > minDigits && fracPart.endsWith('0')) {
    fracPart = fracPart.slice(0, -1);
  }

  if (options.grouping) {
    intPart = groupDigits(intPart, options.thousandsSeparator ?? ',');
  }

  const sign = negative ? '-' : '';
  const numeric = `${intPart}${fracPart.length > 0 ? `.${fracPart}` : ''}`;
  const symbol = options.symbol;
  if (!symbol) return `${sign}${numeric}`;
  return options.symbolPosition === 'prefix'
    ? `${sign}${symbol}${numeric}`
    : `${sign}${numeric} ${symbol}`;
}

/** Insert a separator every three digits of an integer string. */
function groupDigits(digits: string, separator: string): string {
  if (separator.length === 0) return digits;
  let out = '';
  for (let i = 0; i < digits.length; i += 1) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += separator;
    out += digits[i] ?? '';
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Validation                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Check whether a value is a valid non-negative Stellar ledger amount.
 *
 * Accepts a `bigint` or an integer digit string in base units and checks the
 * signed int64 range Stellar uses (`0` to `9223372036854775807`). Human-
 * readable decimals (`"1.5"`), signs, whitespace, and non-digit strings are
 * invalid. Wallet balances and transfer amounts are non-negative in the
 * Astroid API, so negatives are not accepted.
 *
 * @param value Candidate base-unit amount.
 * @returns `true` when the amount fits Stellar's ledger range.
 *
 * @example
 * ```ts
 * isValidStellarAmount('9223372036854775807'); // true
 * isValidStellarAmount('9223372036854775808'); // false
 * isValidStellarAmount('1.5');                 // false (decimal, not base units)
 * ```
 */
export function isValidStellarAmount(value: unknown): boolean {
  if (typeof value === 'bigint') return value >= 0n && value <= MAX_INT64;
  if (typeof value !== 'string' || !BASE_UNITS_PATTERN.test(value)) return false;
  if (value.startsWith('-')) return false;
  return BigInt(value) <= MAX_INT64;
}

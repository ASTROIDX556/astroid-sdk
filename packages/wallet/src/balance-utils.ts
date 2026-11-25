/**
 * `@astroid/wallet` — balance aggregation, formatting and conversion helpers.
 *
 * Wallet balance DTOs carry amounts as decimal strings. Every helper here
 * parses those strings into `bigint` units before doing arithmetic or
 * formatting, so values beyond `Number.MAX_SAFE_INTEGER` and fractions such as
 * `0.1 + 0.2` stay exact. Native XLM (no issuer) and issued trustline assets
 * (`code` + `issuer`) are kept distinct throughout.
 *
 * @module
 */

import { ValidationError } from '@astroid/errors';
import type { AssetBalance, WalletBalance } from '@astroid/types';

import { STELLAR_DECIMALS, fromBaseUnits, toBaseUnits } from './utils.js';

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

/** An asset balance produced by summing one or more source balances. */
export interface AggregatedAssetBalance extends AssetBalance {
  /** Number of source balances combined into this total. */
  sources: number;
}

/** A grouped view of a wallet balance snapshot. */
export interface WalletBalanceSummary {
  /** Every distinct asset, with equal assets already summed. */
  assets: AggregatedAssetBalance[];
  /** The aggregated native XLM balance, when the wallet holds XLM. */
  native: AggregatedAssetBalance | undefined;
  /** The aggregated issued (trustline) balances. */
  issued: AggregatedAssetBalance[];
  /** Number of distinct assets held by the wallet. */
  totalAssets: number;
}

/** Display options for {@link formatAssetAmount}. */
export interface AssetAmountFormatOptions {
  /** Group integer digits. Defaults to `true`. */
  grouping?: boolean;
  /** Thousands separator. Defaults to `","`. */
  thousandsSeparator?: string;
  /** Decimal separator. Defaults to `"."`. */
  decimalSeparator?: string;
  /** Minimum fraction digits to display, zero-padded. Defaults to `0`. */
  minFractionDigits?: number;
  /** Maximum fraction digits to display. Defaults to the input's precision. */
  maxFractionDigits?: number;
  /** Rounding when dropping fraction digits. Defaults to `"truncate"`. */
  rounding?: 'truncate' | 'half-up';
  /** Optional asset code or symbol appended to the amount. */
  symbol?: string;
  /** Placement of `symbol`. Defaults to `"suffix"`. */
  symbolPosition?: 'prefix' | 'suffix';
}

/* -------------------------------------------------------------------------- */
/* Internal helpers                                                            */
/* -------------------------------------------------------------------------- */

const DECIMAL_PATTERN = /^(-?)(\d+)(?:\.(\d+))?$/;

interface ParsedDecimal {
  units: bigint;
  scale: number;
  negative: boolean;
}

function invalidAmount(value: string, reason: string): ValidationError {
  return new ValidationError(`Invalid balance amount "${value}": ${reason}`, {
    code: 'INVALID_AMOUNT',
  });
}

/** Parse a decimal string into scaled integer units without floating point. */
function parseDecimal(value: string): ParsedDecimal {
  if (typeof value !== 'string') {
    throw invalidAmount(String(value), 'expected a decimal string.');
  }

  const match = DECIMAL_PATTERN.exec(value);
  if (!match) {
    throw invalidAmount(value, 'expected a decimal string such as "12.5".');
  }

  const [, sign = '', integer = '', fraction = ''] = match;
  const negative = sign === '-';
  return {
    units: BigInt(`${negative ? '-' : ''}${integer}${fraction}`),
    scale: fraction.length,
    negative,
  };
}

/** Render scaled integer units as a decimal string, trimming trailing zeros. */
function formatDecimal(units: bigint, scale: number): string {
  const negative = units < 0n;
  const digits = (negative ? -units : units).toString().padStart(scale + 1, '0');
  const integer = scale === 0 ? digits : digits.slice(0, digits.length - scale);
  const fraction = scale === 0 ? '' : digits.slice(digits.length - scale).replace(/0+$/, '');
  const normalizedInteger = integer.replace(/^0+(?=\d)/, '') || '0';
  return `${negative ? '-' : ''}${normalizedInteger}${fraction === '' ? '' : `.${fraction}`}`;
}

/** Add two exact decimal strings using BigInt arithmetic. */
function addDecimals(a: string, b: string): string {
  const left = parseDecimal(a);
  const right = parseDecimal(b);
  const scale = Math.max(left.scale, right.scale);
  const leftUnits = left.units * 10n ** BigInt(scale - left.scale);
  const rightUnits = right.units * 10n ** BigInt(scale - right.scale);
  return formatDecimal(leftUnits + rightUnits, scale);
}

/** Insert a separator every three integer digits. */
function groupDigits(digits: string, separator: string): string {
  if (separator.length === 0) return digits;

  let grouped = '';
  for (let index = 0; index < digits.length; index += 1) {
    if (index > 0 && (digits.length - index) % 3 === 0) grouped += separator;
    grouped += digits[index] ?? '';
  }
  return grouped;
}

function assertFractionDigits(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new ValidationError(
      `Invalid ${name} ${String(value)}: expected a non-negative integer.`,
      { code: 'INVALID_FRACTION_DIGITS' },
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Asset identity                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Whether a balance describes native XLM rather than an issued trustline.
 *
 * `XLM` and `NATIVE` are both recognised, case-insensitively. An issuer makes
 * the balance issued even when the code is `XLM`.
 */
export function isNativeAssetBalance(balance: AssetBalance): boolean {
  const code = balance.asset.toUpperCase();
  const issuer = balance.issuer;
  const nativeCode = code === 'XLM' || code === 'NATIVE';
  const nativeIssuer =
    issuer === undefined || issuer === null || issuer === '' || issuer.toUpperCase() === 'NATIVE';
  return nativeCode && nativeIssuer;
}

/**
 * Canonical grouping key for an asset balance: `XLM` for native XLM and
 * `CODE:ISSUER` for issued assets. Asset codes are case-insensitive; issuers
 * are compared exactly.
 */
export function assetBalanceKey(balance: AssetBalance): string {
  if (isNativeAssetBalance(balance)) return 'XLM';
  return `${balance.asset.toUpperCase()}:${balance.issuer ?? ''}`;
}

/** Find a balance by code (optionally `CODE:ISSUER`) or code plus issuer. */
export function findAssetBalance(
  snapshot: WalletBalance,
  asset: string,
  issuer?: string | null,
): AssetBalance | undefined {
  const separator = asset.indexOf(':');
  const code = separator === -1 ? asset : asset.slice(0, separator);
  const resolvedIssuer = separator === -1 ? issuer : asset.slice(separator + 1);
  const key = assetBalanceKey({ asset: code, balance: '0', issuer: resolvedIssuer ?? undefined });
  return snapshot.balances.find((balance) => assetBalanceKey(balance) === key);
}

/** Find the native XLM balance in a wallet snapshot, when present. */
export function findNativeBalance(snapshot: WalletBalance): AssetBalance | undefined {
  return snapshot.balances.find(isNativeAssetBalance);
}

/* -------------------------------------------------------------------------- */
/* Aggregation                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Sum balances that describe the same asset, preserving first-seen order.
 *
 * Amounts are aligned on their decimal scale and added with BigInt, so
 * `"0.1" + "0.2"` is exactly `"0.3"` and very large balances never lose
 * precision. The returned balances have trailing fraction zeros trimmed.
 */
export function sumAssetBalances(balances: readonly AssetBalance[]): AggregatedAssetBalance[] {
  const grouped = new Map<string, AggregatedAssetBalance>();

  for (const balance of balances) {
    const key = assetBalanceKey(balance);
    const parsed = parseDecimal(balance.balance);
    const existing = grouped.get(key);

    if (existing) {
      existing.balance = addDecimals(existing.balance, balance.balance);
      existing.sources += 1;
    } else {
      grouped.set(key, {
        ...balance,
        balance: formatDecimal(parsed.units, parsed.scale),
        sources: 1,
      });
    }
  }

  return [...grouped.values()];
}

/** Aggregate the balances of several wallet snapshots into one list. */
export function aggregateWalletBalances(
  snapshots: readonly WalletBalance[],
): AggregatedAssetBalance[] {
  return sumAssetBalances(snapshots.flatMap((snapshot) => snapshot.balances));
}

/** Group a wallet snapshot into native and issued balances with exact totals. */
export function summarizeWalletBalances(snapshot: WalletBalance): WalletBalanceSummary {
  const assets = sumAssetBalances(snapshot.balances);
  return {
    assets,
    native: assets.find(isNativeAssetBalance),
    issued: assets.filter((balance) => !isNativeAssetBalance(balance)),
    totalAssets: assets.length,
  };
}

/* -------------------------------------------------------------------------- */
/* Formatting                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Format an exact decimal-string amount for display.
 *
 * The value never passes through `Number`: grouping, padding and optional
 * rounding are all performed on the parsed decimal digits. Fraction digits
 * from the API are preserved unless `maxFractionDigits` is supplied.
 */
export function formatAssetAmount(amount: string, options: AssetAmountFormatOptions = {}): string {
  const parsed = parseDecimal(amount);
  const minDigits = options.minFractionDigits ?? 0;
  assertFractionDigits(minDigits, 'minFractionDigits');
  const maxDigits = options.maxFractionDigits ?? Math.max(parsed.scale, minDigits);
  assertFractionDigits(maxDigits, 'maxFractionDigits');
  if (minDigits > maxDigits) {
    throw new ValidationError(
      `Invalid fraction digits: minFractionDigits (${minDigits}) must not exceed maxFractionDigits (${maxDigits}).`,
      { code: 'INVALID_FRACTION_DIGITS' },
    );
  }

  const absolute = parsed.negative ? -parsed.units : parsed.units;
  let scaled = absolute;

  if (maxDigits < parsed.scale) {
    const divisor = 10n ** BigInt(parsed.scale - maxDigits);
    const quotient = scaled / divisor;
    const remainder = scaled % divisor;
    scaled = options.rounding === 'half-up' && remainder * 2n >= divisor ? quotient + 1n : quotient;
  } else if (maxDigits > parsed.scale) {
    scaled *= 10n ** BigInt(maxDigits - parsed.scale);
  }

  const digits = scaled.toString().padStart(maxDigits + 1, '0');
  const integer = maxDigits === 0 ? digits : digits.slice(0, digits.length - maxDigits);
  const fraction = maxDigits === 0 ? '' : digits.slice(digits.length - maxDigits);
  const groupedInteger =
    options.grouping === false ? integer : groupDigits(integer, options.thousandsSeparator ?? ',');
  const numeric =
    fraction === ''
      ? groupedInteger
      : `${groupedInteger}${options.decimalSeparator ?? '.'}${fraction}`;

  const symbol = options.symbol;
  const decorated =
    symbol === undefined || symbol === ''
      ? numeric
      : options.symbolPosition === 'prefix'
        ? `${symbol}${numeric}`
        : `${numeric} ${symbol}`;

  return `${parsed.negative ? '-' : ''}${decorated}`;
}

/* -------------------------------------------------------------------------- */
/* Conversion                                                                  */
/* -------------------------------------------------------------------------- */

/** Convert an asset balance's decimal amount to integer base units. */
export function assetBalanceToBaseUnits(
  balance: AssetBalance,
  decimals: number = STELLAR_DECIMALS,
): bigint {
  return toBaseUnits(balance.balance, decimals);
}

/** Build an asset balance from integer base units using exact conversion. */
export function assetBalanceFromBaseUnits(
  asset: string,
  baseUnits: string | bigint,
  issuer?: string | null,
  decimals: number = STELLAR_DECIMALS,
): AssetBalance {
  const balance = fromBaseUnits(baseUnits, decimals);
  return issuer === undefined || issuer === null || issuer === ''
    ? { asset, balance }
    : { asset, balance, issuer };
}

/**
 * Convert an exact decimal amount between asset precisions.
 *
 * Downscaling is only allowed when no information would be lost; otherwise a
 * `ValidationError` with code `PRECISION_LOSS` is thrown.
 */
export function convertAssetAmount(
  amount: string,
  fromDecimals: number,
  toDecimals: number,
): string {
  const units = toBaseUnits(amount, fromDecimals);

  if (toDecimals > fromDecimals) {
    return fromBaseUnits(units * 10n ** BigInt(toDecimals - fromDecimals), toDecimals);
  }

  const divisor = 10n ** BigInt(fromDecimals - toDecimals);
  if (units % divisor !== 0n) {
    throw new ValidationError(
      `Cannot convert "${amount}" from ${fromDecimals} to ${toDecimals} decimals without losing precision.`,
      { code: 'PRECISION_LOSS' },
    );
  }
  return fromBaseUnits(units / divisor, toDecimals);
}

/**
 * Formatting helpers for currency and Stellar assets.
 */

/** Options for {@link formatAmount}. */
export interface FormatAmountOptions {
  /** Maximum fractional digits (Stellar supports up to 7). Default 2. */
  maximumFractionDigits?: number;
  minimumFractionDigits?: number;
  locale?: string;
}

/**
 * Format a decimal amount (number or string) for display, grouping thousands.
 * Accepts strings to preserve precision from the API's `Decimal` fields.
 *
 * @example formatAmount('1234.5', { maximumFractionDigits: 2 }) // "1,234.50"
 */
export function formatAmount(amount: number | string, options: FormatAmountOptions = {}): string {
  const value = typeof amount === 'string' ? Number(amount) : amount;
  if (!Number.isFinite(value)) return String(amount);
  const {
    maximumFractionDigits = 2,
    minimumFractionDigits = Math.min(2, maximumFractionDigits),
    locale = 'en-US',
  } = options;
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits,
    maximumFractionDigits,
  }).format(value);
}

/**
 * Format an asset amount with its symbol, e.g. `formatAsset('150', 'USDC')`
 * → `"150.00 USDC"`.
 */
export function formatAsset(
  amount: number | string,
  asset: string,
  options?: FormatAmountOptions,
): string {
  return `${formatAmount(amount, options)} ${asset}`;
}

/**
 * Truncate a long identifier (Stellar address, transaction hash) for display,
 * keeping a prefix and suffix: `truncateMiddle('GABC...', 4, 4)` → `"GABC…WXYZ"`.
 */
export function truncateMiddle(value: string, prefix = 6, suffix = 4): string {
  if (value.length <= prefix + suffix + 1) return value;
  return `${value.slice(0, prefix)}…${value.slice(-suffix)}`;
}

/** Format a whole-number percentage from a 0..1 ratio: `0.75` → `"75%"`. */
export function formatPercent(ratio: number, fractionDigits = 0): string {
  return `${(ratio * 100).toFixed(fractionDigits)}%`;
}

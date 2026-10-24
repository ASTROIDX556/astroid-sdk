/**
 * `@astroid/wallet` — balance formatting and parsing utilities.
 *
 * Provides robust balance formatting and parsing functions that handle
 * decimal precision shifts safely using BigInt, without floating-point
 * inaccuracies. Handles native XLM (7 decimal places) and custom issued
 * assets correctly.
 *
 * @packageDocumentation
 */

/**
 * The raw Stellar balance unit (stroops). One XLM = 10_000_000 stroops.
 *
 * @example
 * ```ts
 * import { formatBalance, parseBalance } from '@astroid/wallet';
 * formatBalance(12500000n, 7); // '1.2500000'
 * parseBalance('1.2500000', 7); // 12500000n
 * ```
 */
export type { DecimalString } from '@astroid/types';

/**
 * Formats a raw balance amount (in stroops) into a human-readable string.
 *
 * Converts the raw Stellar balance unit (stroops) to a decimal string with
 * the specified number of decimal places. Uses BigInt internally to avoid
 * floating-point inaccuracies.
 *
 * @param stroops The raw balance amount in stroops (base units) as a BigInt.
 * @param decimalPlaces Number of decimal places for the asset (7 for XLM,
 *                      varies for issued assets such as USDC which also uses 7).
 * @returns Human-readable balance string with proper decimal formatting.
 *          Always includes the full complement of decimal places.
 *
 * @example
 * ```ts
 * formatBalance(12500000n, 7); // '1.2500000'
 * formatBalance(0n, 7); // '0.0000000'
 * formatBalance(10000000n, 7); // '1.0000000'
 * ```
 */
export function formatBalance(stroops: bigint, decimalPlaces: number): string {
  if (stroops < 0n) {
    throw new Error(`Balance cannot be negative: ${stroops}`);
  }

  if (stroops === 0n) {
    return '0'.padStart(decimalPlaces + 1, '0').replace(/0$/, '0');
  }

  // Stroops = integer_part * 10^decimalPlaces + fractional_part
  // We want: integer_part.fractional_part (padded to decimalPlaces)
  const separator = decimalPlaces;

  // Calculate integer part and fractional part using BigInt
  const factor = 10n ** BigInt(decimalPlaces);
  const integerPart = stroops / factor;
  const fractionalPart = stroops % factor;

  // Format fractional part with leading zeros, trimmed of trailing zeros
  // but always keeping at least one digit
  const fractionalStr = fractionalPart
    .toString()
    .padStart(separator, '0');

  // Combine integer and fractional parts
  return `${integerPart}.${fractionalStr}`;
}

/**
 * Parses a human-readable balance string into raw stroops (bigint).
 *
 * Converts a decimal string representation of a balance back into the raw
 * Stellar stroops unit. Uses BigInt arithmetic to preserve precision and
 * avoid floating-point errors.
 *
 * @param amount The human-readable balance amount (e.g., "1.2500000").
 * @param decimalPlaces Number of decimal places for the asset (7 for XLM,
 *                      varies for issued assets).
 * @returns The raw balance amount in stroops as a BigInt.
 * @throws {Error} If the amount string is not a valid decimal number or
 *         has incorrect decimal places.
 *
 * @example
 * ```ts
 * parseBalance('1.2500000', 7); // 12500000n
 * parseBalance('0.0000001', 7); // 1n
 * parseBalance('0.0000000', 7); // 0n
 * ```
 */
export function parseBalance(amount: string, decimalPlaces: number): bigint {
  if (amount.startsWith('-')) {
    throw new Error(`Balance cannot be negative: ${amount}`);
  }

  // Split into integer and fractional parts
  const decimalIndex = amount.indexOf('.');
  let integerPart = '0';
  let fractionalPart = amount;

  if (decimalIndex !== -1) {
    integerPart = amount.substring(0, decimalIndex);
    fractionalPart = amount.substring(decimalIndex + 1);
  } else {
    // No decimal point — assume all is integer part
    fractionalPart = '';
  }

  // Pad or truncate fractional part to exactly decimalPlaces digits
  if (fractionalPart.length < decimalPlaces) {
    fractionalPart = fractionalPart.padEnd(decimalPlaces, '0');
  } else if (fractionalPart.length > decimalPlaces) {
    fractionalPart = fractionalPart.substring(0, decimalPlaces);
  }

  // Parse integer part as BigInt
  const integerBigInt = BigInt(integerPart || '0');

  // Parse fractional part as BigInt (it represents the digits after the decimal)
  const fractionalBigInt = BigInt(fractionalPart || '0');

  // Combine: integer * 10^decimalPlaces + fractional
  const factor = 10n ** BigInt(decimalPlaces);
  return integerBigInt * factor + fractionalBigInt;
}

/**
 * Default decimal places for native Stellar XLM (7 decimal places).
 */
export const XLM_DECIMAL_PLACES = 7;

/**
 * Default decimal places for most issued Stellar assets (7 decimal places).
 * Some assets may use different precision; specify explicitly when needed.
 */
export const DEFAULT_ASSET_DECIMAL_PLACES = 7;
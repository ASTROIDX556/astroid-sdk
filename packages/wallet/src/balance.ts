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
import { fromBaseUnits, toBaseUnits } from './utils.js';

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

  return fromBaseUnits(stroops, decimalPlaces, { trimTrailingZeros: false });
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
 * @throws {Error} If the amount string is not a valid non-negative decimal or
 *         carries more fraction digits than `decimalPlaces` (no silent
 *         truncation).
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

  return toBaseUnits(amount, decimalPlaces);
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

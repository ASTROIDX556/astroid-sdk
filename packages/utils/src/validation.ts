/**
 * Lightweight, dependency-free validation helpers. These give friendly,
 * client-side guardrails; the backend remains the source of truth.
 */

import { isStellarAddress, isValidAssetCode } from './asset.js';

/** Whether a value is a non-empty, non-whitespace string. */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** Basic RFC-5322-lite email check. */
export function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/** Whether a value is a positive, finite amount (number or numeric string). */
export function isPositiveAmount(value: number | string): boolean {
  const n = typeof value === 'string' ? Number(value) : value;
  return Number.isFinite(n) && n > 0;
}

/** Whether a string is a UUID (any version). */
export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export { isStellarAddress, isValidAssetCode };

/** A single validation problem. */
export interface ValidationIssue {
  field: string;
  message: string;
}

/**
 * Validate a transfer-like input client-side. Returns the list of issues (empty
 * when valid) so callers can fail fast before a round-trip.
 */
export function validateTransfer(input: {
  recipientAddress?: string;
  asset?: string;
  amount?: number | string;
}): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!input.recipientAddress || !isStellarAddress(input.recipientAddress)) {
    issues.push({ field: 'recipientAddress', message: 'Must be a valid Stellar address.' });
  }
  if (!input.asset || !isValidAssetCode(input.asset)) {
    issues.push({ field: 'asset', message: 'Must be a valid asset code (1–12 alphanumerics).' });
  }
  if (input.amount === undefined || !isPositiveAmount(input.amount)) {
    issues.push({ field: 'amount', message: 'Must be a positive amount.' });
  }
  return issues;
}

/** Assert that a required value is present, throwing a `TypeError` if not. */
export function assertDefined<T>(value: T | null | undefined, name: string): T {
  if (value === null || value === undefined) {
    throw new TypeError(`Expected "${name}" to be defined.`);
  }
  return value;
}

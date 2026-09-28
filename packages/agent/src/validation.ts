import type { CreateAgentParams } from '@astroid/types';
import { AstroidValidationError } from './errors.js';

/**
 * Stellar public key format: `G` followed by 55 base-32 characters.
 *
 * This is a syntax check (prefix, length and alphabet); the CRC16 checksum is
 * verified server-side. It matches the check used by `@astroid/policy`'s
 * policy builder so client-side validation is consistent across packages.
 */
const STELLAR_PUBLIC_KEY_PATTERN = /^G[A-Z2-7]{55}$/;

/**
 * Whether `value` is a syntactically valid Stellar public key (`G…`).
 *
 * @param value The value to check.
 * @returns     `true` when `value` is a format-valid Stellar account address.
 *
 * @example
 * ```ts
 * isValidStellarPublicKey('GABCD…'); // true
 * isValidStellarPublicKey('0x1234');  // false
 * ```
 */
export function isValidStellarPublicKey(value: unknown): value is string {
  return typeof value === 'string' && STELLAR_PUBLIC_KEY_PATTERN.test(value.trim());
}

/** Throw a descriptive {@link AstroidValidationError} for an invalid address. */
function assertStellarPublicKey(value: unknown, field: string): void {
  if (!isValidStellarPublicKey(value)) {
    throw new AstroidValidationError(
      `Agent validation failed: "${field}" must be a valid Stellar public key (G…, 56 characters).`,
      { field, received: value },
    );
  }
}

/**
 * Validates a CreateAgentParams payload.
 * Ensures required fields (name, capabilities, initialBudget) are present and correctly typed.
 * Throws {@link AstroidValidationError} when invalid.
 *
 * @param params The agent creation parameters to validate.
 * @throws {AstroidValidationError} If any required field is missing or invalid.
 *
 * @example
 * ```ts
 * validateCreateAgentParams({
 *   name: 'MyAgent',
 *   capabilities: ['trade'],
 *   initialBudget: { currency: 'USDC', amount: '100' }
 * });
 * ```
 */
export function validateCreateAgentParams(params: unknown): asserts params is CreateAgentParams {
  if (!params || typeof params !== 'object') {
    throw new AstroidValidationError('Agent creation parameters must be a non-null object.', {
      received: typeof params,
    });
  }

  const p = params as Record<string, unknown>;

  // Validate name
  if (typeof p['name'] !== 'string' || p['name'].trim() === '') {
    throw new AstroidValidationError(
      'Agent validation failed: "name" is required and must be a non-empty string.',
      {
        field: 'name',
        received: p['name'],
      },
    );
  }

  // Validate capabilities
  if (!Array.isArray(p['capabilities']) || p['capabilities'].length === 0) {
    throw new AstroidValidationError(
      'Agent validation failed: "capabilities" is required and must be a non-empty array of strings.',
      {
        field: 'capabilities',
        received: p['capabilities'],
      },
    );
  }

  for (const cap of p['capabilities']) {
    if (typeof cap !== 'string' || cap.trim() === '') {
      throw new AstroidValidationError(
        'Agent validation failed: every capability must be a non-empty string.',
        {
          field: 'capabilities',
          received: cap,
        },
      );
    }
  }

  // Validate initialBudget
  const budget = p['initialBudget'];
  if (!budget || typeof budget !== 'object') {
    throw new AstroidValidationError(
      'Agent validation failed: "initialBudget" is required and must be an object.',
      {
        field: 'initialBudget',
        received: budget,
      },
    );
  }

  const b = budget as Record<string, unknown>;

  if (typeof b['currency'] !== 'string' || b['currency'].trim() === '') {
    throw new AstroidValidationError(
      'Agent validation failed: "initialBudget.currency" is required and must be a non-empty string.',
      {
        field: 'initialBudget.currency',
        received: b['currency'],
      },
    );
  }

  if (typeof b['amount'] !== 'string' || b['amount'].trim() === '') {
    throw new AstroidValidationError(
      'Agent validation failed: "initialBudget.amount" is required and must be a non-empty string.',
      {
        field: 'initialBudget.amount',
        received: b['amount'],
      },
    );
  }

  // Validate amount format / bounds (must be a valid positive numeric string)
  const numAmount = Number(b['amount']);
  if (isNaN(numAmount) || numAmount < 0) {
    throw new AstroidValidationError(
      'Agent validation failed: "initialBudget.amount" must be a valid non-negative number string.',
      {
        field: 'initialBudget.amount',
        received: b['amount'],
      },
    );
  }

  // Validate optional metadata shape (must be a plain object when present).
  if (p['metadata'] !== undefined) {
    if (
      p['metadata'] === null ||
      typeof p['metadata'] !== 'object' ||
      Array.isArray(p['metadata'])
    ) {
      throw new AstroidValidationError(
        'Agent validation failed: "metadata" must be an object when provided.',
        { field: 'metadata', received: p['metadata'] },
      );
    }
  }

  // Validate optional Stellar public keys wherever the payload carries one —
  // either at the top level or under the conventional `metadata.stellarAddress`
  // key. Only validate when present: the fields are optional, but a malformed
  // address must never reach the API.
  if (p['stellarAddress'] !== undefined) {
    assertStellarPublicKey(p['stellarAddress'], 'stellarAddress');
  }

  const metadata = p['metadata'] as Record<string, unknown> | undefined;
  if (metadata && metadata['stellarAddress'] !== undefined) {
    assertStellarPublicKey(metadata['stellarAddress'], 'metadata.stellarAddress');
  }

  // Validate optional primaryWalletId (an opaque id, not an address).
  if (p['primaryWalletId'] !== undefined) {
    if (typeof p['primaryWalletId'] !== 'string' || p['primaryWalletId'].trim() === '') {
      throw new AstroidValidationError(
        'Agent validation failed: "primaryWalletId" must be a non-empty string when provided.',
        { field: 'primaryWalletId', received: p['primaryWalletId'] },
      );
    }
  }
}

/**
 * Type guard to check if a payload satisfies CreateAgentParams without throwing.
 *
 * @param params The payload to check.
 * @returns True if valid CreateAgentParams, false otherwise.
 */
export function isValidCreateAgentParams(params: unknown): params is CreateAgentParams {
  try {
    validateCreateAgentParams(params);
    return true;
  } catch {
    return false;
  }
}

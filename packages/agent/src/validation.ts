/**
 * Runtime validation for the agent resource DTOs.
 *
 * `@astroid/agent` issues `POST /agents` and `PATCH /agents/:id` with developer
 * supplied payloads. TypeScript erases at compile time, so anything crossing the
 * network boundary from untyped input (a JSON body, a form, `localStorage`, a
 * query string) can still be malformed by the time it reaches the resource
 * method. These guards run **before** the HTTP request is dispatched, so a
 * broken payload costs a local exception instead of a round trip and a 422.
 *
 * The module provides, for every DTO:
 *
 * - `validateX` — an assertion function that throws a descriptive
 *   {@link AstroidValidationError} (field, expectation and received value in
 *   `details`) on the first problem it finds.
 * - `isValidX` — the matching non-throwing type guard for consumers that want to
 *   branch on validity (form validation, feature flags, test fixtures).
 *
 * All exported helpers are pure and dependency-free, so they work identically in
 * Node and browser runtimes and can be reused by consumer applications before
 * they hand a payload to the SDK.
 *
 * @module
 */

import {
  isAgentRole,
  isAgentStatus,
  type AgentMetadata,
  type CreateAgentParams,
  type UpdateAgentParams,
} from '@astroid/types';

import { AstroidValidationError } from './errors.js';

/* -------------------------------------------------------------------------- */
/* Patterns                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Agent payload Stellar address format: `G` followed by 51 base-32 characters
 * (52 characters total), as required by the agent API contract.
 *
 * This is a syntax check (prefix, length and alphabet); the CRC16 checksum is
 * verified server-side. It matches the check used by `@astroid/policy`'s
 * policy builder so client-side validation is consistent across packages.
 */
const STELLAR_PUBLIC_KEY_PATTERN = /^G[A-Z2-7]{51}$/;

/**
 * Non-negative decimal amount, e.g. `"0"`, `"500"` or `"1000.00"`.
 *
 * Deliberately stricter than `Number(value)`, which happily accepts `"Infinity"`,
 * `"0x10"`, `"1e3"` and `""` — all of which the Astroid API rejects. Amounts are
 * decimal strings over the wire (to preserve precision), so only plain decimal
 * notation is accepted here.
 */
const DECIMAL_AMOUNT_PATTERN = /^\d+(?:\.\d+)?$/;

/* -------------------------------------------------------------------------- */
/* Primitive guards                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Whether `value` is a syntactically valid Stellar public key (`G…`).
 *
 * Surrounding whitespace is tolerated; the checksum is verified server-side.
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

/**
 * Assert that `value` is a format-valid Stellar public key (`G…`).
 *
 * The public companion of {@link isValidStellarPublicKey}, for callers that
 * prefer a thrown, field-addressed error over a boolean branch. Mirrors
 * `assertValidStellarPublicKey` in `@astroid/transaction` so both packages
 * report the same failure shape.
 *
 * @param value The value to validate.
 * @param field The field name reported in the error details (default `stellarAddress`).
 * @throws {AstroidValidationError} When `value` is not a Stellar public key.
 *
 * @example
 * ```ts
 * assertValidStellarPublicKey(wallet.stellarAddress, 'wallet.stellarAddress');
 * ```
 */
export function assertValidStellarPublicKey(value: unknown, field = 'stellarAddress'): void {
  if (!isValidStellarPublicKey(value)) {
    fail(
      `Agent validation failed: "${field}" must be a valid Stellar public key starting with "G" and 52 characters long.`,
      { field, received: value, expected: 'Stellar public key (G…)' },
    );
  }
}

/**
 * Whether `value` is a syntactically valid, non-negative decimal amount string.
 *
 * @param value The value to check.
 *
 * @example
 * ```ts
 * isValidAmountString('1000.00'); // true
 * isValidAmountString('-1');       // false
 * isValidAmountString('1e3');      // false
 * ```
 */
export function isValidAmountString(value: unknown): value is string {
  return typeof value === 'string' && DECIMAL_AMOUNT_PATTERN.test(value.trim());
}

/**
 * Assert that `value` is a non-negative decimal amount string.
 *
 * Guards the classic misconfiguration the issue calls out — a negative initial
 * budget cap — plus the values `Number()` silently accepts (`"1e3"`, `"0x10"`,
 * `""`) that the Astroid API rejects.
 *
 * @param value The value to validate.
 * @param field The field name reported in the error details (default `amount`).
 * @throws {AstroidValidationError} When `value` is not a non-negative decimal string.
 */
export function assertValidAmountString(value: unknown, field = 'amount'): void {
  if (!isValidAmountString(value)) {
    fail(`Agent validation failed: "${field}" must be a non-negative decimal amount string.`, {
      field,
      received: value,
      expected: 'decimal string',
    });
  }
}

/**
 * Whether `value` can address an agent, i.e. a non-blank string.
 *
 * Ids are opaque (`agt_…`) and are percent-encoded before hitting the URL, so
 * this deliberately checks presence only — never the shape.
 */
export function isValidAgentId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

/** Whether `value` is a non-null, non-array object. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A short, log-friendly description of a value's type. */
function describeType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/** Throw the canonical {@link AstroidValidationError} for a field-level issue. */
function fail(message: string, details: Record<string, unknown>): never {
  throw new AstroidValidationError(message, details);
}

/**
 * Require the payload root itself to be a plain object.
 *
 * @param params The value handed to the resource method.
 * @param label   Human-readable name of the payload, used in the message.
 */
function requireObjectRoot(params: unknown, label: 'creation' | 'update'): Record<string, unknown> {
  if (!isPlainObject(params)) {
    fail(`Agent ${label} parameters must be a non-null object.`, {
      received: describeType(params),
      expected: 'object',
    });
  }
  return params;
}

/** Require a present, non-blank string. */
function requireNonEmptyString(value: unknown, field: string): void {
  if (typeof value !== 'string' || value.trim() === '') {
    fail(`Agent validation failed: "${field}" is required and must be a non-empty string.`, {
      field,
      received: value,
      expected: 'string',
    });
  }
}

/** Require a present string when the field is supplied (empty text allowed). */
function assertOptionalString(value: unknown, field: string): void {
  if (typeof value !== 'string') {
    fail(`Agent validation failed: "${field}" must be a string when provided.`, {
      field,
      received: value,
      expected: 'string',
    });
  }
}

/** Require a non-blank string when the field is supplied. */
function assertOptionalNonEmptyString(value: unknown, field: string): void {
  if (typeof value !== 'string' || value.trim() === '') {
    fail(`Agent validation failed: "${field}" must be a non-empty string when provided.`, {
      field,
      received: value,
      expected: 'string',
    });
  }
}

/** Require a present, non-empty array of non-blank strings. */
function assertCapabilities(value: unknown, field = 'capabilities'): void {
  if (!Array.isArray(value) || value.length === 0) {
    fail(
      `Agent validation failed: "${field}" is required and must be a non-empty array of strings.`,
      { field, received: value, expected: 'string[]' },
    );
  }

  value.forEach((capability, index) => {
    if (typeof capability !== 'string' || capability.trim() === '') {
      fail(`Agent validation failed: "${field}[${index}]" must be a non-empty string.`, {
        field: `${field}[${index}]`,
        received: capability,
        expected: 'string',
      });
    }
  });
}

/** Require a `value` to be one of the {@link AgentStatus} enum members. */
function assertAgentStatus(value: unknown, field: string): void {
  if (!isAgentStatus(value)) {
    fail(
      `Agent validation failed: "${field}" must be a valid agent status ` +
        `(ACTIVE, PAUSED, SUSPENDED or ARCHIVED).`,
      { field, received: value, expected: 'AgentStatus' },
    );
  }
}

/** Require a `value` to be one of the {@link AgentRole} enum members. */
function assertAgentRole(value: unknown, field: string): void {
  if (!isAgentRole(value)) {
    fail(
      `Agent validation failed: "${field}" must be a valid agent role ` +
        `(FINANCE, RESEARCH, OPERATIONS, PROCUREMENT or CUSTOM).`,
      { field, received: value, expected: 'AgentRole' },
    );
  }
}

/**
 * Validate the free-form `metadata` bag of an agent payload.
 *
 * `metadata` is stored as JSONB, so unknown keys pass through untouched; the
 * keys the SDK types are checked when present — `team` and `externalId` must be
 * non-blank strings, `tags` an array of non-blank strings, and
 * `stellarAddress` a format-valid Stellar public key.
 *
 * Exported so consumers can validate their own metadata objects before handing
 * them to a resource method (or writing them into a query cache).
 *
 * @param value The metadata value to validate.
 * @param field The field name reported in the error details (default `metadata`).
 * @throws {AstroidValidationError} When the metadata is malformed.
 */
export function validateAgentMetadata(
  value: unknown,
  field = 'metadata',
): asserts value is AgentMetadata {
  if (!isPlainObject(value)) {
    fail(`Agent validation failed: "${field}" must be an object when provided.`, {
      field,
      received: value,
      expected: 'object',
    });
  }

  for (const key of ['team', 'externalId'] as const) {
    if (value[key] !== undefined) {
      assertOptionalNonEmptyString(value[key], `${field}.${key}`);
    }
  }

  if (value['tags'] !== undefined) {
    const tags = value['tags'];
    if (!Array.isArray(tags) || tags.some((tag) => typeof tag !== 'string' || tag.trim() === '')) {
      fail(`Agent validation failed: "${field}.tags" must be an array of non-empty strings.`, {
        field: `${field}.tags`,
        received: tags,
        expected: 'string[]',
      });
    }
  }

  if (value['stellarAddress'] !== undefined) {
    assertValidStellarPublicKey(value['stellarAddress'], `${field}.stellarAddress`);
  }
}

/**
 * Non-throwing type guard for agent metadata — the boolean companion of
 * {@link validateAgentMetadata}.
 *
 * @param value The value to check.
 * @returns     `true` when `value` is a valid agent metadata object.
 */
export function isValidAgentMetadata(value: unknown): value is AgentMetadata {
  try {
    validateAgentMetadata(value);
    return true;
  } catch {
    return false;
  }
}

/* -------------------------------------------------------------------------- */
/* CreateAgentDto                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Validates a {@link CreateAgentDto} / `CreateAgentParams` payload.
 *
 * Ensures the required fields (`name`, `capabilities`, `initialBudget`) are
 * present and correctly typed, that the initial budget is a well-formed
 * non-negative decimal amount, and that the optional enum/string fields hold
 * values the API understands. Throws {@link AstroidValidationError} on the first
 * problem found.
 *
 * @param params The agent creation parameters to validate.
 * @throws {AstroidValidationError} If the payload or any of its fields is invalid.
 *
 * @example
 * ```ts
 * validateCreateAgentParams({
 *   name: 'MyAgent',
 *   capabilities: ['trade'],
 *   initialBudget: { currency: 'USDC', amount: '100' },
 * });
 * ```
 */
export function validateCreateAgentParams(params: unknown): asserts params is CreateAgentParams {
  const p = requireObjectRoot(params, 'creation');

  // Validate name
  requireNonEmptyString(p['name'], 'name');

  // Validate capabilities
  assertCapabilities(p['capabilities']);

  // Validate initialBudget
  const budget = p['initialBudget'];
  if (!isPlainObject(budget)) {
    fail('Agent validation failed: "initialBudget" is required and must be an object.', {
      field: 'initialBudget',
      received: budget,
      expected: 'object',
    });
  }

  requireNonEmptyString(budget['currency'], 'initialBudget.currency');
  // Amounts are decimal strings over the wire: a blank, negative, exponential
  // or non-numeric cap is rejected here rather than by the API's 422.
  assertValidAmountString(budget['amount'], 'initialBudget.amount');

  // Validate optional metadata shape (must be a plain object when present).
  if (p['metadata'] !== undefined) {
    validateAgentMetadata(p['metadata']);
  }

  // Validate optional Stellar public keys wherever the payload carries one —
  // either at the top level or under the conventional `metadata.stellarAddress`
  // key. Only validate when present: the fields are optional, but a malformed
  // address must never reach the API.
  if (p['stellarAddress'] !== undefined) {
    assertValidStellarPublicKey(p['stellarAddress'], 'stellarAddress');
  }

  // Validate optional free-form fields.
  if (p['description'] !== undefined) {
    assertOptionalString(p['description'], 'description');
  }
  if (p['role'] !== undefined) {
    assertAgentRole(p['role'], 'role');
  }
  if (p['provider'] !== undefined) {
    assertOptionalNonEmptyString(p['provider'], 'provider');
  }
  if (p['model'] !== undefined) {
    assertOptionalNonEmptyString(p['model'], 'model');
  }

  // Validate optional primaryWalletId (an opaque id, not an address).
  if (p['primaryWalletId'] !== undefined) {
    assertOptionalNonEmptyString(p['primaryWalletId'], 'primaryWalletId');
  }
}

/**
 * Type guard to check if a payload satisfies {@link CreateAgentDto} without throwing.
 *
 * @param params The payload to check.
 * @returns True if valid `CreateAgentParams`, false otherwise.
 */
export function isValidCreateAgentParams(params: unknown): params is CreateAgentParams {
  try {
    validateCreateAgentParams(params);
    return true;
  } catch {
    return false;
  }
}

/* -------------------------------------------------------------------------- */
/* UpdateAgentDto                                                              */
/* -------------------------------------------------------------------------- */

/** Every field an {@link UpdateAgentDto} may carry. */
const UPDATE_FIELDS = [
  'name',
  'description',
  'role',
  'provider',
  'model',
  'capabilities',
  'status',
  'primaryWalletId',
  'metadata',
] as const;

/**
 * Validates an {@link UpdateAgentDto} / `UpdateAgentParams` payload.
 *
 * Every field is optional, but a payload must carry at least one of them —
 * an empty `PATCH` is a guaranteed no-op — and each supplied field must hold a
 * value the API understands. `null` is accepted for `primaryWalletId` (it
 * detaches the wallet); every other field rejects `null` and empty values so a
 * typo cannot silently blank out an agent.
 *
 * @param params The agent update parameters to validate.
 * @throws {AstroidValidationError} If the payload or any of its fields is invalid.
 *
 * @example
 * ```ts
 * validateUpdateAgentParams({ status: AgentStatus.PAUSED });
 * validateUpdateAgentParams({ capabilities: ['trade', 'transfer'] });
 * ```
 */
export function validateUpdateAgentParams(params: unknown): asserts params is UpdateAgentParams {
  const p = requireObjectRoot(params, 'update');

  // A PATCH with no updatable field changes nothing — reject it locally rather
  // than spend a round trip on a guaranteed no-op.
  const hasField = UPDATE_FIELDS.some((field) => p[field] !== undefined);
  if (!hasField) {
    fail(
      'Agent validation failed: at least one of ' + `${UPDATE_FIELDS.join(', ')} must be provided.`,
      { field: '(root)', received: params, expected: `one of: ${UPDATE_FIELDS.join(', ')}` },
    );
  }

  if (p['name'] !== undefined) {
    assertOptionalNonEmptyString(p['name'], 'name');
  }
  if (p['description'] !== undefined) {
    assertOptionalString(p['description'], 'description');
  }
  if (p['role'] !== undefined) {
    assertAgentRole(p['role'], 'role');
  }
  if (p['provider'] !== undefined) {
    assertOptionalNonEmptyString(p['provider'], 'provider');
  }
  if (p['model'] !== undefined) {
    assertOptionalNonEmptyString(p['model'], 'model');
  }
  if (p['capabilities'] !== undefined) {
    assertCapabilities(p['capabilities']);
  }
  if (p['status'] !== undefined) {
    assertAgentStatus(p['status'], 'status');
  }
  if (p['primaryWalletId'] !== undefined) {
    // `null` explicitly detaches the agent's wallet; anything else must be an id.
    if (p['primaryWalletId'] !== null) {
      assertOptionalNonEmptyString(p['primaryWalletId'], 'primaryWalletId');
    }
  }
  if (p['metadata'] !== undefined) {
    validateAgentMetadata(p['metadata']);
  }
}

/**
 * Type guard to check if a payload satisfies {@link UpdateAgentDto} without throwing.
 *
 * @param params The payload to check.
 * @returns True if valid `UpdateAgentParams`, false otherwise.
 */
export function isValidUpdateAgentParams(params: unknown): params is UpdateAgentParams {
  try {
    validateUpdateAgentParams(params);
    return true;
  } catch {
    return false;
  }
}

/* -------------------------------------------------------------------------- */
/* Path parameter                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Assert that `agentId` can address an agent.
 *
 * @throws {AstroidValidationError} When the id is missing, blank or not a string.
 */
export function assertValidAgentId(agentId: unknown): asserts agentId is string {
  if (!isValidAgentId(agentId)) {
    fail('Agent validation failed: "agentId" is required and must be a non-empty string.', {
      field: 'agentId',
      received: agentId,
      expected: 'string',
    });
  }
}

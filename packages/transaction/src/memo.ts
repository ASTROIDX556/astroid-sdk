/**
 * Pre-flight validation of Stellar memo parameters.
 *
 * The Stellar network caps text memos at 28 bytes and requires hash/return
 * memos to be exactly 32 bytes. A violation otherwise only surfaces as an
 * opaque RPC rejection after the transaction has been built and submitted.
 * {@link validateMemo} checks those protocol rules at the SDK boundary and
 * throws a {@link MemoValidationError} that names the offending memo type,
 * the limit, and the actual size.
 *
 * @module
 */

import { ValidationError } from '@astroid/errors';
import { MAX_MEMO_TEXT_BYTES, MEMO_HASH_BYTES } from './validator.js';

/** Machine-readable reason a memo was rejected. */
export type MemoValidationCode =
  | 'MEMO_TYPE_INVALID'
  | 'MEMO_TEXT_INVALID'
  | 'MEMO_TEXT_TOO_LONG'
  | 'MEMO_ID_INVALID'
  | 'MEMO_HASH_INVALID_FORMAT'
  | 'MEMO_HASH_INVALID_LENGTH';

/** Memo types accepted by {@link validateMemo}. */
export type MemoKind = 'none' | 'text' | 'id' | 'hash' | 'return';

/** A memo to validate, discriminated by `type`. */
export type MemoInput =
  | { type: 'none' }
  | { type: 'text'; value: string | Uint8Array }
  | { type: 'id'; value: string | bigint | number }
  | { type: 'hash' | 'return'; value: string | Uint8Array };

/** Additional context attached to a {@link MemoValidationError}. */
export interface MemoValidationErrorOptions {
  /** The memo type that failed validation. */
  memoType: string;
  /** The protocol limit that was violated, in bytes, when one applies. */
  limit?: number;
  /** The size of the rejected value, in bytes, when it could be measured. */
  actual?: number;
}

/**
 * Thrown when a memo violates a Stellar protocol rule.
 *
 * Extends {@link ValidationError}, so existing `catch` blocks that handle
 * validation failures keep working. `code` holds the {@link MemoValidationCode}.
 */
export class MemoValidationError extends ValidationError {
  /** The memo type that failed validation. */
  readonly memoType: string;
  /** The protocol limit that was violated, in bytes, when one applies. */
  readonly limit?: number;
  /** The size of the rejected value, in bytes, when it could be measured. */
  readonly actual?: number;

  constructor(message: string, code: MemoValidationCode, options: MemoValidationErrorOptions) {
    super(message, {
      code,
      details: {
        field: 'memo',
        memoType: options.memoType,
        limit: options.limit,
        actual: options.actual,
      },
    });
    this.memoType = options.memoType;
    this.limit = options.limit;
    this.actual = options.actual;
  }
}

const HEX_CHARS_PATTERN = /^[0-9a-fA-F]*$/;
const UINT64_PATTERN = /^\d{1,20}$/;
const UINT64_MAX = 18_446_744_073_709_551_615n;
const MEMO_KINDS: readonly string[] = ['none', 'text', 'id', 'hash', 'return'];

function validateText(value: unknown): void {
  const bytes =
    typeof value === 'string'
      ? new TextEncoder().encode(value).byteLength
      : value instanceof Uint8Array
        ? value.byteLength
        : undefined;
  if (bytes === undefined) {
    throw new MemoValidationError(
      'A text memo requires a string or Uint8Array value.',
      'MEMO_TEXT_INVALID',
      { memoType: 'text' },
    );
  }
  if (bytes > MAX_MEMO_TEXT_BYTES) {
    throw new MemoValidationError(
      `Text memo is ${bytes} bytes; the Stellar maximum is ${MAX_MEMO_TEXT_BYTES}.`,
      'MEMO_TEXT_TOO_LONG',
      { memoType: 'text', limit: MAX_MEMO_TEXT_BYTES, actual: bytes },
    );
  }
}

function validateId(value: unknown): void {
  let id: bigint | undefined;
  if (typeof value === 'bigint') {
    id = value;
  } else if (typeof value === 'number' && Number.isSafeInteger(value)) {
    id = BigInt(value);
  } else if (typeof value === 'string' && UINT64_PATTERN.test(value.trim())) {
    id = BigInt(value.trim());
  }
  if (id === undefined || id < 0n || id > UINT64_MAX) {
    throw new MemoValidationError(
      'An id memo must be an unsigned 64-bit integer (0 to 18446744073709551615).',
      'MEMO_ID_INVALID',
      { memoType: 'id' },
    );
  }
}

function validateHash(type: 'hash' | 'return', value: unknown): void {
  const expectedHexChars = MEMO_HASH_BYTES * 2;

  if (value instanceof Uint8Array) {
    if (value.byteLength !== MEMO_HASH_BYTES) {
      throw new MemoValidationError(
        `A ${type} memo must be exactly ${MEMO_HASH_BYTES} bytes; received ${value.byteLength}.`,
        'MEMO_HASH_INVALID_LENGTH',
        { memoType: type, limit: MEMO_HASH_BYTES, actual: value.byteLength },
      );
    }
    return;
  }

  const hex = typeof value === 'string' ? value.trim() : undefined;
  if (hex === undefined || !HEX_CHARS_PATTERN.test(hex)) {
    throw new MemoValidationError(
      `A ${type} memo must be a hexadecimal string or a ${MEMO_HASH_BYTES}-byte Uint8Array.`,
      'MEMO_HASH_INVALID_FORMAT',
      { memoType: type },
    );
  }
  if (hex.length !== expectedHexChars) {
    throw new MemoValidationError(
      `A ${type} memo must be ${MEMO_HASH_BYTES} bytes (${expectedHexChars} hex characters); received ${hex.length} characters.`,
      'MEMO_HASH_INVALID_LENGTH',
      { memoType: type, limit: MEMO_HASH_BYTES, actual: Math.floor(hex.length / 2) },
    );
  }
}

/**
 * Validate a memo against Stellar protocol limits before building a transaction.
 *
 * - `text`: at most {@link MAX_MEMO_TEXT_BYTES} (28) bytes, measured in UTF-8.
 * - `id`: an unsigned 64-bit integer.
 * - `hash` / `return`: exactly {@link MEMO_HASH_BYTES} (32) bytes, supplied as a
 *   64-character hex string or a 32-byte `Uint8Array`.
 * - `none`: always valid.
 *
 * @param memo The memo to validate.
 * @throws {MemoValidationError} When the memo violates a protocol limit. Its
 *   `code` is a {@link MemoValidationCode}; `memoType`, `limit` and `actual`
 *   describe the failure.
 *
 * @example
 * ```ts
 * validateMemo({ type: 'text', value: 'invoice-1042' });
 *
 * try {
 *   validateMemo({ type: 'text', value: 'x'.repeat(29) });
 * } catch (err) {
 *   if (err instanceof MemoValidationError) console.log(err.code); // MEMO_TEXT_TOO_LONG
 * }
 * ```
 */
export function validateMemo(memo: MemoInput): void {
  const type: unknown = (memo as { type?: unknown } | null | undefined)?.type;
  if (typeof type !== 'string' || !MEMO_KINDS.includes(type)) {
    throw new MemoValidationError(
      `Unknown memo type "${String(type)}"; expected one of ${MEMO_KINDS.join(', ')}.`,
      'MEMO_TYPE_INVALID',
      { memoType: String(type) },
    );
  }

  switch (memo.type) {
    case 'none':
      return;
    case 'text':
      validateText(memo.value);
      return;
    case 'id':
      validateId(memo.value);
      return;
    case 'hash':
    case 'return':
      validateHash(memo.type, memo.value);
      return;
  }
}

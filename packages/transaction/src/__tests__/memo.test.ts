import { describe, expect, it } from 'vitest';
import { ValidationError } from '@astroid/errors';

import { MemoValidationError, validateMemo, type MemoInput } from '../memo.js';

function catchMemoError(memo: MemoInput): MemoValidationError {
  try {
    validateMemo(memo);
  } catch (err) {
    expect(err).toBeInstanceOf(MemoValidationError);
    return err as MemoValidationError;
  }
  throw new Error('expected validateMemo to throw');
}

const HASH_HEX = 'ab'.repeat(32);

describe('validateMemo', () => {
  describe('none', () => {
    it('accepts an empty memo', () => {
      expect(() => validateMemo({ type: 'none' })).not.toThrow();
    });
  });

  describe('text', () => {
    it('accepts an empty string', () => {
      expect(() => validateMemo({ type: 'text', value: '' })).not.toThrow();
    });

    it('accepts exactly 28 bytes', () => {
      expect(() => validateMemo({ type: 'text', value: 'a'.repeat(28) })).not.toThrow();
    });

    it('rejects 29 bytes with the limit and actual size', () => {
      const err = catchMemoError({ type: 'text', value: 'a'.repeat(29) });
      expect(err.code).toBe('MEMO_TEXT_TOO_LONG');
      expect(err.memoType).toBe('text');
      expect(err.limit).toBe(28);
      expect(err.actual).toBe(29);
      expect(err.message).toContain('29 bytes');
    });

    it('measures UTF-8 bytes, not characters', () => {
      // 14 two-byte characters = 28 bytes (ok); 15 = 30 bytes (too long).
      expect(() => validateMemo({ type: 'text', value: 'é'.repeat(14) })).not.toThrow();
      const err = catchMemoError({ type: 'text', value: 'é'.repeat(15) });
      expect(err.code).toBe('MEMO_TEXT_TOO_LONG');
      expect(err.actual).toBe(30);
    });

    it('measures a Uint8Array by byte length', () => {
      expect(() => validateMemo({ type: 'text', value: new Uint8Array(28) })).not.toThrow();
      expect(catchMemoError({ type: 'text', value: new Uint8Array(29) }).code).toBe(
        'MEMO_TEXT_TOO_LONG',
      );
    });

    it('rejects non-string values', () => {
      const err = catchMemoError({ type: 'text', value: 42 as unknown as string });
      expect(err.code).toBe('MEMO_TEXT_INVALID');
    });
  });

  describe('id', () => {
    it.each([
      ['zero', 0],
      ['a safe integer', 1234],
      ['a numeric string', '18446744073709551615'],
      ['a bigint at the uint64 maximum', 18_446_744_073_709_551_615n],
    ])('accepts %s', (_label, value) => {
      expect(() => validateMemo({ type: 'id', value })).not.toThrow();
    });

    it.each([
      ['a negative number', -1],
      ['a negative bigint', -1n],
      ['a fractional number', 1.5],
      ['an unsafe integer', Number.MAX_SAFE_INTEGER + 1],
      ['a non-numeric string', 'abc'],
      ['an empty string', ''],
      ['a value above uint64', '18446744073709551616'],
      ['a bigint above uint64', 18_446_744_073_709_551_616n],
    ])('rejects %s', (_label, value) => {
      expect(catchMemoError({ type: 'id', value }).code).toBe('MEMO_ID_INVALID');
    });
  });

  describe.each(['hash', 'return'] as const)('%s', (type) => {
    it('accepts a 64-character hex string', () => {
      expect(() => validateMemo({ type, value: HASH_HEX })).not.toThrow();
      expect(() => validateMemo({ type, value: HASH_HEX.toUpperCase() })).not.toThrow();
    });

    it('accepts a 32-byte Uint8Array', () => {
      expect(() => validateMemo({ type, value: new Uint8Array(32) })).not.toThrow();
    });

    it('rejects a 31-byte Uint8Array with the sizes', () => {
      const err = catchMemoError({ type, value: new Uint8Array(31) });
      expect(err.code).toBe('MEMO_HASH_INVALID_LENGTH');
      expect(err.memoType).toBe(type);
      expect(err.limit).toBe(32);
      expect(err.actual).toBe(31);
    });

    it('rejects a 33-byte Uint8Array', () => {
      expect(catchMemoError({ type, value: new Uint8Array(33) }).code).toBe(
        'MEMO_HASH_INVALID_LENGTH',
      );
    });

    it('rejects hex that is too short or too long', () => {
      expect(catchMemoError({ type, value: HASH_HEX.slice(0, 62) }).code).toBe(
        'MEMO_HASH_INVALID_LENGTH',
      );
      expect(catchMemoError({ type, value: `${HASH_HEX}ab` }).code).toBe(
        'MEMO_HASH_INVALID_LENGTH',
      );
    });

    it('rejects an empty string as a length error', () => {
      expect(catchMemoError({ type, value: '' }).code).toBe('MEMO_HASH_INVALID_LENGTH');
    });

    it('rejects non-hex characters', () => {
      expect(catchMemoError({ type, value: `${'zz'.repeat(32)}` }).code).toBe(
        'MEMO_HASH_INVALID_FORMAT',
      );
    });

    it('rejects non-string, non-binary values', () => {
      expect(catchMemoError({ type, value: 123 as unknown as string }).code).toBe(
        'MEMO_HASH_INVALID_FORMAT',
      );
    });
  });

  describe('unknown types', () => {
    it('rejects an unknown memo type', () => {
      const err = catchMemoError({ type: 'bogus' } as unknown as MemoInput);
      expect(err.code).toBe('MEMO_TYPE_INVALID');
      expect(err.message).toContain('bogus');
    });

    it('rejects a missing memo', () => {
      expect(catchMemoError(undefined as unknown as MemoInput).code).toBe('MEMO_TYPE_INVALID');
    });
  });

  describe('MemoValidationError', () => {
    it('is a ValidationError so existing handlers keep working', () => {
      const err = catchMemoError({ type: 'text', value: 'a'.repeat(29) });
      expect(err).toBeInstanceOf(ValidationError);
      expect(err.name).toBe('MemoValidationError');
      expect(err.details).toMatchObject({ field: 'memo', memoType: 'text', limit: 28, actual: 29 });
    });
  });
});

import { Buffer } from 'node:buffer';

import type { CreateTransactionInput } from '@astroid/types';

const STELLAR_PUBLIC_KEY_PATTERN = /^G[A-Z2-7]{55}$/;
const ASSET_CODE_PATTERN = /^[A-Za-z0-9]{1,12}$/;
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;
const STANDARD_TEXT_MEMO_MAX_BYTES = 28;

export type TransactionValidationErrorCode =
  | 'INVALID_TRANSACTION_INPUT'
  | 'MISSING_FIELD'
  | 'INVALID_WALLET_ID'
  | 'INVALID_RECIPIENT_ADDRESS'
  | 'INVALID_AMOUNT'
  | 'INVALID_MEMO'
  | 'INVALID_ASSET'
  | 'INVALID_ASSET_CODE'
  | 'INVALID_ASSET_ISSUER'
  | 'EMPTY_XDR'
  | 'INVALID_XDR_ENCODING';

export interface TransactionValidationError {
  code: TransactionValidationErrorCode;
  field: string;
  description: string;
}

export interface TransactionValidationResult {
  isValid: boolean;
  errors: TransactionValidationError[];
}

export type TransactionValidationInput =
  | string
  | (Partial<CreateTransactionInput> & {
      xdr?: string;
      rawXdr?: string;
      transactionXdr?: string;
      toXDR?: () => string;
    });

function addError(
  errors: TransactionValidationError[],
  code: TransactionValidationErrorCode,
  field: string,
  description: string,
): void {
  errors.push({ code, field, description });
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isPositiveAmount(value: unknown): boolean {
  if (typeof value !== 'number' && typeof value !== 'string') return false;
  if (typeof value === 'string' && value.trim().length === 0) return false;

  const amount = typeof value === 'string' ? Number(value) : value;
  return Number.isFinite(amount) && amount > 0;
}

function memoByteLength(memo: string): number {
  return new TextEncoder().encode(memo).byteLength;
}

function validateXdr(xdr: string, errors: TransactionValidationError[]): void {
  const trimmed = xdr.trim();

  if (trimmed.length === 0) {
    addError(errors, 'EMPTY_XDR', 'xdr', 'XDR must be a non-empty base64 string.');
    return;
  }

  if (trimmed.length % 4 !== 0 || !BASE64_PATTERN.test(trimmed)) {
    addError(errors, 'INVALID_XDR_ENCODING', 'xdr', 'XDR must be valid base64-encoded bytes.');
    return;
  }

  const decoded = Buffer.from(trimmed, 'base64');
  if (decoded.length === 0 || decoded.toString('base64') !== trimmed) {
    addError(errors, 'INVALID_XDR_ENCODING', 'xdr', 'XDR must decode to non-empty base64 bytes.');
  }
}

function validateAsset(asset: unknown, errors: TransactionValidationError[]): void {
  if (!isNonEmptyString(asset)) {
    addError(errors, 'MISSING_FIELD', 'asset', 'Asset is required.');
    return;
  }

  const trimmed = asset.trim();
  const parts = trimmed.split(':');

  if (parts.length > 2) {
    addError(errors, 'INVALID_ASSET', 'asset', 'Asset must be XLM, CODE, or CODE:ISSUER.');
    return;
  }

  const [code, issuer] = parts;
  if (!code || !ASSET_CODE_PATTERN.test(code)) {
    addError(
      errors,
      'INVALID_ASSET_CODE',
      'asset',
      'Asset code must be 1 to 12 alphanumeric characters.',
    );
  }

  if (issuer !== undefined && !STELLAR_PUBLIC_KEY_PATTERN.test(issuer)) {
    addError(
      errors,
      'INVALID_ASSET_ISSUER',
      'asset',
      'Asset issuer must be a valid Stellar public key when provided.',
    );
  }
}

function getWrappedXdr(input: Exclude<TransactionValidationInput, string>): string | undefined {
  if (typeof input.xdr === 'string') return input.xdr;
  if (typeof input.rawXdr === 'string') return input.rawXdr;
  if (typeof input.transactionXdr === 'string') return input.transactionXdr;
  if (typeof input.toXDR === 'function') return input.toXDR();
  return undefined;
}

export function validateTransaction(input: TransactionValidationInput): TransactionValidationResult {
  const errors: TransactionValidationError[] = [];

  if (typeof input === 'string') {
    validateXdr(input, errors);
    return { isValid: errors.length === 0, errors };
  }

  if (!input || typeof input !== 'object') {
    addError(
      errors,
      'INVALID_TRANSACTION_INPUT',
      'transaction',
      'Transaction must be an object representation or raw XDR string.',
    );
    return { isValid: false, errors };
  }

  let wrappedXdr: string | undefined;
  try {
    wrappedXdr = getWrappedXdr(input);
  } catch {
    addError(errors, 'INVALID_XDR_ENCODING', 'xdr', 'Unable to read transaction XDR.');
    return { isValid: false, errors };
  }

  if (wrappedXdr !== undefined) {
    validateXdr(wrappedXdr, errors);
    return { isValid: errors.length === 0, errors };
  }

  if (!isNonEmptyString(input.walletId)) {
    addError(errors, 'MISSING_FIELD', 'walletId', 'Wallet id is required.');
  }

  if (!isNonEmptyString(input.recipientAddress)) {
    addError(errors, 'MISSING_FIELD', 'recipientAddress', 'Recipient address is required.');
  } else if (!STELLAR_PUBLIC_KEY_PATTERN.test(input.recipientAddress)) {
    addError(
      errors,
      'INVALID_RECIPIENT_ADDRESS',
      'recipientAddress',
      'Recipient address must be a valid Stellar public key.',
    );
  }

  validateAsset(input.asset, errors);

  if (input.amount === undefined) {
    addError(errors, 'MISSING_FIELD', 'amount', 'Amount is required.');
  } else if (!isPositiveAmount(input.amount)) {
    addError(errors, 'INVALID_AMOUNT', 'amount', 'Amount must be a positive finite number.');
  }

  if (input.memo !== undefined && input.memo !== null) {
    if (typeof input.memo !== 'string') {
      addError(errors, 'INVALID_MEMO', 'memo', 'Memo must be a standard text memo string.');
    } else if (memoByteLength(input.memo) > STANDARD_TEXT_MEMO_MAX_BYTES) {
      addError(
        errors,
        'INVALID_MEMO',
        'memo',
        `Standard text memo must be ${STANDARD_TEXT_MEMO_MAX_BYTES} bytes or fewer.`,
      );
    }
  }

  return { isValid: errors.length === 0, errors };
}

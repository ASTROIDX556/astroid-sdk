import { describe, expect, it } from 'vitest';

import { validateTransaction } from './validation.js';

const VALID_ADDRESS = 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW';
const VALID_XDR = 'AAAAAA==';

describe('validateTransaction', () => {
  it('accepts a structurally valid transaction input', () => {
    const result = validateTransaction({
      walletId: 'wallet-1',
      recipientAddress: VALID_ADDRESS,
      asset: `USDC:${VALID_ADDRESS}`,
      amount: '10.5',
      memo: 'invoice-123',
    });

    expect(result).toEqual({ isValid: true, errors: [] });
  });

  it('accepts raw XDR strings', () => {
    expect(validateTransaction(VALID_XDR)).toEqual({ isValid: true, errors: [] });
    expect(validateTransaction({ xdr: VALID_XDR, walletId: 'wallet-1' }).isValid).toBe(true);
  });

  it('validates standard text memo byte length with unicode content', () => {
    const result = validateTransaction({
      walletId: 'wallet-1',
      recipientAddress: VALID_ADDRESS,
      asset: 'XLM',
      amount: 1,
      memo: '1234567890123456789012345678!',
    });

    expect(result.isValid).toBe(false);
    expect(result.errors).toContainEqual({
      code: 'INVALID_MEMO',
      field: 'memo',
      description: 'Standard text memo must be 28 bytes or fewer.',
    });

    const unicodeResult = validateTransaction({
      walletId: 'wallet-1',
      recipientAddress: VALID_ADDRESS,
      asset: 'XLM',
      amount: 1,
      memo: '123456789012345678901234567\u00e9',
    });

    expect(unicodeResult.errors.map((error) => error.code)).toContain('INVALID_MEMO');
  });

  it('reports malformed asset identifiers', () => {
    const result = validateTransaction({
      walletId: 'wallet-1',
      recipientAddress: VALID_ADDRESS,
      asset: 'TOO-LONG-ASSET-CODE:not-an-issuer',
      amount: 1,
    });

    expect(result.isValid).toBe(false);
    expect(result.errors.map((error) => error.code)).toEqual([
      'INVALID_ASSET_CODE',
      'INVALID_ASSET_ISSUER',
    ]);
  });

  it('aggregates validation errors instead of throwing on the first one', () => {
    const result = validateTransaction({
      walletId: '',
      recipientAddress: 'bad',
      asset: 'BAD CODE',
      amount: -1,
      memo: '12345678901234567890123456789',
    });

    expect(result.isValid).toBe(false);
    expect(result.errors.map((error) => error.field)).toEqual([
      'walletId',
      'recipientAddress',
      'asset',
      'amount',
      'memo',
    ]);
  });

  it('reports invalid XDR encoding without throwing', () => {
    const result = validateTransaction('not xdr');

    expect(result).toEqual({
      isValid: false,
      errors: [
        {
          code: 'INVALID_XDR_ENCODING',
          field: 'xdr',
          description: 'XDR must be valid base64-encoded bytes.',
        },
      ],
    });
  });
});

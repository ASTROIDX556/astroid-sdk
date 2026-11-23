import { describe, expect, it } from 'vitest';
import { ValidationError } from '@astroid/errors';
import type { AssetBalance, WalletBalance } from '@astroid/types';

import {
  aggregateWalletBalances,
  assetBalanceFromBaseUnits,
  assetBalanceKey,
  assetBalanceToBaseUnits,
  convertAssetAmount,
  findAssetBalance,
  findNativeBalance,
  formatAssetAmount,
  isNativeAssetBalance,
  sumAssetBalances,
  summarizeWalletBalances,
} from './balance-utils.js';
import {
  assetBalanceToBaseUnits as exportedToBaseUnits,
  formatAssetBalance,
  formatAssetAmount as exportedFormatAmount,
} from './index.js';

const ISSUER_A = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const ISSUER_B = 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';

function snapshot(...balances: AssetBalance[]): WalletBalance {
  return {
    walletId: 'wal_1',
    stellarAddress: 'GCUSTOMERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    network: 'TESTNET',
    balances,
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('native and issued asset identity', () => {
  it('recognises native XLM without an issuer', () => {
    const xlm: AssetBalance = { asset: 'XLM', balance: '1.5' };

    expect(isNativeAssetBalance(xlm)).toBe(true);
    expect(isNativeAssetBalance({ ...xlm, asset: 'xlm' })).toBe(true);
    expect(isNativeAssetBalance({ ...xlm, asset: 'NATIVE', issuer: null })).toBe(true);
    expect(assetBalanceKey(xlm)).toBe('XLM');
  });

  it('keeps issued trustlines distinct from native XLM', () => {
    const usdc: AssetBalance = { asset: 'USDC', balance: '10', issuer: ISSUER_A };
    const issuedXlm: AssetBalance = { asset: 'XLM', balance: '10', issuer: ISSUER_A };

    expect(isNativeAssetBalance(usdc)).toBe(false);
    expect(isNativeAssetBalance(issuedXlm)).toBe(false);
    expect(assetBalanceKey(usdc)).toBe(`USDC:${ISSUER_A}`);
    expect(assetBalanceKey(issuedXlm)).toBe(`XLM:${ISSUER_A}`);
    expect(assetBalanceKey({ ...usdc, asset: 'usdc' })).toBe(`USDC:${ISSUER_A}`);
  });

  it('finds balances by identifier or code and issuer', () => {
    const balance = snapshot(
      { asset: 'XLM', balance: '2' },
      { asset: 'USDC', balance: '3', issuer: ISSUER_A },
      { asset: 'USDC', balance: '4', issuer: ISSUER_B },
    );

    expect(findNativeBalance(balance)?.balance).toBe('2');
    expect(findAssetBalance(balance, 'XLM')?.balance).toBe('2');
    expect(findAssetBalance(balance, `USDC:${ISSUER_B}`)?.balance).toBe('4');
    expect(findAssetBalance(balance, 'USDC', ISSUER_A)?.balance).toBe('3');
    expect(findAssetBalance(balance, 'USDC', 'GMISSING')).toBeUndefined();
  });
});

describe('balance aggregation', () => {
  it('sums native and issued balances without floating-point drift', () => {
    const totals = sumAssetBalances([
      { asset: 'XLM', balance: '0.1' },
      { asset: 'XLM', balance: '0.2', issuer: null },
      { asset: 'USDC', balance: '1.10', issuer: ISSUER_A },
      { asset: 'USDC', balance: '2.2', issuer: ISSUER_A },
      { asset: 'USDC', balance: '3', issuer: ISSUER_B },
    ]);

    expect(totals).toHaveLength(3);
    expect(totals[0]).toMatchObject({ asset: 'XLM', balance: '0.3', sources: 2 });
    expect(totals[1]).toMatchObject({
      asset: 'USDC',
      issuer: ISSUER_A,
      balance: '3.3',
      sources: 2,
    });
    expect(totals[2]).toMatchObject({ asset: 'USDC', issuer: ISSUER_B, balance: '3', sources: 1 });
  });

  it('preserves precision for balances above the safe integer range', () => {
    const amount = '12345678901234567890.0000001';
    const totals = sumAssetBalances([
      { asset: 'XLM', balance: amount },
      { asset: 'XLM', balance: amount },
    ]);

    expect(totals[0]?.balance).toBe('24691357802469135780.0000002');
  });

  it('aggregates balances across several wallet snapshots', () => {
    const totals = aggregateWalletBalances([
      snapshot({ asset: 'XLM', balance: '10' }, { asset: 'USDC', balance: '1', issuer: ISSUER_A }),
      snapshot({ asset: 'XLM', balance: '5' }, { asset: 'USDC', balance: '2', issuer: ISSUER_A }),
    ]);

    expect(totals).toHaveLength(2);
    expect(totals[0]?.balance).toBe('15');
    expect(totals[1]?.balance).toBe('3');
    expect(totals.every((balance) => balance.sources === 2)).toBe(true);
  });

  it('summarizes a snapshot into native and issued groups', () => {
    const summary = summarizeWalletBalances(
      snapshot(
        { asset: 'XLM', balance: '4.5' },
        { asset: 'USDC', balance: '1.25', issuer: ISSUER_A },
        { asset: 'EURC', balance: '2', issuer: ISSUER_B },
      ),
    );

    expect(summary.totalAssets).toBe(3);
    expect(summary.native?.balance).toBe('4.5');
    expect(summary.issued.map((balance) => balance.asset)).toEqual(['USDC', 'EURC']);
    expect(summary.assets).toHaveLength(3);
  });

  it('handles an empty snapshot', () => {
    const summary = summarizeWalletBalances(snapshot());

    expect(summary.totalAssets).toBe(0);
    expect(summary.native).toBeUndefined();
    expect(summary.issued).toEqual([]);
  });
});

describe('formatAssetAmount', () => {
  it('groups integer digits and keeps all fraction digits', () => {
    expect(formatAssetAmount('1234567.8900')).toBe('1,234,567.8900');
    expect(formatAssetAmount('0.0000001')).toBe('0.0000001');
    expect(formatAssetAmount('1234567.8900', { grouping: false })).toBe('1234567.8900');
  });

  it('supports custom separators, symbols and sign', () => {
    expect(
      formatAssetAmount('1234.5', {
        thousandsSeparator: '.',
        decimalSeparator: ',',
        symbol: 'XLM',
      }),
    ).toBe('1.234,5 XLM');
    expect(formatAssetAmount('1234.5', { symbol: '$', symbolPosition: 'prefix' })).toBe('$1,234.5');
    expect(formatAssetAmount('-1234.5')).toBe('-1,234.5');
  });

  it('pads and rounds fractions using integer arithmetic', () => {
    expect(formatAssetAmount('1.2', { minFractionDigits: 4 })).toBe('1.2000');
    expect(formatAssetAmount('1.239', { maxFractionDigits: 2 })).toBe('1.23');
    expect(formatAssetAmount('1.239', { maxFractionDigits: 2, rounding: 'half-up' })).toBe('1.24');
    expect(formatAssetAmount('-1.239', { maxFractionDigits: 2, rounding: 'half-up' })).toBe(
      '-1.24',
    );
    expect(formatAssetAmount('0.999', { maxFractionDigits: 2, rounding: 'half-up' })).toBe('1.00');
  });

  it('rejects malformed amounts and invalid fraction options', () => {
    expect(() => formatAssetAmount('1e7')).toThrow('Invalid balance amount');
    expect(() => formatAssetAmount('1.2', { minFractionDigits: 4, maxFractionDigits: 2 })).toThrow(
      'must not exceed',
    );
  });
});

describe('asset conversion helpers', () => {
  it('converts balances to and from base units', () => {
    expect(assetBalanceToBaseUnits({ asset: 'XLM', balance: '1.2500000' })).toBe(12500000n);
    expect(assetBalanceToBaseUnits({ asset: 'USDC', balance: '1.25' }, 2)).toBe(125n);
    expect(assetBalanceFromBaseUnits('XLM', 12500000n)).toEqual({ asset: 'XLM', balance: '1.25' });
    expect(assetBalanceFromBaseUnits('USDC', '125', ISSUER_A, 2)).toEqual({
      asset: 'USDC',
      balance: '1.25',
      issuer: ISSUER_A,
    });
  });

  it('round-trips issued amounts beyond Number.MAX_SAFE_INTEGER', () => {
    const balance: AssetBalance = {
      asset: 'USDC',
      balance: '9007199254740993.0000001',
      issuer: ISSUER_A,
    };

    expect(assetBalanceFromBaseUnits('USDC', assetBalanceToBaseUnits(balance), ISSUER_A)).toEqual(
      balance,
    );
  });

  it('converts between asset precisions without losing information', () => {
    expect(convertAssetAmount('1.5', 7, 2)).toBe('1.5');
    expect(convertAssetAmount('1.25', 2, 7)).toBe('1.25');
    expect(convertAssetAmount('0.0000001', 7, 8)).toBe('0.0000001');
  });

  it('rejects precision-losing conversions', () => {
    try {
      convertAssetAmount('1.2345678', 7, 3);
      throw new Error('expected a precision loss error');
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).code).toBe('PRECISION_LOSS');
    }
  });
});

describe('package exports', () => {
  it('re-exports the new helpers from the package entry point', () => {
    expect(exportedFormatAmount).toBe(formatAssetAmount);
    expect(exportedToBaseUnits).toBe(assetBalanceToBaseUnits);
    expect(formatAssetBalance({ asset: 'XLM', balance: '1234.5' }, { symbol: 'XLM' })).toEqual({
      asset: 'XLM',
      balance: '1234.5',
      formattedBalance: '1,234.5 XLM',
    });
  });
});

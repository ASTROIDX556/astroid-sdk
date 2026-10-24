import { describe, expect, it, vi } from 'vitest';
import {
  Account,
  Asset,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-base';
import {
  simulateTransaction,
} from './simulate.js';
import { TransactionSimulationError } from './errors.js';

const TESTNET = Networks.TESTNET;

/** Build a valid payment transaction XDR */
function buildSampleXdr(fee = 100, networkPassphrase = TESTNET): string {
  const keypair = Keypair.random();
  const account = new Account(keypair.publicKey(), '1');
  const tx = new TransactionBuilder(account, {
    fee: String(fee),
    networkPassphrase,
  })
    .addOperation(
      Operation.payment({
        destination: keypair.publicKey(),
        asset: Asset.native(),
        amount: '10',
      }),
    )
    .setTimeout(30)
    .build();
  return tx.toXDR();
}

/** Build a valid Transaction instance */
function buildSampleTransaction(fee = 100, networkPassphrase = TESTNET) {
  const keypair = Keypair.random();
  const account = new Account(keypair.publicKey(), '1');
  return new TransactionBuilder(account, {
    fee: String(fee),
    networkPassphrase,
  })
    .addOperation(
      Operation.payment({
        destination: keypair.publicKey(),
        asset: Asset.native(),
        amount: '10',
      }),
    )
    .setTimeout(30)
    .build();
}

describe('simulateTransaction', () => {
  it('successfully simulates transaction using mock fetch response', async () => {
    const xdr = buildSampleXdr(100);
    const mockResponseData = {
      status: 'success',
      estimatedFee: '150',
      resourceUsage: {
        cpuInstructions: 1200000,
        memoryBytes: 40960,
        readBytes: 1024,
        writeBytes: 256,
      },
      diagnostics: {
        detail: 'Simulation successful',
      },
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockResponseData,
    });

    const report = await simulateTransaction(xdr, {
      fetch: mockFetch as unknown as typeof fetch,
      endpoint: 'https://api.astroid.org/transactions/simulate',
    });

    expect(report.success).toBe(true);
    expect(report.status).toBe('success');
    expect(report.transactionXdr).toBe(xdr);
    expect(report.estimatedFee).toBe('150');
    expect(report.resourceUsage).toEqual(mockResponseData.resourceUsage);
    expect(report.diagnostics?.detail).toBe('Simulation successful');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.astroid.org/transactions/simulate',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({ transactionXdr: xdr }),
      }),
    );
  });

  it('accepts a built Transaction object and correctly serializes it', async () => {
    const tx = buildSampleTransaction(200);
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: 'success', fee: 200 }),
    });

    const report = await simulateTransaction(tx, {
      fetch: mockFetch as unknown as typeof fetch,
    });

    expect(report.success).toBe(true);
    expect(report.transactionXdr).toBe(tx.toXDR());
    expect(report.estimatedFee).toBe(200);
  });

  it('works with HttpClient client option', async () => {
    const xdr = buildSampleXdr(100);
    const mockPost = vi.fn().mockResolvedValue({
      data: {
        status: 'success',
        estimatedFee: 100,
        resources: {
          cpuInstructions: 50000,
        },
      },
    });

    const mockClient = { post: mockPost };

    const report = await simulateTransaction(xdr, {
      client: mockClient,
    });

    expect(report.success).toBe(true);
    expect(mockPost).toHaveBeenCalledWith('/transactions/simulate', { transactionXdr: xdr });
    expect(report.resourceUsage).toEqual({ cpuInstructions: 50000 });
  });

  it('handles simulation failure responses with HTTP 400', async () => {
    const xdr = buildSampleXdr(100);
    const errorBody = {
      message: 'Transaction simulation failed',
      code: 'tx_failed',
      diagnostics: {
        stellarCode: 'tx_failed',
        operationCode: 'op_underfunded',
        operationResultCodes: ['op_underfunded'],
        failedOperationIndex: 0,
        detail: 'Source account has insufficient balance',
      },
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => errorBody,
    });

    const report = await simulateTransaction(xdr, {
      fetch: mockFetch as unknown as typeof fetch,
    });

    expect(report.success).toBe(false);
    expect(report.status).toBe('failed');
    expect(report.error).toBeInstanceOf(TransactionSimulationError);
    expect(report.diagnostics?.stellarCode).toBe('tx_failed');
    expect(report.diagnostics?.operationCode).toBe('op_underfunded');
    expect(report.diagnostics?.operationResultCodes).toEqual(['op_underfunded']);
    expect(report.diagnostics?.failedOperationIndex).toBe(0);
    expect(report.diagnostics?.detail).toBe('Source account has insufficient balance');
  });

  it('handles fee bump required simulation responses', async () => {
    const xdr = buildSampleXdr(100);
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        status: 'fee_bump_required',
        feeBumpSuggestion: {
          required: true,
          suggestedFee: 5000,
          suggestedBaseFee: 5000,
          reason: 'Ledger base fee spike',
        },
      }),
    });

    const report = await simulateTransaction(xdr, {
      fetch: mockFetch as unknown as typeof fetch,
    });

    expect(report.success).toBe(false);
    expect(report.status).toBe('fee_bump_required');
    expect(report.feeBumpSuggestion?.required).toBe(true);
    expect(report.feeBumpSuggestion?.suggestedFee).toBe(5000);
    expect(report.feeBumpSuggestion?.reason).toBe('Ledger base fee spike');
  });

  it('handles network / connection errors gracefully without crashing', async () => {
    const xdr = buildSampleXdr(100);
    const mockFetch = vi.fn().mockRejectedValue(new Error('Connection refused'));

    const report = await simulateTransaction(xdr, {
      fetch: mockFetch as unknown as typeof fetch,
    });

    expect(report.success).toBe(false);
    expect(report.status).toBe('failed');
    expect(report.error).toBeDefined();
    expect(report.error?.message).toMatch(/Transaction simulation failed|Connection refused/);
  });

  it('returns a failed report when invalid / empty XDR is provided', async () => {
    const report = await simulateTransaction('');
    expect(report.success).toBe(false);
    expect(report.status).toBe('failed');
    expect(report.error).toBeDefined();
  });
});

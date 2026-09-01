import { describe, expect, it, vi } from 'vitest';

import { Account, Keypair, Networks } from '@stellar/stellar-base';
import { HttpClient } from '@astroid/core';
import { NetworkError } from '@astroid/errors';
import type { Transaction } from '@astroid/types';

import { buildPaymentTransaction } from '../src/builder.js';
import { formatTransactionForSubmission, submitSignedTransaction } from '../src/submit.js';

const RECORD = {
  id: 'tx_1',
  organizationId: 'org_1',
  walletId: 'w_1',
  asset: 'USDC',
  amount: '10',
  recipientAddress: '',
  status: 'SUBMITTED',
  riskScore: 0.1,
  riskBand: 'LOW',
  requiresApproval: false,
  confirmationCount: 0,
  metadata: {},
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

function buildSignedXdr(): string {
  const keypair = Keypair.random();
  const destination = Keypair.random().publicKey();
  const tx = buildPaymentTransaction({
    source: new Account(keypair.publicKey(), '7'),
    networkPassphrase: Networks.TESTNET,
    destination,
    asset: `USDC:${Keypair.random().publicKey()}`,
    amount: '10',
  });
  tx.sign(keypair);
  return tx.toXDR();
}

describe('formatTransactionForSubmission', () => {
  it('passes a base64 XDR string through unchanged', () => {
    const xdr = buildSignedXdr();
    expect(formatTransactionForSubmission(xdr)).toEqual({ transactionXdr: xdr });
  });

  it('encodes a built transaction into the request body', () => {
    const keypair = Keypair.random();
    const tx = buildPaymentTransaction({
      source: new Account(keypair.publicKey(), '7'),
      networkPassphrase: Networks.TESTNET,
      destination: Keypair.random().publicKey(),
      asset: 'XLM',
      amount: '5',
    });
    const body = formatTransactionForSubmission(tx);
    expect(body.transactionXdr).toBe(tx.toXDR());
  });
});

describe('submitSignedTransaction', () => {
  it('POSTs the envelope to /transactions/submit and returns the record', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ data: RECORD }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const http = new HttpClient({
      apiKey: 'sk_test',
      baseUrl: 'https://api.example.test',
      retry: false,
      fetch: fetchMock as unknown as typeof fetch,
    });

    const xdr = buildSignedXdr();
    const result = await submitSignedTransaction(http, xdr);

    expect(result).toEqual(RECORD as Transaction);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain('/transactions/submit');
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ transactionXdr: xdr });
  });

  it('handles transport failures as a structured NetworkError', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const http = new HttpClient({
      apiKey: 'sk_test',
      baseUrl: 'https://api.example.test',
      retry: false,
      fetch: fetchMock as unknown as typeof fetch,
    });

    await expect(submitSignedTransaction(http, buildSignedXdr())).rejects.toBeInstanceOf(
      NetworkError,
    );
  });
});
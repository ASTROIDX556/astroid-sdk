import { describe, expect, it, vi } from 'vitest';

import { Account, Keypair, Networks } from '@stellar/stellar-base';
import { HttpClient } from '@astroid/core';
import {
  InsufficientBalanceError,
  NetworkError,
  SequenceConflictError,
  TransactionExpiredError,
  ValidationError,
} from '@astroid/errors';
import type { Transaction } from '@astroid/types';

import { buildPaymentTransaction } from '../builder.js';
import {
  parseTransactionEnvelope,
  submitTransaction,
  submitTransactionToApi,
} from '../submit.js';
import {
  checkTransactionStatus,
  isFinalTransactionStatus,
  isSuccessfulTransactionStatus,
  verifyTransactionStatus,
} from '../status.js';

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

/** The signature of the injected `fetch` implementation used by the helpers. */
type FetchArgs = (url: string | URL | Request, init?: RequestInit) => Promise<Response>;

function buildSignedXdr(): string {
  const keypair = Keypair.random();
  const tx = buildPaymentTransaction({
    source: new Account(keypair.publicKey(), '7'),
    networkPassphrase: Networks.TESTNET,
    destination: Keypair.random().publicKey(),
    asset: 'XLM',
    amount: '10',
  });
  tx.sign(keypair);
  return tx.toXDR();
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const RECORD: Transaction = {
  id: 'tx_1',
  organizationId: 'org_1',
  walletId: 'w_1',
  asset: 'XLM',
  amount: '10',
  recipientAddress: 'GDESTINATION',
  status: 'SUBMITTED',
  riskScore: 0.1,
  riskBand: 'LOW',
  requiresApproval: false,
  stellarHash: 'abc123',
  confirmationCount: 0,
  metadata: {},
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

function httpClient(fetchMock: FetchArgs): HttpClient {
  return new HttpClient({
    apiKey: 'sk_test',
    baseUrl: 'https://api.example.test',
    retry: false,
    fetch: fetchMock as unknown as typeof fetch,
  });
}

/* -------------------------------------------------------------------------- */
/* Envelope parsing                                                            */
/* -------------------------------------------------------------------------- */

describe('parseTransactionEnvelope', () => {
  it('extracts the hash, source and operation count from a signed envelope', () => {
    const xdr = buildSignedXdr();
    const parsed = parseTransactionEnvelope(xdr, { networkPassphrase: Networks.TESTNET });

    expect(parsed.xdr).toBe(xdr);
    expect(parsed.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(parsed.sourceAccount).toMatch(/^G/);
    expect(parsed.sequenceNumber).toMatch(/^\d+$/);
    expect(parsed.fee).toBe('100');
    expect(parsed.operationCount).toBe(1);
    expect(parsed.isFeeBump).toBe(false);
  });

  it('rejects a malformed envelope', () => {
    expect(() => parseTransactionEnvelope('not-a-valid-xdr')).toThrowError(ValidationError);
  });
});

/* -------------------------------------------------------------------------- */
/* Horizon submission                                                          */
/* -------------------------------------------------------------------------- */

describe('submitTransaction', () => {
  it('broadcasts the envelope and parses the hash and ledger from the response', async () => {
    const fetchMock = vi.fn<FetchArgs>(async () =>
      jsonResponse({
        hash: 'deadbeef',
        ledger: 123456,
        result_codes: { transaction: 'tx_success', operations: ['op_success'] },
      }),
    );

    const xdr = buildSignedXdr();
    const result = await submitTransaction(xdr, {
      networkPassphrase: Networks.TESTNET,
      horizonUrl: 'https://horizon-testnet.stellar.org',
      fetch: fetchMock as unknown as typeof fetch,
    });

    expect(result.successful).toBe(true);
    expect(result.status).toBe('SUCCESS');
    expect(result.hash).toBe('deadbeef');
    expect(result.ledger).toBe(123456);
    expect(result.resultCodes).toEqual({
      transaction: 'tx_success',
      operation: 'op_success',
      operations: ['op_success'],
    });
    expect(result.error).toBeUndefined();

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('https://horizon-testnet.stellar.org/transactions');
    expect((init as RequestInit).method).toBe('POST');
    expect(String((init as RequestInit).body)).toBe(`tx=${encodeURIComponent(xdr)}`);
  });

  it('maps an underfunded operation onto InsufficientBalanceError', async () => {
    const fetchMock = vi.fn<FetchArgs>(async () =>
      jsonResponse(
        {
          type: 'https://stellar.org/horizon-errors/transaction_failed',
          title: 'Transaction Failed',
          status: 400,
          detail: 'The transaction failed when submitted to the stellar network.',
          extras: {
            result_codes: { transaction: 'tx_failed', operations: ['op_underfunded'] },
          },
        },
        400,
      ),
    );

    const result = await submitTransaction(buildSignedXdr(), {
      networkPassphrase: Networks.TESTNET,
      fetch: fetchMock as unknown as typeof fetch,
    });

    expect(result.successful).toBe(false);
    expect(result.status).toBe('FAILED');
    expect(result.error).toBeInstanceOf(InsufficientBalanceError);
    expect(result.error?.code).toBe('op_underfunded');
    expect(result.resultCodes).toEqual({
      transaction: 'tx_failed',
      operation: 'op_underfunded',
      operations: ['op_underfunded'],
    });
  });

  it('maps a stale sequence number onto SequenceConflictError', async () => {
    const fetchMock = vi.fn<FetchArgs>(async () =>
      jsonResponse(
        {
          detail: 'Transaction failed.',
          extras: { result_codes: { transaction: 'tx_bad_seq' } },
        },
        400,
      ),
    );

    const result = await submitTransaction(buildSignedXdr(), {
      networkPassphrase: Networks.TESTNET,
      fetch: fetchMock as unknown as typeof fetch,
    });

    expect(result.successful).toBe(false);
    expect(result.error).toBeInstanceOf(SequenceConflictError);
    expect(result.error?.code).toBe('tx_bad_seq');
  });

  it('maps an expired transaction onto TransactionExpiredError', async () => {
    const fetchMock = vi.fn<FetchArgs>(async () =>
      jsonResponse(
        {
          detail: 'Transaction failed.',
          extras: { result_codes: { transaction: 'tx_too_late' } },
        },
        400,
      ),
    );

    const result = await submitTransaction(buildSignedXdr(), {
      networkPassphrase: Networks.TESTNET,
      fetch: fetchMock as unknown as typeof fetch,
    });

    expect(result.successful).toBe(false);
    expect(result.error).toBeInstanceOf(TransactionExpiredError);
  });

  it('reports a transport failure as a NetworkError', async () => {
    const fetchMock = vi.fn<FetchArgs>(async () => {
      throw new TypeError('Failed to fetch');
    });

    const result = await submitTransaction(buildSignedXdr(), {
      networkPassphrase: Networks.TESTNET,
      fetch: fetchMock as unknown as typeof fetch,
    });

    expect(result.successful).toBe(false);
    expect(result.status).toBe('FAILED');
    expect(result.error).toBeInstanceOf(NetworkError);
  });

  it('never reaches the network with a malformed envelope', async () => {
    const fetchMock = vi.fn<FetchArgs>(async () => jsonResponse({}));

    const result = await submitTransaction('not-a-valid-xdr', {
      fetch: fetchMock as unknown as typeof fetch,
    });

    expect(result.successful).toBe(false);
    expect(result.status).toBe('FAILED');
    expect(result.error).toBeInstanceOf(ValidationError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

/* -------------------------------------------------------------------------- */
/* Astroid API submission                                                      */
/* -------------------------------------------------------------------------- */

describe('submitTransactionToApi', () => {
  it('POSTs the envelope to /transactions/submit and parses the record', async () => {
    const fetchMock = vi.fn<FetchArgs>(async () => jsonResponse({ data: RECORD }));

    const xdr = buildSignedXdr();
    const result = await submitTransactionToApi(httpClient(fetchMock), xdr, {
      networkPassphrase: Networks.TESTNET,
    });

    expect(result.successful).toBe(true);
    expect(result.status).toBe('PENDING');
    expect(result.transactionId).toBe('tx_1');
    expect(result.hash).toBe('abc123');

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain('/transactions/submit');
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ transactionXdr: xdr });
  });

  it('maps a forwarded Stellar result code onto the matching SDK error', async () => {
    const fetchMock = vi.fn<FetchArgs>(async () =>
      jsonResponse(
        {
          error: {
            code: 'TRANSACTION_FAILED',
            message: 'The transaction failed on the Stellar network.',
            details: {
              extras: {
                result_codes: { transaction: 'tx_failed', operations: ['op_underfunded'] },
              },
            },
          },
        },
        400,
      ),
    );

    const result = await submitTransactionToApi(httpClient(fetchMock), buildSignedXdr(), {
      networkPassphrase: Networks.TESTNET,
    });

    expect(result.successful).toBe(false);
    expect(result.status).toBe('FAILED');
    expect(result.error).toBeInstanceOf(InsufficientBalanceError);
  });

  it('reports a completed record as a successful submission', async () => {
    const fetchMock = vi.fn<FetchArgs>(async () =>
      jsonResponse({ data: { ...RECORD, status: 'COMPLETED', confirmationCount: 3 } }),
    );

    const result = await submitTransactionToApi(httpClient(fetchMock), buildSignedXdr(), {
      networkPassphrase: Networks.TESTNET,
    });

    expect(result.successful).toBe(true);
    expect(result.status).toBe('SUCCESS');
  });
});

/* -------------------------------------------------------------------------- */
/* Status verification                                                         */
/* -------------------------------------------------------------------------- */

describe('transaction status verification', () => {
  it('classifies final and successful statuses', () => {
    expect(isFinalTransactionStatus('COMPLETED')).toBe(true);
    expect(isFinalTransactionStatus('REJECTED')).toBe(true);
    expect(isFinalTransactionStatus('SUBMITTED')).toBe(false);
    expect(isSuccessfulTransactionStatus('CONFIRMED')).toBe(true);
    expect(isSuccessfulTransactionStatus('PENDING')).toBe(false);
  });

  it('marks a completed transaction with enough confirmations as final', () => {
    const verification = checkTransactionStatus(
      { ...RECORD, status: 'COMPLETED', confirmationCount: 3 },
      { requiredConfirmations: 2 },
    );

    expect(verification).toEqual({
      status: 'COMPLETED',
      successful: true,
      final: true,
      confirmations: 3,
      requiredConfirmations: 2,
      hash: 'abc123',
    });
  });

  it('keeps a submitted transaction pending', () => {
    const verification = checkTransactionStatus(RECORD);

    expect(verification.successful).toBe(false);
    expect(verification.final).toBe(false);
    expect(verification.status).toBe('SUBMITTED');
  });

  it('fetches a transaction and verifies its status', async () => {
    const fetchMock = vi.fn<FetchArgs>(async () =>
      jsonResponse({ data: { ...RECORD, status: 'COMPLETED', confirmationCount: 1 } }),
    );

    const verification = await verifyTransactionStatus(httpClient(fetchMock), 'tx_1');

    expect(verification.final).toBe(true);
    expect(verification.successful).toBe(true);
    const [url] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain('/transactions/tx_1');
  });
});

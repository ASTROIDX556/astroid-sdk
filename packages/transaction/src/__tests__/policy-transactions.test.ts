/**
 * Unit tests for the Astroid policy-gated transaction helpers.
 *
 * Covers the three policy-gated builders (payment, swap, contract
 * invocation), fee estimation with a mocked Horizon fetch, and the
 * policy-validated submitter against an in-memory Horizon client mock. No
 * real network, timers, or secret keys are used anywhere — `Keypair.random()`
 * generates throwaway test identities and every network interaction is a
 * mock.
 */

import { describe, expect, it, vi } from 'vitest';

import { Account, Keypair, Networks, StrKey, TransactionBuilder, xdr } from '@stellar/stellar-base';
import type { Transaction } from '@stellar/stellar-base';
import { ValidationError } from '@astroid/errors';
import type { PolicySet } from '@astroid/types';

import {
  MAX_SWAP_PATH_LENGTH,
  POLICY_ENVELOPE_NAME,
  POLICY_IDS_ENVELOPE_NAME,
  PolicyViolationError,
  buildPolicyContractInvocationTransaction,
  buildPolicyPaymentTransaction,
  buildPolicySwapTransaction,
  readPolicyEnvelope,
} from '../policy-builders.js';
import {
  TransactionNetworkRejectedError,
  TransactionNetworkUnavailableError,
  TransactionPolicyViolationError,
  TransactionSequenceMismatchError,
  mapSubmissionError,
  submitPolicyTransaction,
  submitPolicyTransactionWithRetry,
} from '../policy-submitter.js';
import { estimateFee, formatFeeAsXlm, parseFeeInStroops } from '../fee-estimation.js';

/* -------------------------------------------------------------------------- */
/* Shared fixtures                                                             */
/* -------------------------------------------------------------------------- */

/** Fixed evaluation instant — every test pins `now` so nothing is time-flaky. */
const FIXED_NOW = new Date('2026-09-29T12:00:00.000Z');

/** A fresh source account with sequence number `100`. */
function account(): Account {
  return new Account(Keypair.random().publicKey(), '100');
}

/** A policy set with no constraints — everything passes. */
const PERMISSIVE: PolicySet = { name: 'permissive', rules: [] };

/** An allowlist policy that only permits payments to `recipient`. */
function allowOnly(recipient: string): PolicySet {
  return {
    name: 'allowlist',
    rules: [{ name: 'Recipient allowlist', allowedRecipients: [recipient] }],
  };
}

/** A mock Horizon client that resolves with a successful submission shape. */
function successfulClient(hash = 'a'.repeat(64), ledger = 12345) {
  return { submitTransaction: vi.fn().mockResolvedValue({ successful: true, hash, ledger }) };
}

/** A Horizon error carrying Horizon `extras.result_codes` in its response. */
function horizonError(resultCodes: {
  transaction?: string;
  operations?: string[] | string;
}): unknown {
  return {
    response: {
      status: 400,
      extras: { result_codes: resultCodes },
    },
  };
}

/** Decode a built transaction through `TransactionBuilder.fromXDR` as `Transaction`. */
function decode(tx: Transaction, passphrase: string): Transaction {
  return TransactionBuilder.fromXDR(tx.toXDR(), passphrase) as Transaction;
}

/* -------------------------------------------------------------------------- */
/* Builders — payload generation                                               */
/* -------------------------------------------------------------------------- */

describe('buildPolicyPaymentTransaction — construction', () => {
  const destination = Keypair.random().publicKey();

  it('builds an unsigned payment carrying the policy envelope as the last operation', () => {
    const source = Keypair.random();
    const tx = buildPolicyPaymentTransaction({
      source: new Account(source.publicKey(), '100'),
      networkPassphrase: Networks.TESTNET,
      policySet: PERMISSIVE,
      policyIds: ['policy_1'],
      destination,
      asset: 'XLM',
      amount: '10.5',
      now: FIXED_NOW,
    });

    expect(tx.signatures).toHaveLength(0);
    // payment + core envelope document + policy-id list op
    expect(tx.operations).toHaveLength(3);

    const [payment, envelope] = tx.operations;
    if (!payment || !envelope) throw new Error('expected at least two operations');
    expect(payment.type).toBe('payment');
    if (payment.type !== 'payment') throw new Error('expected payment op');
    expect(payment.destination).toBe(destination);
    expect(payment.amount).toBe('10.5000000');

    expect(envelope.type).toBe('manageData');
    if (envelope.type !== 'manageData') throw new Error('expected manageData op');
    expect(envelope.name).toBe(POLICY_ENVELOPE_NAME);

    // The policy-id list rides in its own trailing manageData op (64-byte cap).
    const last = tx.operations[2];
    expect(last?.type).toBe('manageData');
    if (last?.type !== 'manageData') throw new Error('expected manageData op');
    expect(last.name).toBe(POLICY_IDS_ENVELOPE_NAME);

    const parsed = readPolicyEnvelope(tx);
    expect(parsed).toMatchObject({
      v: 1,
      allowed: true,
      policyIds: ['policy_1'],
      failedRules: [],
      ts: FIXED_NOW.getTime(),
    });
  });

  it('survives an XDR round-trip with the envelope readable', () => {
    const tx = buildPolicyPaymentTransaction({
      source: account(),
      networkPassphrase: Networks.TESTNET,
      policySet: PERMISSIVE,
      destination,
      asset: 'XLM',
      amount: '1',
      now: FIXED_NOW,
    });

    const decoded = decode(tx, Networks.TESTNET);
    expect(decoded.source).toBe(tx.source);
    expect(decoded.networkPassphrase).toBe(Networks.TESTNET);

    // Omitting policyIds leaves the key out of the envelope JSON entirely.
    const envelope = readPolicyEnvelope(decoded);
    expect(envelope).toBeDefined();
    expect(envelope?.v).toBe(1);
    expect(envelope?.allowed).toBe(true);
    expect(envelope?.policyIds).toBeUndefined();
    expect(envelope?.ts).toBe(FIXED_NOW.getTime());
  });

  it('derives the total fee from the total bid (2 ops, 500 stroops → 250/op → tx fee 500)', () => {
    const tx = buildPolicyPaymentTransaction({
      source: account(),
      networkPassphrase: Networks.TESTNET,
      policySet: PERMISSIVE,
      destination,
      asset: 'XLM',
      amount: '1',
      fee: 500,
      now: FIXED_NOW,
    });

    expect(tx.operations).toHaveLength(2);
    expect(tx.fee).toBe('500');
  });

  it('rejects a fee bid below ops × base fee', () => {
    expect(() =>
      buildPolicyPaymentTransaction({
        source: account(),
        networkPassphrase: Networks.TESTNET,
        policySet: PERMISSIVE,
        destination,
        asset: 'XLM',
        amount: '1',
        fee: 100, // 2 ops × 100 stroops floor = 200
        now: FIXED_NOW,
      }),
    ).toThrowError(/below the network minimum/);
  });

  it('keeps the text memo on the transaction', () => {
    const tx = buildPolicyPaymentTransaction({
      source: account(),
      networkPassphrase: Networks.TESTNET,
      policySet: PERMISSIVE,
      destination,
      asset: 'XLM',
      amount: '1',
      memoText: 'invoice-42',
      now: FIXED_NOW,
    });

    expect(tx.memo?.type).toBe('text');
    expect(String(tx.memo?.value)).toBe('invoice-42');
  });
});

describe('buildPolicySwapTransaction — construction', () => {
  const destination = Keypair.random().publicKey();
  const issuer = Keypair.random().publicKey();

  it('builds a pathPaymentStrictReceive with the conversion and envelope', () => {
    const tx = buildPolicySwapTransaction({
      source: account(),
      networkPassphrase: Networks.TESTNET,
      policySet: PERMISSIVE,
      sendAsset: 'XLM',
      sendMax: '500',
      destination,
      destAsset: `USDC:${issuer}`,
      destAmount: '25',
      path: ['XLM'],
      now: FIXED_NOW,
    });

    expect(tx.operations).toHaveLength(2);
    const [swap] = tx.operations;
    if (!swap) throw new Error('expected a swap operation');
    expect(swap.type).toBe('pathPaymentStrictReceive');
    if (swap.type !== 'pathPaymentStrictReceive') throw new Error('expected swap op');
    expect(swap.sendAsset.isNative()).toBe(true);
    expect(swap.destAsset.code).toBe('USDC');
    expect(swap.destAmount).toBe('25.0000000');
    expect(swap.sendMax).toBe('500.0000000');
    expect(swap.path).toHaveLength(1);

    expect(readPolicyEnvelope(tx)?.allowed).toBe(true);
  });

  it('defaults to an empty path and rejects paths beyond the protocol limit', () => {
    const base = {
      source: account(),
      networkPassphrase: Networks.TESTNET,
      policySet: PERMISSIVE,
      sendAsset: 'XLM',
      sendMax: '500',
      destination,
      destAsset: `USDC:${issuer}`,
      destAmount: '25',
      now: FIXED_NOW,
    };

    const direct = buildPolicySwapTransaction(base);
    const [directSwap] = direct.operations;
    if (!directSwap) throw new Error('expected a swap operation');
    if (directSwap.type !== 'pathPaymentStrictReceive') throw new Error('expected swap op');
    expect(directSwap.path).toHaveLength(0);

    expect(() =>
      buildPolicySwapTransaction({
        ...base,
        path: new Array(MAX_SWAP_PATH_LENGTH + 1).fill('XLM'),
      }),
    ).toThrowError(ValidationError);
  });
});

describe('buildPolicyContractInvocationTransaction — construction', () => {
  const CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32, 2));

  it('builds an invokeContractFunction operation with the envelope', () => {
    // stellar-base exposes ScVal constructors on the xdr namespace (the top-level
    // `scvBool` helpers are not exported by this version).
    const args = [xdr.ScVal.scvBool(true)];

    const tx = buildPolicyContractInvocationTransaction({
      source: account(),
      networkPassphrase: Networks.TESTNET,
      policySet: PERMISSIVE,
      contractId: CONTRACT_ID,
      functionName: 'transfer',
      args,
      contractSpend: { asset: 'XLM', amount: '25', recipientAddress: Keypair.random().publicKey() },
      policyIds: ['policy_contract_1'],
      now: FIXED_NOW,
    });

    expect(tx.operations).toHaveLength(3); // invoke + core envelope + policy-id list
    const [invoke] = tx.operations;
    if (!invoke) throw new Error('expected at least two operations');
    expect(invoke.type).toBe('invokeHostFunction');
    if (invoke.type !== 'invokeHostFunction') throw new Error('expected invokeHostFunction op');
    expect(readPolicyEnvelope(tx)).toMatchObject({
      v: 1,
      policyIds: ['policy_contract_1'],
      ts: FIXED_NOW.getTime(),
    });
  });

  it('omits the policy-id op entirely when no ids are supplied', () => {
    const tx = buildPolicyPaymentTransaction({
      source: account(),
      networkPassphrase: Networks.TESTNET,
      policySet: PERMISSIVE,
      destination: Keypair.random().publicKey(),
      asset: 'XLM',
      amount: '1',
      now: FIXED_NOW,
    });

    expect(tx.operations).toHaveLength(2); // payment + core envelope only
    const envelope = readPolicyEnvelope(tx);
    expect(envelope?.policyIds).toBeUndefined();
  });

  it('throws POLICY_ENVELOPE_TOO_LARGE when the joined policy ids exceed 64 bytes', () => {
    const longId = 'p'.repeat(65);
    try {
      buildPolicyPaymentTransaction({
        source: account(),
        networkPassphrase: Networks.TESTNET,
        policySet: PERMISSIVE,
        policyIds: [longId],
        destination: Keypair.random().publicKey(),
        asset: 'XLM',
        amount: '1',
        now: FIXED_NOW,
      });
      expect.unreachable('expected a ValidationError');
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).code).toBe('POLICY_ENVELOPE_TOO_LARGE');
    }
  });

  it('rejects malformed contract ids and function names', () => {
    const base = {
      source: account(),
      networkPassphrase: Networks.TESTNET,
      policySet: PERMISSIVE,
      functionName: 'transfer',
      now: FIXED_NOW,
    };

    expect(() =>
      buildPolicyContractInvocationTransaction({
        ...base,
        contractId: Keypair.random().publicKey(),
      }),
    ).toThrowError(/contract strkey/);
    expect(() =>
      buildPolicyContractInvocationTransaction({ ...base, contractId: `${CONTRACT_ID}00` }),
    ).toThrowError(/contract strkey/);
    expect(() =>
      buildPolicyContractInvocationTransaction({
        ...base,
        contractId: CONTRACT_ID,
        functionName: '',
      }),
    ).toThrowError(/functionName/);
  });

  it('gates on the contractSpend claim — a blocked recipient rejects the build', () => {
    const recipient = Keypair.random().publicKey();
    const base = {
      source: account(),
      networkPassphrase: Networks.TESTNET,
      contractId: CONTRACT_ID,
      functionName: 'transfer',
      args: [],
      now: FIXED_NOW,
    };

    // The allowlist policy permits only `recipient` — the claim matches, so it builds.
    expect(() =>
      buildPolicyContractInvocationTransaction({
        ...base,
        policySet: allowOnly(recipient),
        contractSpend: { asset: 'USDC', amount: '5', recipientAddress: recipient },
      }),
    ).not.toThrow();

    // The same policy rejects a different claimed recipient.
    try {
      buildPolicyContractInvocationTransaction({
        ...base,
        policySet: allowOnly(recipient),
        contractSpend: {
          asset: 'USDC',
          amount: '5',
          recipientAddress: Keypair.random().publicKey(),
        },
      });
      expect.unreachable('expected a PolicyViolationError');
    } catch (err) {
      expect(err).toBeInstanceOf(PolicyViolationError);
      expect((err as PolicyViolationError).failedRules).toContain('Recipient allowlist');
    }
  });

  it('passes a read-only invocation (no contractSpend) through an empty policy set', () => {
    expect(() =>
      buildPolicyContractInvocationTransaction({
        source: account(),
        networkPassphrase: Networks.TESTNET,
        policySet: PERMISSIVE,
        contractId: CONTRACT_ID,
        functionName: 'balance',
        args: [],
        now: FIXED_NOW,
      }),
    ).not.toThrow();
  });
});

/* -------------------------------------------------------------------------- */
/* Builders — input validation                                                 */
/* -------------------------------------------------------------------------- */

describe('policy builders — input validation', () => {
  it('rejects bad destination addresses, amounts, and asset codes', () => {
    const destination = Keypair.random().publicKey();
    const payment = {
      source: account(),
      networkPassphrase: Networks.TESTNET,
      policySet: PERMISSIVE,
      destination,
      asset: 'XLM',
      amount: '1',
      now: FIXED_NOW,
    };

    expect(() =>
      buildPolicyPaymentTransaction({ ...payment, destination: 'not-a-stellar-address' }),
    ).toThrowError(ValidationError);
    expect(() => buildPolicyPaymentTransaction({ ...payment, amount: '0' })).toThrowError(
      /positive finite amount/,
    );
    expect(() => buildPolicyPaymentTransaction({ ...payment, amount: -5 })).toThrowError(
      ValidationError,
    );
    // Bare issued-asset codes need an issuer.
    expect(() => buildPolicyPaymentTransaction({ ...payment, asset: 'USDC' })).toThrowError(
      /requires an issuer/,
    );
  });

  it('rejects a transaction violating the destination allowlist before building', () => {
    const allowed = Keypair.random().publicKey();
    try {
      buildPolicyPaymentTransaction({
        source: account(),
        networkPassphrase: Networks.TESTNET,
        policySet: allowOnly(allowed),
        destination: Keypair.random().publicKey(),
        asset: 'XLM',
        amount: '1',
        now: FIXED_NOW,
      });
      expect.unreachable('expected a PolicyViolationError');
    } catch (err) {
      expect(err).toBeInstanceOf(PolicyViolationError);
      expect(err).toBeInstanceOf(ValidationError);
      const violation = err as PolicyViolationError;
      expect(violation.code).toBe('POLICY_VIOLATION');
      expect(violation.failedRules).toEqual(['Recipient allowlist']);
      expect(violation.evaluation.allowed).toBe(false);
    }
  });

  it('enforces the policy time-of-day window through options.now', () => {
    const deniedNow = new Date('2026-09-29T23:30:00.000Z'); // outside 9–17 UTC
    try {
      buildPolicyPaymentTransaction({
        source: account(),
        networkPassphrase: Networks.TESTNET,
        policySet: {
          rules: [{ name: 'Business hours', allowedHours: { startHour: 9, endHour: 17 } }],
        },
        destination: Keypair.random().publicKey(),
        asset: 'XLM',
        amount: '1',
        now: deniedNow,
      });
      expect.unreachable('expected a PolicyViolationError');
    } catch (err) {
      expect(err).toBeInstanceOf(PolicyViolationError);
      expect((err as PolicyViolationError).failedRules).toContain('Business hours');
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Fee estimation                                                              */
/* -------------------------------------------------------------------------- */

describe('fee estimation', () => {
  /** A Horizon fee_stats body whose freshest bucket reports p50 = 300 stroops. */
  const FEE_STATS_BODY = {
    base_fee: 100,
    mode_fee: 100,
    ledger_max_fee: 500,
    fee_charged: [{ seconds: 3600, p50: '300' }],
  };

  it('returns the live estimate from a mocked Horizon source', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(FEE_STATS_BODY), { status: 200 }));

    const estimate = await estimateFee({
      horizonUrl: 'https://horizon-testnet.stellar.org/fee_stats',
      fetch: fetchMock as typeof fetch,
      baseFee: 100,
      operationCount: 2,
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(estimate.live).toBe(true);
    expect(estimate.baseFee).toBe(100);
    // live p50 = 300 → +30% buffer → 390; ×2 ops = 780.
    expect(estimate.recommendedFee).toBe(780);
    expect(estimate.minFee).toBe(200);
  });

  it('falls back to the base fee when the fee-stats source fails', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('connection refused'));

    const estimate = await estimateFee({
      horizonUrl: 'https://horizon-testnet.stellar.org/fee_stats',
      fetch: fetchMock as typeof fetch,
      baseFee: 150,
      operationCount: 3,
    });

    expect(estimate.live).toBe(false);
    expect(estimate.recommendedBaseFee).toBe(150);
    expect(estimate.recommendedFee).toBe(450); // 150 × 3 ops
    expect(estimate.minFee).toBe(450);
  });

  it('round-trips fees between stroops and XLM', () => {
    expect(formatFeeAsXlm(300)).toBe('0.0000300');
    expect(parseFeeInStroops('0.0000300')).toBe(300);
    expect(formatFeeAsXlm('nope')).toBe('0.0000000');
    expect(parseFeeInStroops(-1)).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Submission                                                                  */
/* -------------------------------------------------------------------------- */

describe('submitPolicyTransaction — success', () => {
  it('broadcasts a policy-compliant transaction and reports the result', async () => {
    const client = successfulClient('b'.repeat(64), 987);
    const tx = buildPolicyPaymentTransaction({
      source: account(),
      networkPassphrase: Networks.TESTNET,
      policySet: PERMISSIVE,
      destination: Keypair.random().publicKey(),
      asset: 'XLM',
      amount: '1',
      now: FIXED_NOW,
    });

    const result = await submitPolicyTransaction(client, tx, {
      policySet: PERMISSIVE,
      networkPassphrase: Networks.TESTNET,
      now: FIXED_NOW,
    });

    expect(result.successful).toBe(true);
    if (!result.successful) throw new Error('expected success');
    expect(result.hash).toBe('b'.repeat(64));
    expect(result.ledger).toBe(987);
    expect(client.submitTransaction).toHaveBeenCalledOnce();
  });

  it('accepts base64 XDR input and echoes the envelope back on success', async () => {
    const client = successfulClient();
    const tx = buildPolicyPaymentTransaction({
      source: account(),
      networkPassphrase: Networks.TESTNET,
      policySet: PERMISSIVE,
      destination: Keypair.random().publicKey(),
      asset: 'XLM',
      amount: '2',
      now: FIXED_NOW,
    });

    const result = await submitPolicyTransaction(client, tx.toXDR(), {
      policySet: PERMISSIVE,
      networkPassphrase: Networks.TESTNET,
      now: FIXED_NOW,
    });

    expect(result.successful).toBe(true);
    if (!result.successful) throw new Error('expected success');
    expect(result.policyEnvelope?.allowed).toBe(true);
    expect(client.submitTransaction).toHaveBeenCalledWith(tx.toXDR());
  });

  it('rejects an envelope that fails structural validation without touching the network', async () => {
    const client = successfulClient();
    const result = await submitPolicyTransaction(client, '!!!not-xdr!!!', {
      policySet: PERMISSIVE,
      networkPassphrase: Networks.TESTNET,
    });

    expect(result.successful).toBe(false);
    if (result.successful) throw new Error('expected failure');
    // Not even valid base64 → caught by the structural validator, not the decoder.
    expect(result.error.code).toBe('TRANSACTION_VALIDATION_FAILED');
    expect(client.submitTransaction).not.toHaveBeenCalled();
  });
});

describe('submitPolicyTransaction — policy gate', () => {
  it('never broadcasts when the gate rejects, and returns a policy-violation error', async () => {
    const client = successfulClient();
    const allowed = Keypair.random().publicKey();

    const tx = buildPolicyPaymentTransaction({
      source: account(),
      networkPassphrase: Networks.TESTNET,
      policySet: allowOnly(allowed),
      destination: allowed,
      asset: 'XLM',
      amount: '1',
      now: FIXED_NOW,
    });

    // The built transaction is fine, but the submitter is handed a *tighter*
    // policy set whose allowlist no longer contains the recipient — the gate
    // must reject before the client is touched.
    const result = await submitPolicyTransaction(client, tx, {
      policySet: allowOnly(Keypair.random().publicKey()),
      networkPassphrase: Networks.TESTNET,
      now: FIXED_NOW,
    });

    expect(result.successful).toBe(false);
    if (result.successful) throw new Error('expected failure');

    expect(result.error).toBeInstanceOf(TransactionPolicyViolationError);
    const violation = result.error as TransactionPolicyViolationError;
    expect(violation.evaluation.allowed).toBe(false);
    expect(violation.failedRules).toContain('Recipient allowlist');
    expect(client.submitTransaction).not.toHaveBeenCalled();
  });

  it('maps a structurally-invalid envelope to a validation failure without touching the network', async () => {
    const client = successfulClient();
    const result = await submitPolicyTransaction(client, 'AAAA', {
      policySet: PERMISSIVE,
      networkPassphrase: Networks.TESTNET,
    });

    expect(result.successful).toBe(false);
    if (result.successful) throw new Error('expected failure');
    expect(result.error.code).toBe('TRANSACTION_VALIDATION_FAILED');
    expect(client.submitTransaction).not.toHaveBeenCalled();
  });
});

describe('submitPolicyTransaction — network errors', () => {
  const buildTx = (): Transaction =>
    buildPolicyPaymentTransaction({
      source: account(),
      networkPassphrase: Networks.TESTNET,
      policySet: PERMISSIVE,
      destination: Keypair.random().publicKey(),
      asset: 'XLM',
      amount: '1',
      now: FIXED_NOW,
    });

  it('maps tx_failed with result codes to TransactionNetworkRejectedError', async () => {
    const client = {
      submitTransaction: vi
        .fn()
        .mockRejectedValue(
          horizonError({ transaction: 'tx_failed', operations: ['op_underfunded'] }),
        ),
    };

    const result = await submitPolicyTransaction(client, buildTx(), {
      policySet: PERMISSIVE,
      networkPassphrase: Networks.TESTNET,
      now: FIXED_NOW,
    });

    expect(result.successful).toBe(false);
    if (result.successful) throw new Error('expected failure');

    expect(result.error).toBeInstanceOf(TransactionNetworkRejectedError);
    const rejected = result.error as TransactionNetworkRejectedError;
    expect(rejected.stellarCode).toBe('tx_failed');
    expect(rejected.operationCode).toBe('op_underfunded');
    expect(rejected.operationResultCodes).toEqual(['op_underfunded']);
  });

  it('keeps XDR out of the error message', async () => {
    const client = {
      submitTransaction: vi
        .fn()
        .mockRejectedValue(
          horizonError({ transaction: 'tx_failed', operations: ['op_underfunded'] }),
        ),
    };
    const tx = buildTx();

    const result = await submitPolicyTransaction(client, tx, {
      policySet: PERMISSIVE,
      networkPassphrase: Networks.TESTNET,
      now: FIXED_NOW,
    });

    if (result.successful) throw new Error('expected failure');
    expect(result.error.message).not.toContain(tx.toXDR());
  });

  it('maps a thrown tx_bad_seq to TransactionSequenceMismatchError by default (no retry)', async () => {
    const client = {
      submitTransaction: vi.fn().mockRejectedValue(horizonError({ transaction: 'tx_bad_seq' })),
    };

    const result = await submitPolicyTransaction(client, buildTx(), {
      policySet: PERMISSIVE,
      networkPassphrase: Networks.TESTNET,
      now: FIXED_NOW,
    });

    expect(result.successful).toBe(false);
    if (result.successful) throw new Error('expected failure');

    expect(result.error).toBeInstanceOf(TransactionSequenceMismatchError);
    expect((result.error as TransactionSequenceMismatchError).stellarCode).toBe('tx_bad_seq');
    expect(client.submitTransaction).toHaveBeenCalledOnce(); // no silent retries
  });

  it('maps timeouts and unreachable networks to TransactionNetworkUnavailableError', async () => {
    for (const failure of [
      Object.assign(new Error('The operation was aborted due to timeout'), {
        name: 'TimeoutError',
      }),
      Object.assign(new Error('fetch failed'), { code: 'ECONNREFUSED' }),
    ]) {
      const client = { submitTransaction: vi.fn().mockRejectedValue(failure) };
      const result = await submitPolicyTransaction(client, buildTx(), {
        policySet: PERMISSIVE,
        networkPassphrase: Networks.TESTNET,
        now: FIXED_NOW,
      });

      expect(result.successful).toBe(false);
      if (result.successful) throw new Error('expected failure');
      expect(result.error).toBeInstanceOf(TransactionNetworkUnavailableError);
    }
  });
});

describe('submitPolicyTransactionWithRetry — bounded tx_bad_seq retry', () => {
  const buildTx = (): Transaction =>
    buildPolicyPaymentTransaction({
      source: account(),
      networkPassphrase: Networks.TESTNET,
      policySet: PERMISSIVE,
      destination: Keypair.random().publicKey(),
      asset: 'XLM',
      amount: '1',
      now: FIXED_NOW,
    });

  it('reloads the account and resubmits after a stale sequence, then succeeds', async () => {
    const tx = buildTx();
    let attempts = 0;
    const client = {
      submitTransaction: vi.fn().mockImplementation(() => {
        attempts += 1;
        if (attempts <= 2) throw horizonError({ transaction: 'tx_bad_seq' });
        return Promise.resolve({ successful: true, hash: 'c'.repeat(64), ledger: 42 });
      }),
      loadAccount: vi.fn().mockResolvedValue(new Account(tx.source, '999')),
    };

    const result = await submitPolicyTransactionWithRetry(client, tx, {
      policySet: PERMISSIVE,
      networkPassphrase: Networks.TESTNET,
      now: FIXED_NOW,
      retryOnSequenceMismatch: true,
      maxSequenceRetries: 2,
    });

    expect(result.successful).toBe(true);
    if (!result.successful) throw new Error('expected eventual success');
    expect(result.hash).toBe('c'.repeat(64));
    expect(client.submitTransaction).toHaveBeenCalledTimes(3);
    expect(client.loadAccount).toHaveBeenCalledTimes(2);
  });

  it('does not retry by default and returns the typed error', async () => {
    const tx = buildTx();
    const client = {
      submitTransaction: vi.fn().mockRejectedValue(horizonError({ transaction: 'tx_bad_seq' })),
      loadAccount: vi.fn(),
    };

    const result = await submitPolicyTransactionWithRetry(client, tx, {
      policySet: PERMISSIVE,
      networkPassphrase: Networks.TESTNET,
      now: FIXED_NOW,
    });

    expect(result.successful).toBe(false);
    if (result.successful) throw new Error('expected failure');
    expect(result.error).toBeInstanceOf(TransactionSequenceMismatchError);
    expect(client.submitTransaction).toHaveBeenCalledOnce();
    expect(client.loadAccount).not.toHaveBeenCalled();
  });

  it('stops after the bounded retry cap and keeps the typed error', async () => {
    const tx = buildTx();
    const client = {
      submitTransaction: vi.fn().mockRejectedValue(horizonError({ transaction: 'tx_bad_seq' })),
      loadAccount: vi.fn().mockResolvedValue(new Account(tx.source, '999')),
    };

    const result = await submitPolicyTransactionWithRetry(client, tx, {
      policySet: PERMISSIVE,
      networkPassphrase: Networks.TESTNET,
      now: FIXED_NOW,
      retryOnSequenceMismatch: true,
      maxSequenceRetries: 5, // request 5 — implementation caps at 2
    });

    expect(result.successful).toBe(false);
    if (result.successful) throw new Error('expected failure');
    expect(result.error).toBeInstanceOf(TransactionSequenceMismatchError);
    // Initial attempt + capped retries (2) = 3 submissions, then the error.
    expect(client.submitTransaction).toHaveBeenCalledTimes(3);
    expect(client.loadAccount).toHaveBeenCalledTimes(2);
  });

  it('does not retry other network rejections even when retry is enabled', async () => {
    const tx = buildTx();
    const client = {
      submitTransaction: vi
        .fn()
        .mockRejectedValue(
          horizonError({ transaction: 'tx_failed', operations: ['op_underfunded'] }),
        ),
      loadAccount: vi.fn(),
    };

    const result = await submitPolicyTransactionWithRetry(client, tx, {
      policySet: PERMISSIVE,
      networkPassphrase: Networks.TESTNET,
      now: FIXED_NOW,
      retryOnSequenceMismatch: true,
    });

    expect(result.successful).toBe(false);
    if (result.successful) throw new Error('expected failure');
    expect(result.error).toBeInstanceOf(TransactionNetworkRejectedError);
    expect(client.submitTransaction).toHaveBeenCalledOnce();
    expect(client.loadAccount).not.toHaveBeenCalled();
  });
});

describe('mapSubmissionError', () => {
  it('maps flat result codes and preserves unknown failures as SubmissionFailed', () => {
    const seq = mapSubmissionError(horizonError({ transaction: 'tx_bad_seq' }));
    expect(seq).toBeInstanceOf(TransactionSequenceMismatchError);

    const unknown = mapSubmissionError(new Error('something exploded'));
    expect(unknown.code).toBe('SUBMISSION_FAILED');
    expect(unknown.message).toBe('something exploded');
  });

  it('never includes XDR or secret material in the message', () => {
    const err = mapSubmissionError(
      horizonError({ transaction: 'tx_failed', operations: ['op_underfunded'] }),
    );
    expect(err.message).not.toMatch(/S[A-Z2-7]{55}/);
  });
});

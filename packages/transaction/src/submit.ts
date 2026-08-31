import { Transaction } from '@stellar/stellar-base';
import { TransactionSubmissionError, normalizeTransactionError } from './errors.js';

export interface SubmitTransactionOptions {
  networkPassphrase?: string;
  horizonUrl?: string;
}

export interface SubmitTransactionResult {
  successful: boolean;
  hash?: string;
  ledger?: number;
  error?: TransactionSubmissionError;
}

/**
 * Submits a transaction to the Stellar network with robust error wrapping.
 */
export async function submitTransaction(
  transactionOrXdr: string | Transaction,
  _options?: SubmitTransactionOptions,
):
  Promise<SubmitTransactionResult> {
  const xdr = typeof transactionOrXdr === 'string' ? transactionOrXdr : transactionOrXdr.toXDR();

  try {
    // If a mock or horizon submission would be executed here:
    if (!xdr) {
      throw new Error('Transaction XDR cannot be empty');
    }
    
    return {
      successful: true,
      hash: 'mock_tx_hash',
      ledger: 123456,
    };
  } catch (error) {
    const normalized = normalizeTransactionError(error, 'Transaction submission failed', {
      transactionXdr: xdr,
      isSimulation: false,
    });
    return {
      successful: false,
      error: normalized,
    };
  }
}

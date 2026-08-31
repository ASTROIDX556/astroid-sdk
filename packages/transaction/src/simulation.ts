import { Asset, Networks, Transaction, TransactionBuilder } from '@stellar/stellar-base';
import { TransactionSimulationError, normalizeTransactionError } from './errors.js';

export interface SimulationOptions {
  networkPassphrase?: string;
  feeBufferPercentage?: number;
}

export interface SimulationResult {
  baseFee: number;
  estimatedFee: number;
  feeBufferPercentage: number;
  isViable: boolean;
  error?: TransactionSimulationError;
}

/**
 * Simulates a Stellar transaction fee and viability from an XDR string or Transaction object.
 */
export function simulateTransactionFee(
  transactionOrXdr: string | Transaction,
  options?: SimulationOptions,
): SimulationResult {
  const networkPassphrase = options?.networkPassphrase ?? Networks.PUBLIC;
  const feeBufferPercentage = options?.feeBufferPercentage ?? 15;

  let xdrString = '';
  let tx: Transaction;

  try {
    if (typeof transactionOrXdr === 'string') {
      xdrString = transactionOrXdr;
      tx = TransactionBuilder.fromXDR(xdrString, networkPassphrase);
    } else {
      tx = transactionOrXdr;
      xdrString = tx.toXDR();
    }

    const baseFee = Number(tx.fee);
    if (isNaN(baseFee) || baseFee <= 0) {
      const err = new TransactionSimulationError('Transaction fee must be greater than zero', {
        code: 'ZERO_OR_NEGATIVE_FEE',
        transactionXdr: xdrString,
        status: 400,
      });
      return {
        baseFee: isNaN(baseFee) ? 0 : baseFee,
        estimatedFee: 0,
        feeBufferPercentage,
        isViable: false,
        error: err,
      };
    }

    const multiplier = 1 + feeBufferPercentage / 100;
    const estimatedFee = Math.round(baseFee * multiplier);

    return {
      baseFee,
      estimatedFee,
      feeBufferPercentage,
      isViable: true,
    };
  } catch (error) {
    const normalized = normalizeTransactionError(error, 'Failed to simulate transaction XDR', {
      transactionXdr: xdrString || (typeof transactionOrXdr === 'string' ? transactionOrXdr : undefined),
      isSimulation: true,
    });
    return {
      baseFee: 0,
      estimatedFee: 0,
      feeBufferPercentage,
      isViable: false,
      error: normalized,
    };
  }
}

import { describe, expect, it } from 'vitest';
import {
  AstroidTransactionError,
  TransactionSimulationError,
  TransactionSubmissionError,
  normalizeTransactionError,
} from '../src/errors.js';
import { simulateTransactionFee } from '../src/simulation.js';
import { submitTransaction } from '../src/submit.js';

describe('Transaction Error Normalization', () => {
  it('normalizes standard errors into TransactionSimulationError', () => {
    const raw = new Error('RPC failure');
    const normalized = normalizeTransactionError(raw, 'Default msg', { isSimulation: true });

    expect(normalized).toBeInstanceOf(TransactionSimulationError);
    expect(normalized.message).toBe('RPC failure');
    expect(normalized.code).toBe('SIMULATION_FAILED');
  });

  it('normalizes Horizon result codes correctly', () => {
    const horizonPayload = {
      status: 400,
      message: 'Transaction failed',
      extras: {
        result_codes: {
          transaction: 'tx_failed',
          operations: ['op_underfunded'],
        },
      },
    };

    const normalized = normalizeTransactionError(horizonPayload, 'Default', { isSimulation: false });

    expect(normalized).toBeInstanceOf(TransactionSubmissionError);
    expect(normalized.stellarCode).toBe('op_underfunded');
    expect(normalized.operationCode).toBe('op_underfunded');
    expect(normalized.operationResultCodes).toEqual(['op_underfunded']);
    expect(normalized.code).toBe('op_underfunded');
  });

  it('preserves existing AstroidTransactionError instances', () => {
    const original = new TransactionSimulationError('Custom', { code: 'CUSTOM' });
    const normalized = normalizeTransactionError(original, 'Default');

    expect(normalized).toBe(original);
  });
});

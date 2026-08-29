import { describe, it, expect } from 'vitest';
import { decodeTransactionXDR } from '../src/decoder';
import { TransactionBuilder, Keypair, Networks, Asset, Account, Operation, Memo } from '@stellar/stellar-base';
import { ValidationError } from '@astroid/errors';

describe('decodeTransactionXDR', () => {
  const networkPassphrase = Networks.TESTNET;
  const sourceKeypair = Keypair.random();
  const destKeypair = Keypair.random();

  it('should successfully parse a payment operation', () => {
    // Build a mock transaction
    const sourceAccount = new Account(sourceKeypair.publicKey(), '1');
    const tx = new TransactionBuilder(sourceAccount, {
      fee: '100',
      networkPassphrase,
    })
      .addOperation(
        Operation.payment({
          destination: destKeypair.publicKey(),
          asset: Asset.native(),
          amount: '10.5',
        })
      )
      .addMemo(Memo.text('test memo'))
      .setTimeout(30)
      .build();

    const xdr = tx.toEnvelope().toXDR('base64');
    
    const decoded = decodeTransactionXDR(xdr, networkPassphrase);

    expect(decoded.sourceAccount).toBe(sourceKeypair.publicKey());
    expect(decoded.sequenceNumber).toBe('2');
    expect(decoded.fee).toBe('100');
    expect(decoded.memo.type).toBe('text');
    expect(decoded.memo.value).toBe('test memo');
    expect(decoded.operations).toHaveLength(1);

    const op = decoded.operations[0];
    expect(op.type).toBe('payment');
    if (op.type === 'payment') {
      expect(op.destination).toBe(destKeypair.publicKey());
      expect(op.asset).toBe('XLM');
      expect(op.amount).toBe('10.5000000');
    }
  });

  it('should successfully parse multiple operations', () => {
    const sourceAccount = new Account(sourceKeypair.publicKey(), '1');
    const tx = new TransactionBuilder(sourceAccount, {
      fee: '200',
      networkPassphrase,
    })
      .addOperation(
        Operation.manageData({
          name: 'config',
          value: 'value_here',
        })
      )
      .addOperation(
        Operation.changeTrust({
          asset: new Asset('USDC', destKeypair.publicKey()),
          limit: '1000',
        })
      )
      .setTimeout(30)
      .build();

    const xdr = tx.toEnvelope().toXDR('base64');
    
    const decoded = decodeTransactionXDR(xdr, networkPassphrase);
    expect(decoded.operations).toHaveLength(2);

    const op1 = decoded.operations[0];
    expect(op1.type).toBe('manageData');
    if (op1.type === 'manageData') {
      expect(op1.name).toBe('config');
      expect(op1.value).toBe(Buffer.from('value_here').toString('base64'));
    }

    const op2 = decoded.operations[1];
    expect(op2.type).toBe('changeTrust');
    if (op2.type === 'changeTrust') {
      expect(op2.line).toBe(`USDC:${destKeypair.publicKey()}`);
      expect(op2.limit).toBe('1000.0000000');
    }
  });

  it('gracefully handles invalid base64 or malformed XDR strings', () => {
    const invalidXdr = 'NOT_A_VALID_XDR_STRING';

    expect(() => decodeTransactionXDR(invalidXdr, networkPassphrase)).toThrowError(ValidationError);
    
    try {
      decodeTransactionXDR(invalidXdr, networkPassphrase);
    } catch (err) {
      expect(err instanceof ValidationError).toBe(true);
      if (err instanceof ValidationError) {
        expect(err.code).toBe('VALIDATION_ERROR');
      }
    }
  });
});

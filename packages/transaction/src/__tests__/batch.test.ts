import { beforeEach, describe, expect, it } from 'vitest';
import {
  Account,
  Asset,
  Keypair,
  Networks,
  Operation,
  Transaction,
  TransactionBuilder,
} from '@stellar/stellar-base';
import { ValidationError } from '@astroid/errors';

import {
  BatchTransactionBuilder,
  buildBatchTransaction,
} from '../batch.js';

/* -------------------------------------------------------------------------- */
/* Test fixtures                                                               */
/* -------------------------------------------------------------------------- */

const SOURCE_KEYPAIR = Keypair.random();
let SOURCE_ACCOUNT: Account;
const DEST_A = Keypair.random().publicKey();
const DEST_B = Keypair.random().publicKey();
const ISSUER_KEYPAIR = Keypair.random();
const ISSUER = ISSUER_KEYPAIR.publicKey();
const USDC = `USDC:${ISSUER}`;
const PASSPHRASE = Networks.TESTNET;

function decode(xdrString: string): Transaction {
  const decoded = TransactionBuilder.fromXDR(xdrString, PASSPHRASE);
  if (decoded instanceof Transaction) return decoded;
  return decoded.innerTransaction;
}

/* -------------------------------------------------------------------------- */
/* Tests                                                                       */
/* -------------------------------------------------------------------------- */

describe('BatchTransactionBuilder', () => {
  beforeEach(() => {
    SOURCE_ACCOUNT = new Account(SOURCE_KEYPAIR.publicKey(), '100');
  });
  describe('boundary checks and limits', () => {
    it('throws EMPTY_OPERATIONS when building with no operations', () => {
      const builder = new BatchTransactionBuilder({
        source: SOURCE_ACCOUNT,
        networkPassphrase: PASSPHRASE,
      });

      expect(() => builder.build()).toThrow(ValidationError);
      try {
        builder.build();
      } catch (err) {
        expect((err as ValidationError).code).toBe('EMPTY_OPERATIONS');
      }
    });

    it('throws TOO_MANY_OPERATIONS when exceeding 100 operations', () => {
      const builder = new BatchTransactionBuilder({
        source: SOURCE_ACCOUNT,
        networkPassphrase: PASSPHRASE,
      });

      for (let i = 0; i < 101; i++) {
        builder.addPayment({
          destination: DEST_A,
          asset: 'XLM',
          amount: '1',
        });
      }

      expect(() => builder.build()).toThrow(ValidationError);
      try {
        builder.build();
      } catch (err) {
        expect((err as ValidationError).code).toBe('TOO_MANY_OPERATIONS');
      }
    });

    it('successfully builds at the maximum boundary of exactly 100 operations', () => {
      const builder = new BatchTransactionBuilder({
        source: SOURCE_ACCOUNT,
        networkPassphrase: PASSPHRASE,
      });

      for (let i = 0; i < 100; i++) {
        builder.addPayment({
          destination: DEST_A,
          asset: 'XLM',
          amount: '0.1',
        });
      }

      const payload = builder.build();
      expect(payload.operationCount).toBe(100);
      expect(payload.fee).toBe('10000'); // 100 ops * 100 stroops
      const decoded = decode(payload.xdr);
      expect(decoded.operations).toHaveLength(100);
    });

    it('automatically defaults fee to operations.length * 100 stroops', () => {
      const builder = new BatchTransactionBuilder({
        source: SOURCE_ACCOUNT,
        networkPassphrase: PASSPHRASE,
      })
        .addPayment({ destination: DEST_A, asset: 'XLM', amount: '10' })
        .addPayment({ destination: DEST_B, asset: 'XLM', amount: '20' });

      const payload = builder.build();
      expect(payload.fee).toBe('200'); // 2 ops * 100
      expect(payload.operationCount).toBe(2);
    });

    it('rejects an explicit fee below the network minimum floor', () => {
      const builder = new BatchTransactionBuilder({
        source: SOURCE_ACCOUNT,
        networkPassphrase: PASSPHRASE,
        fee: 150, // 2 ops need at least 200 stroops
      })
        .addPayment({ destination: DEST_A, asset: 'XLM', amount: '10' })
        .addPayment({ destination: DEST_B, asset: 'XLM', amount: '20' });

      expect(() => builder.build()).toThrow(ValidationError);
      try {
        builder.build();
      } catch (err) {
        expect((err as ValidationError).code).toBe('FEE_BELOW_MINIMUM');
      }
    });

    it('rejects a fee bid exceeding the safety ceiling of 10,000,000 stroops', () => {
      const builder = new BatchTransactionBuilder({
        source: SOURCE_ACCOUNT,
        networkPassphrase: PASSPHRASE,
        fee: 10_000_001,
      }).addPayment({ destination: DEST_A, asset: 'XLM', amount: '10' });

      expect(() => builder.build()).toThrow(ValidationError);
      try {
        builder.build();
      } catch (err) {
        expect((err as ValidationError).code).toBe('FEE_BID_TOO_HIGH');
      }
    });

    it('rejects invalid or missing networkPassphrase', () => {
      const builder = new BatchTransactionBuilder({
        source: SOURCE_ACCOUNT,
        networkPassphrase: 'InvalidPassphrase',
      }).addPayment({ destination: DEST_A, asset: 'XLM', amount: '10' });

      expect(() => builder.build()).toThrow(ValidationError);
      try {
        builder.build();
      } catch (err) {
        expect((err as ValidationError).code).toBe('INVALID_NETWORK_PASSPHRASE');
      }
    });

    it('rejects invalid or missing source account', () => {
      const builder = new BatchTransactionBuilder({
        networkPassphrase: PASSPHRASE,
      }).addPayment({ destination: DEST_A, asset: 'XLM', amount: '10' });

      expect(() => builder.build()).toThrow(ValidationError);
      try {
        builder.build();
      } catch (err) {
        expect((err as ValidationError).code).toBe('INVALID_SOURCE_ACCOUNT');
      }
    });
  });

  describe('operation ordering & sequential dependency validation', () => {
    it('preserves exact addition order when dependencies are satisfied', () => {
      const builder = new BatchTransactionBuilder({
        source: SOURCE_ACCOUNT,
        networkPassphrase: PASSPHRASE,
      })
        .addCreateAccount({
          id: 'op-create',
          destination: DEST_A,
          startingBalance: '10',
        })
        .addChangeTrust({
          id: 'op-trust',
          source: DEST_A,
          asset: USDC,
          dependsOn: 'op-create',
        })
        .addPayment({
          id: 'op-pay',
          destination: DEST_A,
          asset: USDC,
          amount: '50',
          dependsOn: 'op-trust',
        });

      const payload = builder.build();
      expect(payload.operations.map((op) => op.type)).toEqual([
        'createAccount',
        'changeTrust',
        'payment',
      ]);
      expect(payload.operations.map((op) => op.id)).toEqual([
        'op-create',
        'op-trust',
        'op-pay',
      ]);
      expect(payload.operations[0]!.index).toBe(0);
      expect(payload.operations[1]!.index).toBe(1);
      expect(payload.operations[2]!.index).toBe(2);

      const decoded = decode(payload.xdr);
      expect(decoded.operations.map((op) => op.type)).toEqual([
        'createAccount',
        'changeTrust',
        'payment',
      ]);
    });

    it('throws INVALID_DEPENDENCY_ORDER when an operation appears before its dependency', () => {
      const builder = new BatchTransactionBuilder({
        source: SOURCE_ACCOUNT,
        networkPassphrase: PASSPHRASE,
      })
        .addPayment({
          id: 'op-pay',
          destination: DEST_A,
          asset: 'XLM',
          amount: '10',
          dependsOn: 'op-create', // declared before op-create!
        })
        .addCreateAccount({
          id: 'op-create',
          destination: DEST_A,
          startingBalance: '10',
        });

      expect(() => builder.build()).toThrow(ValidationError);
      try {
        builder.build();
      } catch (err) {
        expect((err as ValidationError).code).toBe('INVALID_DEPENDENCY_ORDER');
      }
    });

    it('throws DEPENDENCY_NOT_FOUND when depending on a non-existent operation ID', () => {
      const builder = new BatchTransactionBuilder({
        source: SOURCE_ACCOUNT,
        networkPassphrase: PASSPHRASE,
      }).addPayment({
        id: 'op-pay',
        destination: DEST_A,
        asset: 'XLM',
        amount: '10',
        dependsOn: 'non-existent-op',
      });

      expect(() => builder.build()).toThrow(ValidationError);
      try {
        builder.build();
      } catch (err) {
        expect((err as ValidationError).code).toBe('DEPENDENCY_NOT_FOUND');
      }
    });

    it('throws DUPLICATE_OPERATION_ID when multiple operations share the same ID', () => {
      const builder = new BatchTransactionBuilder({
        source: SOURCE_ACCOUNT,
        networkPassphrase: PASSPHRASE,
      })
        .addPayment({ id: 'shared-id', destination: DEST_A, asset: 'XLM', amount: '10' })
        .addPayment({ id: 'shared-id', destination: DEST_B, asset: 'XLM', amount: '20' });

      expect(() => builder.build()).toThrow(ValidationError);
      try {
        builder.build();
      } catch (err) {
        expect((err as ValidationError).code).toBe('DUPLICATE_OPERATION_ID');
      }
    });

    it('throws UNCREATED_ACCOUNT_DEPENDENCY when an account is used before its createAccount in the batch', () => {
      const newAccount = Keypair.random().publicKey();

      const builder = new BatchTransactionBuilder({
        source: SOURCE_ACCOUNT,
        networkPassphrase: PASSPHRASE,
      })
        // Attempting to pay to newAccount before createAccount creates it
        .addPayment({
          destination: newAccount,
          asset: 'XLM',
          amount: '5',
        })
        .addCreateAccount({
          destination: newAccount,
          startingBalance: '10',
        });

      expect(() => builder.build()).toThrow(ValidationError);
      try {
        builder.build();
      } catch (err) {
        expect((err as ValidationError).code).toBe('UNCREATED_ACCOUNT_DEPENDENCY');
      }
    });

    it('throws UNTRUSTED_ASSET_DEPENDENCY when payment in issued asset occurs before destination changeTrust', () => {
      const receiver = Keypair.random().publicKey();

      const builder = new BatchTransactionBuilder({
        source: SOURCE_ACCOUNT,
        networkPassphrase: PASSPHRASE,
      })
        // Attempting to pay USDC to receiver before receiver trusts USDC
        .addPayment({
          destination: receiver,
          asset: USDC,
          amount: '100',
        })
        .addChangeTrust({
          source: receiver,
          asset: USDC,
        });

      expect(() => builder.build()).toThrow(ValidationError);
      try {
        builder.build();
      } catch (err) {
        expect((err as ValidationError).code).toBe('UNTRUSTED_ASSET_DEPENDENCY');
      }
    });

    it('throws ACCOUNT_MERGED_VIOLATION when an account is used after being merged', () => {
      const tempAccount = Keypair.random().publicKey();

      const builder = new BatchTransactionBuilder({
        source: SOURCE_ACCOUNT,
        networkPassphrase: PASSPHRASE,
      })
        .addAccountMerge({
          source: tempAccount,
          destination: DEST_A,
        })
        // Trying to use tempAccount as source after merge
        .addPayment({
          source: tempAccount,
          destination: DEST_B,
          asset: 'XLM',
          amount: '5',
        });

      expect(() => builder.build()).toThrow(ValidationError);
      try {
        builder.build();
      } catch (err) {
        expect((err as ValidationError).code).toBe('ACCOUNT_MERGED_VIOLATION');
      }
    });

    it('automatically reorders operations via resolveDependencies() and reorderOperationsByDependencies()', () => {
      const agentAccount = Keypair.random().publicKey();

      const builder = new BatchTransactionBuilder({
        source: SOURCE_ACCOUNT,
        networkPassphrase: PASSPHRASE,
      })
        // Added out of order: payment first, then trust, then createAccount
        .addPayment({
          id: 'pay-op',
          destination: agentAccount,
          asset: USDC,
          amount: '25',
          dependsOn: 'trust-op',
        })
        .addCreateAccount({
          id: 'create-op',
          destination: agentAccount,
          startingBalance: '10',
        })
        .addChangeTrust({
          id: 'trust-op',
          source: agentAccount,
          asset: USDC,
          dependsOn: 'create-op',
        });

      // Before reordering, build() should fail validation
      expect(() => builder.build()).toThrow(ValidationError);

      // Reorder operations
      builder.reorderOperationsByDependencies();

      // Now build() should succeed with correct dependency order
      const payload = builder.build();
      expect(payload.operations.map((op) => op.id)).toEqual([
        'create-op',
        'trust-op',
        'pay-op',
      ]);
      expect(payload.operations.map((op) => op.type)).toEqual([
        'createAccount',
        'changeTrust',
        'payment',
      ]);
    });

    it('detects circular dependencies and throws CIRCULAR_DEPENDENCY', () => {
      const builder = new BatchTransactionBuilder({
        source: SOURCE_ACCOUNT,
        networkPassphrase: PASSPHRASE,
      })
        .addPayment({
          id: 'op-A',
          destination: DEST_A,
          asset: 'XLM',
          amount: '10',
          dependsOn: 'op-B',
        })
        .addPayment({
          id: 'op-B',
          destination: DEST_B,
          asset: 'XLM',
          amount: '20',
          dependsOn: 'op-A',
        });

      expect(() => builder.resolveDependencies()).toThrow(ValidationError);
      try {
        builder.resolveDependencies();
      } catch (err) {
        expect((err as ValidationError).code).toBe('CIRCULAR_DEPENDENCY');
      }
    });
  });

  describe('payload serialization & formatting', () => {
    it('serializes base64 XDR and structured JSON correctly', () => {
      const builder = new BatchTransactionBuilder({
        source: SOURCE_ACCOUNT,
        networkPassphrase: PASSPHRASE,
        timeout: 600,
        memoText: 'agent-batch-42',
      })
        .addPayment({
          id: 'p1',
          agentId: 'agent_treasury',
          destination: DEST_A,
          asset: 'XLM',
          amount: '150.50',
          metadata: { purpose: 'salary' },
        })
        .addManageData({
          id: 'm1',
          agentId: 'agent_audit',
          name: 'astroid.batch.id',
          value: 'batch_999',
        });

      const payload = builder.build();

      // Verify payload properties
      expect(payload.sourceAccount).toBe(SOURCE_ACCOUNT.accountId());
      expect(payload.sequenceNumber).toBe('101');
      expect(payload.operationCount).toBe(2);
      expect(payload.fee).toBe('200');
      expect(payload.networkPassphrase).toBe(PASSPHRASE);
      expect(payload.memo).toEqual({ type: 'text', value: 'agent-batch-42' });
      expect(payload.agentIds).toEqual(['agent_treasury', 'agent_audit']);

      // Verify operation records
      expect(payload.operations[0]!.id).toBe('p1');
      expect(payload.operations[0]!.type).toBe('payment');
      expect(payload.operations[0]!.agentId).toBe('agent_treasury');
      expect(payload.operations[0]!.destination).toBe(DEST_A);
      expect(payload.operations[0]!.amount).toBe('150.50');
      expect(payload.operations[0]!.metadata).toEqual({ purpose: 'salary' });

      expect(payload.operations[1]!.id).toBe('m1');
      expect(payload.operations[1]!.type).toBe('manageData');
      expect(payload.operations[1]!.agentId).toBe('agent_audit');

      // Verify XDR serialization
      expect(payload.xdr).toBeTypeOf('string');
      expect(payload.toXDR()).toBe(payload.xdr);
      expect(builder.toXDR()).toBe(payload.xdr);

      // Verify roundtrip decode from XDR
      const decoded = decode(payload.xdr);
      expect(decoded.operations).toHaveLength(2);
      expect(decoded.operations[0]!.type).toBe('payment');
      expect(decoded.operations[1]!.type).toBe('manageData');
      expect(decoded.memo.type).toBe('text');
      expect(decoded.memo.value?.toString('utf8')).toBe('agent-batch-42');

      // Verify JSON serialization
      const json = payload.toJSON();
      expect(json.sourceAccount).toBe(SOURCE_ACCOUNT.accountId());
      expect(json.sequenceNumber).toBe('101');
      expect(json.operationCount).toBe(2);
      expect(json.fee).toBe('200');
      expect(json.timeout).toBe(600);
      expect(json.memo).toEqual({ type: 'text', value: 'agent-batch-42' });
      expect(json.agentIds).toEqual(['agent_treasury', 'agent_audit']);
      expect(json.xdr).toBe(payload.xdr);
      expect(builder.toJSON()).toEqual(json);
    });

    it('supports memoHash and memoId options', () => {
      const hash = 'a'.repeat(64);
      const builderHash = new BatchTransactionBuilder({
        source: SOURCE_ACCOUNT,
        networkPassphrase: PASSPHRASE,
        memoHash: hash,
      }).addPayment({ destination: DEST_A, asset: 'XLM', amount: '1' });

      const payloadHash = builderHash.build();
      expect(payloadHash.memo).toEqual({ type: 'hash', value: hash });
      const decodedHash = decode(payloadHash.xdr);
      expect(decodedHash.memo.type).toBe('hash');

      const builderId = new BatchTransactionBuilder({
        source: SOURCE_ACCOUNT,
        networkPassphrase: PASSPHRASE,
        memoId: '123456789',
      }).addPayment({ destination: DEST_A, asset: 'XLM', amount: '1' });

      const payloadId = builderId.build();
      expect(payloadId.memo).toEqual({ type: 'id', value: '123456789' });
      const decodedId = decode(payloadId.xdr);
      expect(decodedId.memo.type).toBe('id');
    });

    it('supports custom raw xdr.Operation types', () => {
      const customOp = Operation.payment({
        destination: DEST_A,
        asset: Asset.native(),
        amount: '12.34',
      });

      const builder = new BatchTransactionBuilder({
        source: SOURCE_ACCOUNT,
        networkPassphrase: PASSPHRASE,
      }).addOperation({
        type: 'custom',
        id: 'raw-custom',
        agentId: 'agent_custom',
        operation: customOp,
      });

      const payload = builder.build();
      expect(payload.operationCount).toBe(1);
      expect(payload.operations[0]!.type).toBe('custom');
      const decoded = decode(payload.xdr);
      expect(decoded.operations[0]!.type).toBe('payment');
    });
  });

  describe('fluent builder methods and helpers', () => {
    it('supports setting source from public key string', () => {
      const builder = new BatchTransactionBuilder({
        networkPassphrase: PASSPHRASE,
      })
        .setSource(SOURCE_KEYPAIR.publicKey(), '250')
        .addPayment({ destination: DEST_A, asset: 'XLM', amount: '5' });

      const payload = builder.build();
      expect(payload.sourceAccount).toBe(SOURCE_KEYPAIR.publicKey());
      expect(payload.sequenceNumber).toBe('251');
    });

    it('supports clear() to reset builder operations', () => {
      const builder = new BatchTransactionBuilder({
        source: SOURCE_ACCOUNT,
        networkPassphrase: PASSPHRASE,
      }).addPayment({ destination: DEST_A, asset: 'XLM', amount: '5' });

      expect(builder.getOperationCount()).toBe(1);
      builder.clear();
      expect(builder.getOperationCount()).toBe(0);
      expect(() => builder.build()).toThrow(ValidationError);
    });

    it('functional helper buildBatchTransaction works end-to-end', () => {
      const payload = buildBatchTransaction({
        source: SOURCE_ACCOUNT,
        networkPassphrase: PASSPHRASE,
        memoText: 'functional-build',
        operations: [
          {
            type: 'payment',
            destination: DEST_A,
            asset: 'XLM',
            amount: '10',
          },
          {
            type: 'manageData',
            name: 'agent.state',
            value: 'active',
          },
        ],
      });

      expect(payload.operationCount).toBe(2);
      expect(payload.memo?.value).toBe('functional-build');
      const decoded = decode(payload.xdr);
      expect(decoded.operations).toHaveLength(2);
    });
  });
});

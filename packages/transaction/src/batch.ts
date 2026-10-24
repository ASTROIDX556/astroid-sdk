/**
 * Multi-agent transaction batch builder.
 *
 * In autonomous agent architectures, multiple agents frequently execute
 * concurrent operations (settlements, disbursements, balance reallocations,
 * trustline updates) across shared or managed Stellar accounts. Submitting each
 * operation individually induces network latency, rate limit pressure, and
 * sequence race conditions.
 *
 * {@link BatchTransactionBuilder} aggregates multiple agent operations into a
 * single structured, atomic Stellar transaction payload, validating:
 * - Protocol operation limits (1 to 100 operations per transaction);
 * - Total fee bid coverage (minimum 100 stroops per operation floor, safety ceiling);
 * - Sequential dependencies between operations:
 *   - Explicit operation dependencies (`dependsOn`);
 *   - Account creation prerequisites (`createAccount` before referencing an account);
 *   - Asset trustline prerequisites (`changeTrust` before payment of issued assets);
 *   - Account merge finality (`accountMerge` must execute after operations on that account);
 * - Multi-agent correlation and metadata tracking;
 * - Payload serialization (base64 XDR envelope and structured JSON).
 *
 * @module
 */

import { Buffer } from 'node:buffer';
import {
  Account,
  Asset,
  Networks,
  Operation,
  type Transaction,
  xdr,
} from '@stellar/stellar-base';
import { ValidationError } from '@astroid/errors';

import { MAX_OPERATIONS, MAX_TOTAL_FEE_STROOPS, MIN_BASE_FEE_STROOPS } from './validator.js';
import { assertValidPositiveAmount, assertValidStellarPublicKey } from './validate.js';
import { createBuilder, parseAsset, type BuildTransactionOptions } from './builder.js';

/* -------------------------------------------------------------------------- */
/* Public types                                                                */
/* -------------------------------------------------------------------------- */

/** Base metadata common to every batched operation spec. */
export interface BaseBatchOperationSpec {
  /** Optional unique identifier for referencing in `dependsOn`. */
  id?: string;
  /** Optional agent identifier for correlation and attribution. */
  agentId?: string;
  /** Optional per-operation source account (`G…`). */
  source?: string;
  /**
   * One or more operation IDs that must execute strictly prior to this operation.
   */
  dependsOn?: string | string[];
  /** Custom application metadata for auditing or routing. */
  metadata?: Record<string, unknown>;
}

/** Payment operation specification in a batch. */
export interface BatchPaymentOperationSpec extends BaseBatchOperationSpec {
  type: 'payment';
  destination: string;
  asset: string;
  amount: string | number;
}

/** Create-account operation specification in a batch. */
export interface BatchCreateAccountOperationSpec extends BaseBatchOperationSpec {
  type: 'createAccount';
  destination: string;
  startingBalance: string | number;
}

/** Change-trust operation specification in a batch. */
export interface BatchChangeTrustOperationSpec extends BaseBatchOperationSpec {
  type: 'changeTrust';
  asset: string;
  limit?: string | number;
}

/** Account-merge operation specification in a batch. */
export interface BatchAccountMergeOperationSpec extends BaseBatchOperationSpec {
  type: 'accountMerge';
  destination: string;
}

/** Manage-data operation specification in a batch. */
export interface BatchManageDataOperationSpec extends BaseBatchOperationSpec {
  type: 'manageData';
  name: string;
  value?: string | Buffer | null;
}

/** Custom pre-constructed XDR operation specification in a batch. */
export interface BatchCustomOperationSpec extends BaseBatchOperationSpec {
  type: 'custom';
  operation: xdr.Operation;
}

/**
 * Union of all operation specifications accepted by {@link BatchTransactionBuilder}.
 */
export type BatchOperationSpec =
  | BatchPaymentOperationSpec
  | BatchCreateAccountOperationSpec
  | BatchChangeTrustOperationSpec
  | BatchAccountMergeOperationSpec
  | BatchManageDataOperationSpec
  | BatchCustomOperationSpec;

/** Record describing an assembled operation in the batch payload. */
export interface BatchedOperationRecord {
  /** 0-based index of this operation in the transaction sequence. */
  index: number;
  /** Identifier of the operation. */
  id: string;
  /** Operation type name. */
  type: string;
  /** Associated agent ID, if provided. */
  agentId?: string;
  /** Effective source account for this operation (`G…`). */
  sourceAccount: string;
  /** List of operation IDs this operation depended on. */
  dependsOn: string[];
  /** Destination account, if applicable. */
  destination?: string;
  /** Asset identifier, if applicable. */
  asset?: string;
  /** Amount or starting balance, if applicable. */
  amount?: string;
  /** Custom metadata attached to this operation. */
  metadata?: Record<string, unknown>;
}

/** Plain JSON serialized representation of a batched transaction payload. */
export interface BatchTransactionJson {
  sourceAccount: string;
  sequenceNumber: string;
  fee: string;
  operationCount: number;
  networkPassphrase: string;
  timeout?: number;
  memo?: {
    type: string;
    value: string;
  };
  agentIds: string[];
  operations: BatchedOperationRecord[];
  xdr: string;
}

/** Structured payload returned by {@link BatchTransactionBuilder.build}. */
export interface BatchTransactionPayload {
  /** The assembled unsigned Stellar Transaction instance. */
  transaction: Transaction;
  /** Base64 XDR serialization of the transaction envelope. */
  xdr: string;
  /** Total number of batched operations. */
  operationCount: number;
  /** Total fee bid in stroops for the entire transaction. */
  fee: string;
  /** Primary source account public key (`G…`). */
  sourceAccount: string;
  /** Source account sequence number at build time. */
  sequenceNumber: string;
  /** Stellar network passphrase. */
  networkPassphrase: string;
  /** Transaction memo details, when present. */
  memo?: {
    type: string;
    value: string;
  };
  /** Ordered list of structured operation records. */
  operations: BatchedOperationRecord[];
  /** Unique list of agent IDs participating in this batch. */
  agentIds: string[];
  /** Returns the base64 XDR string. */
  toXDR(): string;
  /** Returns a plain JSON representation of the batch payload. */
  toJSON(): BatchTransactionJson;
}

/** Options for constructing a {@link BatchTransactionBuilder}. */
export interface BatchTransactionBuilderOptions extends Partial<BuildTransactionOptions> {
  /** Initial array of operations to include in the batch. */
  operations?: BatchOperationSpec[];
}

/* -------------------------------------------------------------------------- */
/* Validation helpers                                                          */
/* -------------------------------------------------------------------------- */

const KNOWN_PASSPHRASES = new Set<string>([Networks.PUBLIC, Networks.TESTNET, Networks.FUTURENET]);

function assertValidPassphrase(passphrase: string): void {
  if (typeof passphrase !== 'string' || passphrase.trim().length === 0) {
    throw new ValidationError('networkPassphrase must be a non-empty string.', {
      code: 'MISSING_FIELD',
      details: { field: 'networkPassphrase' },
    });
  }
  if (!KNOWN_PASSPHRASES.has(passphrase)) {
    throw new ValidationError('networkPassphrase must be a known Stellar passphrase.', {
      code: 'INVALID_NETWORK_PASSPHRASE',
    });
  }
}

function assertValidSpec(spec: BatchOperationSpec, index: number): void {
  const where = `operations[${index}]`;

  switch (spec.type) {
    case 'payment':
      assertValidStellarPublicKey(spec.destination, `${where}.destination`);
      assertValidPositiveAmount(spec.amount, `${where}.amount`);
      parseAsset(spec.asset);
      if (spec.source !== undefined) {
        assertValidStellarPublicKey(spec.source, `${where}.source`);
      }
      break;

    case 'createAccount':
      assertValidStellarPublicKey(spec.destination, `${where}.destination`);
      assertValidPositiveAmount(spec.startingBalance, `${where}.startingBalance`);
      if (spec.source !== undefined) {
        assertValidStellarPublicKey(spec.source, `${where}.source`);
      }
      break;

    case 'changeTrust': {
      const code = spec.asset.trim();
      const separator = code.indexOf(':');
      if (separator === -1) {
        throw new ValidationError(
          `changeTrust at ${where} requires CODE:ISSUER (cannot trust native XLM).`,
          { code: 'INVALID_ASSET', details: { index } },
        );
      }
      assertValidStellarPublicKey(code.slice(separator + 1), `${where}.asset.issuer`);
      if (spec.limit !== undefined) {
        assertValidPositiveAmount(spec.limit, `${where}.limit`);
      }
      if (spec.source !== undefined) {
        assertValidStellarPublicKey(spec.source, `${where}.source`);
      }
      break;
    }

    case 'accountMerge':
      assertValidStellarPublicKey(spec.destination, `${where}.destination`);
      if (spec.source !== undefined) {
        assertValidStellarPublicKey(spec.source, `${where}.source`);
      }
      break;

    case 'manageData':
      if (typeof spec.name !== 'string' || spec.name.trim().length === 0) {
        throw new ValidationError(`manageData at ${where} requires a non-empty name string.`, {
          code: 'MISSING_FIELD',
          details: { field: `${where}.name` },
        });
      }
      if (Buffer.byteLength(spec.name, 'utf8') > 64) {
        throw new ValidationError(`manageData name at ${where} cannot exceed 64 bytes.`, {
          code: 'DATA_KEY_TOO_LONG',
          details: { field: `${where}.name` },
        });
      }
      if (spec.source !== undefined) {
        assertValidStellarPublicKey(spec.source, `${where}.source`);
      }
      break;

    case 'custom':
      if (!spec.operation || !(spec.operation instanceof xdr.Operation)) {
        throw new ValidationError(`custom at ${where} requires a valid xdr.Operation instance.`, {
          code: 'INVALID_OPERATION_TYPE',
          details: { index },
        });
      }
      break;

    default:
      throw new ValidationError(`Unknown operation type at ${where}.`, {
        code: 'INVALID_OPERATION_TYPE',
        details: { index },
      });
  }
}

/** Convert a validated {@link BatchOperationSpec} to stellar-base `xdr.Operation`. */
function toStellarOperation(spec: BatchOperationSpec, index: number): xdr.Operation {
  switch (spec.type) {
    case 'payment': {
      const asset = parseAsset(spec.asset);
      return Operation.payment({
        destination: spec.destination.trim(),
        asset,
        amount: String(spec.amount),
        ...(spec.source !== undefined ? { source: spec.source.trim() } : {}),
      });
    }

    case 'createAccount':
      return Operation.createAccount({
        destination: spec.destination.trim(),
        startingBalance: String(spec.startingBalance),
        ...(spec.source !== undefined ? { source: spec.source.trim() } : {}),
      });

    case 'changeTrust': {
      const code = spec.asset.trim();
      const separator = code.indexOf(':');
      const asset = new Asset(code.slice(0, separator), code.slice(separator + 1));
      return Operation.changeTrust({
        asset,
        ...(spec.limit !== undefined ? { limit: String(spec.limit) } : {}),
        ...(spec.source !== undefined ? { source: spec.source.trim() } : {}),
      });
    }

    case 'accountMerge':
      return Operation.accountMerge({
        destination: spec.destination.trim(),
        ...(spec.source !== undefined ? { source: spec.source.trim() } : {}),
      });

    case 'manageData':
      return Operation.manageData({
        name: spec.name.trim(),
        value: spec.value !== undefined ? spec.value : null,
        ...(spec.source !== undefined ? { source: spec.source.trim() } : {}),
      });

    case 'custom':
      return spec.operation;

    default:
      throw new ValidationError(`Unknown operation spec at index ${index}.`, {
        code: 'INVALID_OPERATION_TYPE',
        details: { index },
      });
  }
}

/* -------------------------------------------------------------------------- */
/* Builder Implementation                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Multi-agent transaction batch builder.
 *
 * Provides a fluent, strongly typed builder for bundling multiple autonomous
 * agent operations into an atomic Stellar transaction payload.
 *
 * @example
 * ```ts
 * const batch = new BatchTransactionBuilder({
 *   source: account,
 *   networkPassphrase: Networks.TESTNET,
 * })
 *   .addCreateAccount({
 *     id: 'create-agent-wallet',
 *     agentId: 'agt_onboarding',
 *     destination: agentWalletPubKey,
 *     startingBalance: '10',
 *   })
 *   .addChangeTrust({
 *     id: 'trust-usdc',
 *     agentId: 'agt_onboarding',
 *     source: agentWalletPubKey,
 *     asset: 'USDC:GBSTRH…',
 *     dependsOn: 'create-agent-wallet',
 *   })
 *   .addPayment({
 *     id: 'fund-usdc',
 *     agentId: 'agt_treasury',
 *     destination: agentWalletPubKey,
 *     asset: 'USDC:GBSTRH…',
 *     amount: '100',
 *     dependsOn: 'trust-usdc',
 *   });
 *
 * const payload = batch.build();
 * console.log(payload.operationCount); // 3
 * console.log(payload.xdr); // Base64 XDR envelope
 * ```
 */
export class BatchTransactionBuilder {
  private source?: Account;
  private networkPassphrase?: string;
  private fee?: string | number;
  private timeout?: number;
  private memoText?: string;
  private memoHash?: string;
  private memoReturn?: string;
  private memoId?: string | number | bigint;
  private operations: BatchOperationSpec[] = [];
  private cachedPayload?: BatchTransactionPayload;

  private invalidateCache(): void {
    this.cachedPayload = undefined;
  }

  constructor(options: BatchTransactionBuilderOptions = {}) {
    if (options.source) {
      this.source = options.source;
    }
    if (options.networkPassphrase) {
      this.networkPassphrase = options.networkPassphrase;
    }
    if (options.fee !== undefined) {
      this.fee = options.fee;
    }
    if (options.timeout !== undefined) {
      this.timeout = options.timeout;
    }
    if (options.memoText !== undefined) {
      this.memoText = options.memoText;
    }
    if (options.memoHash !== undefined) {
      this.memoHash = options.memoHash;
    }
    if (options.memoReturn !== undefined) {
      this.memoReturn = options.memoReturn;
    }
    if (options.memoId !== undefined) {
      this.memoId = options.memoId;
    }
    if (options.operations && options.operations.length > 0) {
      this.addOperations(options.operations);
    }
  }

  /**
   * Set or update the primary transaction source account.
   *
   * Accepts a stellar-base `Account` instance or a public key string (`G…`) with
   * an optional sequence number (defaults to `"0"`).
   */
  setSource(source: Account | string, sequenceNumber = '0'): this {
    this.invalidateCache();
    if (source instanceof Account) {
      this.source = source;
    } else {
      assertValidStellarPublicKey(source, 'source');
      this.source = new Account(source.trim(), sequenceNumber);
    }
    return this;
  }

  /** Set the Stellar network passphrase. */
  setNetworkPassphrase(networkPassphrase: string): this {
    assertValidPassphrase(networkPassphrase);
    this.invalidateCache();
    this.networkPassphrase = networkPassphrase;
    return this;
  }

  /**
   * Set the total fee bid in stroops for the entire transaction.
   *
   * When left unset, the builder computes the exact network floor
   * (`operations.length × 100` stroops) at build time.
   */
  setFee(fee: string | number): this {
    this.invalidateCache();
    this.fee = fee;
    return this;
  }

  /** Set the time-bound validity window in seconds from build time. Default 300. */
  setTimeout(timeoutSeconds: number): this {
    this.invalidateCache();
    this.timeout = timeoutSeconds;
    return this;
  }

  /** Set a standard UTF-8 text memo (maximum 28 bytes). */
  setMemoText(text: string): this {
    this.invalidateCache();
    this.memoText = text;
    return this;
  }

  /** Set a 32-byte hash memo as a 64-character hexadecimal string. */
  setMemoHash(hash: string): this {
    this.invalidateCache();
    this.memoHash = hash;
    return this;
  }

  /** Set a 32-byte return memo as a 64-character hexadecimal string. */
  setMemoReturn(hash: string): this {
    this.invalidateCache();
    this.memoReturn = hash;
    return this;
  }

  /** Set a 64-bit unsigned integer memo ID. */
  setMemoId(id: string | number | bigint): this {
    this.invalidateCache();
    this.memoId = id;
    return this;
  }

  /** Append a single operation specification to the batch sequence. */
  addOperation(operation: BatchOperationSpec): this {
    this.invalidateCache();
    this.operations.push(operation);
    return this;
  }

  /** Append an array of operation specifications to the batch sequence. */
  addOperations(operations: BatchOperationSpec[]): this {
    for (const op of operations) {
      this.addOperation(op);
    }
    return this;
  }

  /** Convenience helper to add a payment operation. */
  addPayment(params: Omit<BatchPaymentOperationSpec, 'type'>): this {
    return this.addOperation({ type: 'payment', ...params });
  }

  /** Convenience helper to add a createAccount operation. */
  addCreateAccount(params: Omit<BatchCreateAccountOperationSpec, 'type'>): this {
    return this.addOperation({ type: 'createAccount', ...params });
  }

  /** Convenience helper to add a changeTrust operation. */
  addChangeTrust(params: Omit<BatchChangeTrustOperationSpec, 'type'>): this {
    return this.addOperation({ type: 'changeTrust', ...params });
  }

  /** Convenience helper to add an accountMerge operation. */
  addAccountMerge(params: Omit<BatchAccountMergeOperationSpec, 'type'>): this {
    return this.addOperation({ type: 'accountMerge', ...params });
  }

  /** Convenience helper to add a manageData operation. */
  addManageData(params: Omit<BatchManageDataOperationSpec, 'type'>): this {
    return this.addOperation({ type: 'manageData', ...params });
  }

  /** Get an immutable view of all operations in the current batch. */
  getOperations(): readonly BatchOperationSpec[] {
    return [...this.operations];
  }

  /** Return the current number of operations in the batch. */
  getOperationCount(): number {
    return this.operations.length;
  }

  /** Clear all operations from the builder. */
  clear(): this {
    this.operations = [];
    this.invalidateCache();
    return this;
  }

  /**
   * Validate maximum operation limits and sequential dependencies between
   * batched operations.
   *
   * @throws {ValidationError} When operation count limits, fee bounds, or
   *   sequential dependencies are violated.
   */
  validate(): void {
    if (!Array.isArray(this.operations) || this.operations.length === 0) {
      throw new ValidationError('A batch transaction requires at least one operation.', {
        code: 'EMPTY_OPERATIONS',
        details: { count: 0 },
      });
    }

    if (this.operations.length > MAX_OPERATIONS) {
      throw new ValidationError(
        `A transaction may contain at most ${MAX_OPERATIONS} operations (got ${this.operations.length}).`,
        { code: 'TOO_MANY_OPERATIONS', details: { count: this.operations.length, max: MAX_OPERATIONS } },
      );
    }

    if (!this.source || !(this.source instanceof Account)) {
      throw new ValidationError('source must be a stellar-base Account instance.', {
        code: 'INVALID_SOURCE_ACCOUNT',
      });
    }

    if (!this.networkPassphrase) {
      throw new ValidationError('networkPassphrase must be a non-empty string.', {
        code: 'MISSING_FIELD',
        details: { field: 'networkPassphrase' },
      });
    }
    assertValidPassphrase(this.networkPassphrase);

    // Validate fee bounds
    const minTotal = this.operations.length * MIN_BASE_FEE_STROOPS;
    const effectiveFee = this.fee ?? minTotal;
    const numericFee = typeof effectiveFee === 'number' ? effectiveFee : Number(effectiveFee);
    if (!Number.isFinite(numericFee) || !Number.isInteger(numericFee) || numericFee < 0) {
      throw new ValidationError('fee must be a non-negative integer number of stroops.', {
        code: 'INVALID_FEE',
      });
    }
    if (numericFee < minTotal) {
      throw new ValidationError(
        `fee ${numericFee} stroops is below the network minimum of ${minTotal} stroops ` +
          `(${this.operations.length} op(s) × ${MIN_BASE_FEE_STROOPS}).`,
        { code: 'FEE_BELOW_MINIMUM', details: { fee: numericFee, minTotal } },
      );
    }
    if (numericFee > MAX_TOTAL_FEE_STROOPS) {
      throw new ValidationError(
        `fee bid ${numericFee} stroops exceeds the Astroid safety ceiling of ${MAX_TOTAL_FEE_STROOPS} stroops.`,
        { code: 'FEE_BID_TOO_HIGH', details: { fee: numericFee } },
      );
    }

    // Individual spec validation
    this.operations.forEach((spec, index) => assertValidSpec(spec, index));

    // Sequential dependency validation
    this.validateDependencies();
  }

  /**
   * Validate sequential dependencies:
   * 1. Explicit `dependsOn` references must exist and appear prior in sequence.
   * 2. Accounts created via `createAccount` in this batch cannot be used before their creation.
   * 3. Accounts changing trust in this batch cannot receive payments in that asset before the changeTrust.
   * 4. Accounts merged in this batch cannot be used as source or destination after the merge.
   */
  private validateDependencies(): void {
    const txSource = this.source!.accountId();
    const idToIndex = new Map<string, number>();

    // Pass 1: Collect IDs and detect duplicate IDs
    this.operations.forEach((op, index) => {
      if (op.id !== undefined && op.id.trim().length > 0) {
        const id = op.id.trim();
        if (idToIndex.has(id)) {
          throw new ValidationError(`Duplicate operation id "${id}" at operations[${index}].`, {
            code: 'DUPLICATE_OPERATION_ID',
            details: { id, index },
          });
        }
        idToIndex.set(id, index);
      }
    });

    // Pass 2: Explicit dependsOn check
    this.operations.forEach((op, index) => {
      if (op.dependsOn !== undefined) {
        const deps = Array.isArray(op.dependsOn) ? op.dependsOn : [op.dependsOn];
        for (const dep of deps) {
          const trimmedDep = String(dep).trim();
          if (!idToIndex.has(trimmedDep)) {
            throw new ValidationError(
              `Operation at operations[${index}] depends on "${trimmedDep}" which does not exist in the batch.`,
              {
                code: 'DEPENDENCY_NOT_FOUND',
                details: { index, dependsOn: trimmedDep },
              },
            );
          }
          const depIndex = idToIndex.get(trimmedDep)!;
          if (depIndex >= index) {
            throw new ValidationError(
              `Operation at operations[${index}] depends on "${trimmedDep}" which occurs after it (at index ${depIndex}).`,
              {
                code: 'INVALID_DEPENDENCY_ORDER',
                details: { index, dependsOn: trimmedDep, dependencyIndex: depIndex },
              },
            );
          }
        }
      }
    });

    // Pass 3: Implicit dependency checking
    // Map account -> creationIndex
    const createdAccounts = new Map<string, number>();
    // Map `${account}:${asset}` -> trustIndex
    const trustedAssets = new Map<string, number>();
    // Map account -> mergeIndex
    const mergedAccounts = new Map<string, number>();

    this.operations.forEach((op, index) => {
      if (op.type === 'createAccount') {
        createdAccounts.set(op.destination.trim(), index);
      } else if (op.type === 'changeTrust') {
        const holder = op.source ? op.source.trim() : txSource;
        trustedAssets.set(`${holder}:${op.asset.trim()}`, index);
      } else if (op.type === 'accountMerge') {
        const merged = op.source ? op.source.trim() : txSource;
        mergedAccounts.set(merged, index);
      }
    });

    this.operations.forEach((op, index) => {
      const opSource = op.source ? op.source.trim() : txSource;

      // Rule: Account creation before usage
      // Check source account
      if (createdAccounts.has(opSource)) {
        const creationIndex = createdAccounts.get(opSource)!;
        if (creationIndex > index) {
          throw new ValidationError(
            `Operation at operations[${index}] uses source account "${opSource}" before its createAccount at operations[${creationIndex}].`,
            {
              code: 'UNCREATED_ACCOUNT_DEPENDENCY',
              details: { account: opSource, operationIndex: index, creationIndex },
            },
          );
        }
      }

      // Check destination account (except for createAccount itself)
      if (op.type !== 'createAccount' && 'destination' in op && op.destination) {
        const dest = op.destination.trim();
        if (createdAccounts.has(dest)) {
          const creationIndex = createdAccounts.get(dest)!;
          if (creationIndex > index) {
            throw new ValidationError(
              `Operation at operations[${index}] references destination "${dest}" before its createAccount at operations[${creationIndex}].`,
              {
                code: 'UNCREATED_ACCOUNT_DEPENDENCY',
                details: { account: dest, operationIndex: index, creationIndex },
              },
            );
          }
        }
      }

      // Rule: changeTrust before receiving an issued asset
      if (op.type === 'payment') {
        const dest = op.destination.trim();
        const assetCode = op.asset.trim();
        if (assetCode.toUpperCase() !== 'XLM') {
          const trustKey = `${dest}:${assetCode}`;
          if (trustedAssets.has(trustKey)) {
            const trustIndex = trustedAssets.get(trustKey)!;
            if (trustIndex > index) {
              throw new ValidationError(
                `Payment to "${dest}" at operations[${index}] occurs before changeTrust for "${assetCode}" at operations[${trustIndex}].`,
                {
                  code: 'UNTRUSTED_ASSET_DEPENDENCY',
                  details: { asset: assetCode, destination: dest, paymentIndex: index, trustIndex },
                },
              );
            }
          }
        }
      }

      // Rule: Cannot use account after it has been merged
      if (mergedAccounts.has(opSource)) {
        const mergeIndex = mergedAccounts.get(opSource)!;
        if (index > mergeIndex) {
          throw new ValidationError(
            `Operation at operations[${index}] uses account "${opSource}" after it was merged at operations[${mergeIndex}].`,
            {
              code: 'ACCOUNT_MERGED_VIOLATION',
              details: { account: opSource, operationIndex: index, mergeIndex },
            },
          );
        }
      }

      if ('destination' in op && op.destination) {
        const dest = op.destination.trim();
        if (mergedAccounts.has(dest)) {
          const mergeIndex = mergedAccounts.get(dest)!;
          if (index > mergeIndex) {
            throw new ValidationError(
              `Operation at operations[${index}] targets destination "${dest}" after it was merged at operations[${mergeIndex}].`,
              {
                code: 'ACCOUNT_MERGED_VIOLATION',
                details: { account: dest, operationIndex: index, mergeIndex },
              },
            );
          }
        }
      }
    });
  }

  /**
   * Topologically resolve and reorder operations according to their explicit and
   * implicit dependencies.
   *
   * @returns A new array of {@link BatchOperationSpec}s ordered to satisfy all dependencies.
   * @throws {ValidationError} When a circular dependency is detected.
   */
  resolveDependencies(): BatchOperationSpec[] {
    const n = this.operations.length;
    if (n <= 1) return [...this.operations];

    const txSource = this.source ? this.source.accountId() : '';
    const idToIndex = new Map<string, number>();
    this.operations.forEach((op, index) => {
      const id = op.id ?? `op_${index}`;
      idToIndex.set(id, index);
    });

    // Build dependency graph (u -> v where u must execute before v)
    const inDegree = new Array<number>(n).fill(0);
    const adj = Array.from({ length: n }, () => new Set<number>());

    const addEdge = (u: number, v: number) => {
      if (u !== v && !adj[u]!.has(v)) {
        adj[u]!.add(v);
        inDegree[v]!++;
      }
    };

    // 1. Explicit dependencies
    this.operations.forEach((op, v) => {
      if (op.dependsOn) {
        const deps = Array.isArray(op.dependsOn) ? op.dependsOn : [op.dependsOn];
        for (const dep of deps) {
          const u = idToIndex.get(String(dep).trim());
          if (u !== undefined) {
            addEdge(u, v);
          }
        }
      }
    });

    // 2. Implicit createAccount dependencies
    const createAccountIndex = new Map<string, number>();
    this.operations.forEach((op, idx) => {
      if (op.type === 'createAccount') {
        createAccountIndex.set(op.destination.trim(), idx);
      }
    });

    this.operations.forEach((op, v) => {
      const opSource = op.source ? op.source.trim() : txSource;
      if (createAccountIndex.has(opSource)) {
        addEdge(createAccountIndex.get(opSource)!, v);
      }
      if (op.type !== 'createAccount' && 'destination' in op && op.destination) {
        const dest = op.destination.trim();
        if (createAccountIndex.has(dest)) {
          addEdge(createAccountIndex.get(dest)!, v);
        }
      }
    });

    // 3. Implicit changeTrust dependencies
    const trustIndex = new Map<string, number>();
    this.operations.forEach((op, idx) => {
      if (op.type === 'changeTrust') {
        const holder = op.source ? op.source.trim() : txSource;
        trustIndex.set(`${holder}:${op.asset.trim()}`, idx);
      }
    });

    this.operations.forEach((op, v) => {
      if (op.type === 'payment' && op.asset.toUpperCase() !== 'XLM') {
        const key = `${op.destination.trim()}:${op.asset.trim()}`;
        if (trustIndex.has(key)) {
          addEdge(trustIndex.get(key)!, v);
        }
      }
    });

    // 4. Implicit accountMerge dependencies (accountMerge must follow earlier ops on that account)
    this.operations.forEach((op, mergeIdx) => {
      if (op.type === 'accountMerge') {
        const merged = op.source ? op.source.trim() : txSource;
        this.operations.forEach((priorOp, priorIdx) => {
          if (priorIdx !== mergeIdx) {
            const priorSource = priorOp.source ? priorOp.source.trim() : txSource;
            if (priorSource === merged) {
              addEdge(priorIdx, mergeIdx);
            }
          }
        });
      }
    });

    // Kahn's algorithm with stable secondary sorting by original index
    const queue: number[] = [];
    for (let i = 0; i < n; i++) {
      if (inDegree[i] === 0) queue.push(i);
    }
    queue.sort((a, b) => a - b);

    const sortedIndices: number[] = [];
    while (queue.length > 0) {
      const u = queue.shift()!;
      sortedIndices.push(u);

      const nextAvailable: number[] = [];
      for (const v of adj[u]!) {
        inDegree[v]!--;
        if (inDegree[v] === 0) {
          nextAvailable.push(v);
        }
      }
      nextAvailable.sort((a, b) => a - b);
      queue.push(...nextAvailable);
    }

    if (sortedIndices.length < n) {
      throw new ValidationError('Circular dependency detected among batched operations.', {
        code: 'CIRCULAR_DEPENDENCY',
      });
    }

    return sortedIndices.map((idx) => this.operations[idx]!);
  }

  /**
   * Reorder the builder's internal operations array to satisfy all explicit
   * and implicit dependencies.
   */
  reorderOperationsByDependencies(): this {
    this.operations = this.resolveDependencies();
    this.invalidateCache();
    return this;
  }

  /**
   * Assemble and validate the batch into a {@link BatchTransactionPayload}.
   *
   * @returns The assembled, serialized {@link BatchTransactionPayload}.
   * @throws {ValidationError} When validation fails.
   */
  build(): BatchTransactionPayload {
    if (this.cachedPayload) {
      return this.cachedPayload;
    }

    this.validate();

    const minTotal = this.operations.length * MIN_BASE_FEE_STROOPS;
    const totalBid = Number(this.fee ?? minTotal);
    const perOpFee = Math.max(MIN_BASE_FEE_STROOPS, Math.floor(totalBid / this.operations.length));

    const builderOptions: BuildTransactionOptions = {
      source: this.source!,
      networkPassphrase: this.networkPassphrase!,
      fee: perOpFee,
      timeout: this.timeout ?? 300,
      memoText: this.memoText,
      memoHash: this.memoHash,
      memoReturn: this.memoReturn,
      memoId: this.memoId,
    };

    const builder = createBuilder(builderOptions);
    this.operations.forEach((spec, index) => {
      builder.addOperation(toStellarOperation(spec, index));
    });

    const tx = builder.build();
    const xdrString = tx.toXDR();

    const agentIdsSet = new Set<string>();
    const records: BatchedOperationRecord[] = this.operations.map((spec, index) => {
      if (spec.agentId) agentIdsSet.add(spec.agentId);

      const id = spec.id ?? `op_${index}`;
      const dependsOn = spec.dependsOn
        ? Array.isArray(spec.dependsOn)
          ? spec.dependsOn
          : [spec.dependsOn]
        : [];

      const record: BatchedOperationRecord = {
        index,
        id,
        type: spec.type,
        sourceAccount: spec.source ? spec.source.trim() : this.source!.accountId(),
        dependsOn,
        agentId: spec.agentId,
        metadata: spec.metadata,
      };

      if ('destination' in spec && spec.destination) {
        record.destination = spec.destination.trim();
      }
      if ('asset' in spec && spec.asset) {
        record.asset = spec.asset.trim();
      }
      if ('amount' in spec && spec.amount !== undefined) {
        record.amount = String(spec.amount);
      } else if ('startingBalance' in spec && spec.startingBalance !== undefined) {
        record.amount = String(spec.startingBalance);
      }

      return record;
    });

    let memoDetails: { type: string; value: string } | undefined;
    if (this.memoText !== undefined) {
      memoDetails = { type: 'text', value: this.memoText };
    } else if (this.memoHash !== undefined) {
      memoDetails = { type: 'hash', value: this.memoHash.trim() };
    } else if (this.memoReturn !== undefined) {
      memoDetails = { type: 'return', value: this.memoReturn.trim() };
    } else if (this.memoId !== undefined) {
      memoDetails = { type: 'id', value: String(this.memoId).trim() };
    }

    const sourceAccount = this.source!.accountId();
    const sequenceNumber = tx.sequence;
    const networkPassphrase = this.networkPassphrase!;
    const timeoutSeconds = this.timeout ?? 300;
    const agentIds = Array.from(agentIdsSet);
    const feeStr = String(totalBid);
    const operationCount = this.operations.length;

    const payload: BatchTransactionPayload = {
      transaction: tx,
      xdr: xdrString,
      operationCount,
      fee: feeStr,
      sourceAccount,
      sequenceNumber,
      networkPassphrase,
      ...(memoDetails ? { memo: memoDetails } : {}),
      operations: records,
      agentIds,
      toXDR(): string {
        return this.xdr;
      },
      toJSON(): BatchTransactionJson {
        return {
          sourceAccount: this.sourceAccount,
          sequenceNumber: this.sequenceNumber,
          fee: this.fee,
          operationCount: this.operationCount,
          networkPassphrase: this.networkPassphrase,
          timeout: timeoutSeconds,
          ...(this.memo ? { memo: this.memo } : {}),
          agentIds: this.agentIds,
          operations: this.operations,
          xdr: this.xdr,
        };
      },
    };

    this.cachedPayload = payload;
    return payload;
  }

  /**
   * Convenience method to build the batch and return its base64 XDR directly.
   */
  toXDR(): string {
    return this.build().toXDR();
  }

  /**
   * Convenience method to build the batch and return its JSON representation directly.
   */
  toJSON(): BatchTransactionJson {
    return this.build().toJSON();
  }
}

/**
 * Functional helper to construct a batch transaction payload in a single invocation.
 *
 * @param options Configuration options and operation array.
 * @returns The assembled {@link BatchTransactionPayload}.
 */
export function buildBatchTransaction(
  options: BatchTransactionBuilderOptions,
): BatchTransactionPayload {
  const builder = new BatchTransactionBuilder(options);
  return builder.build();
}

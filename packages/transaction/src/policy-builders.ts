/**
 * Policy-gated transaction builders.
 *
 * The generic builders in `builder.ts` and `multi-operation.ts` assemble
 * Stellar transactions without asking *whether* the spend is allowed. The
 * builders here close that gap: every function evaluates the caller's Astroid
 * {@link PolicySet} **before** constructing anything, and encodes the policy
 * context into the envelope so every downstream layer (backend, audits, the
 * ledger itself) can trace the decision.
 *
 * # The Astroid policy envelope
 *
 * The envelope rides on `manageData` operations, following the convention
 * already used by `budget-delegation.ts`. `manageData` values are capped at
 * 64 bytes by the Stellar protocol, so the envelope is split by volatility:
 *
 * - `astroid.policy.v1.envelope` — a compact JSON document holding the fixed
 *   fields: `v` (schema version, `1`), `allowed` (always `true` — builders
 *   refuse to build when the evaluation fails), `failedRules` (always empty
 *   on a buildable transaction, present for symmetry with the evaluation
 *   report) and `ts` (Unix milliseconds at evaluation time, from
 *   `options.now`). This document is ~58 bytes and human-readable on any
 *   explorer.
 * - `astroid.policy.v1.policies` — the caller-supplied `policyIds`, joined by
 *   commas, in their own operation so the variable-length list gets its own
 *   64-byte budget. Omitted entirely when no ids are supplied; a
 *   {@link ValidationError} (code `POLICY_ENVELOPE_TOO_LARGE`) is thrown when
 *   the joined ids exceed the 64-byte cap, since there is nowhere else to
 *   carry them.
 *
 * {@link readPolicyEnvelope} merges both operations back into a single
 * {@link PolicyEnvelope} object.
 *
 * # Ordering
 *
 * The envelope operations are added **last** (core document first, then the
 * optional policy-id list). Payment/swap/invoke operations execute first, so
 * the envelope can never mask the transaction's primary intent in
 * partial-execution diagnostics.
 *
 * # Policy evaluation
 *
 * Evaluation goes through the canonical local engine
 * `evaluatePolicy` from `@astroid/policy` — this module deliberately does not
 * reimplement any policy logic. A breach is not a network error: it throws
 * {@link PolicyViolationError} (typed, carrying the evaluation report) and no
 * transaction is built.
 *
 * @module
 */

import { Asset, Memo, Operation, StrKey, TransactionBuilder } from '@stellar/stellar-base';
import type { Transaction, xdr } from '@stellar/stellar-base';
import { ValidationError } from '@astroid/errors';
import type { PolicyEvaluationResult, PolicySet, TransactionDetails } from '@astroid/types';
import { evaluatePolicy } from '@astroid/policy';

import { MAX_OPERATIONS, MAX_TOTAL_FEE_STROOPS, MIN_BASE_FEE_STROOPS } from './validator.js';
import { assertValidStellarPublicKey, assertValidPositiveAmount } from './validate.js';
import { parseAsset, type BuildTransactionOptions } from './builder.js';

/* -------------------------------------------------------------------------- */
/* Public types                                                                */
/* -------------------------------------------------------------------------- */

/**
 * The JSON object encoded into a transaction's Astroid policy envelope.
 *
 * @see {@link POLICY_ENVELOPE_NAME}
 */
export interface PolicyEnvelope {
  /** Envelope schema version. */
  v: 1;
  /** Headline policy decision. Builders only ever encode `true`. */
  allowed: boolean;
  /** Policy record ids evaluated, when the caller supplied them. */
  policyIds?: string[];
  /** Rules that failed — always empty on a buildable transaction. */
  failedRules: string[];
  /** Unix milliseconds at evaluation time. */
  ts: number;
}

/** Options shared by every policy-gated builder. */
export interface PolicyBuildOptions extends BuildTransactionOptions {
  /**
   * The policy set to evaluate the transaction against. Required — a
   * policy-gated builder without policies would silently bypass the gate.
   * Pass `{ rules: [] }` explicitly to record "no local rules configured".
   */
  policySet: PolicySet;
  /**
   * Policy record ids to embed in the envelope. Typically the ids behind the
   * rules in {@link PolicyBuildOptions.policySet}; the local engine evaluates
   * *rules* and does not carry ids, so this field is the caller's bridge from
   * `Policy` records (see `policySetFromPolicies` in `@astroid/policy`).
   */
  policyIds?: string[];
  /**
   * Clock override for the envelope timestamp and policy time-of-day rules.
   * Supply a fixed value for deterministic builds (and tests).
   */
  now?: Date | number;
}

/**
 * The structured spend a contract invocation claims to move.
 *
 * A raw `ScVal[]` does not decompose into the asset/amount/recipient shape
 * the local policy engine evaluates, so callers building invocations that
 * transfer value describe the spend here; the policy gate evaluates this
 * claim exactly like a payment.
 */
export interface ContractSpendDetails {
  /** Asset the invocation moves: `XLM` or `CODE:ISSUER`. */
  asset: string;
  /** Amount the invocation moves (decimal string or number). */
  amount: string | number;
  /** Recipient account (`G…`) or contract address the value moves to. */
  recipientAddress?: string;
}

/** Options for {@link buildPolicyPaymentTransaction}. */
export interface PolicyPaymentOptions extends PolicyBuildOptions {
  /** Destination Stellar account (`G…`). */
  destination: string;
  /**
   * Asset to transfer: `XLM`, a bare asset code the source trusts, or
   * `CODE:ISSUER` (e.g. `USDC:G…Issuer`).
   */
  asset: string;
  /** Amount to send (decimal string or number). */
  amount: string | number;
}

/** Options for {@link buildPolicySwapTransaction}. */
export interface PolicySwapOptions extends PolicyBuildOptions {
  /** Asset debited from the source account: `XLM` or `CODE:ISSUER`. */
  sendAsset: string;
  /** Maximum amount of `sendAsset` consumed (decimal string or number). */
  sendMax: string | number;
  /** Destination Stellar account (`G…`) receiving `destAsset`. */
  destination: string;
  /** Asset credited to `destination`: `XLM` or `CODE:ISSUER`. */
  destAsset: string;
  /** Minimum amount of `destAsset` the recipient must receive. */
  destAmount: string | number;
  /**
   * Intermediate assets to route through, each `XLM` or `CODE:ISSUER`.
   * Defaults to an empty path (direct conversion). Capped at
   * {@link MAX_SWAP_PATH_LENGTH} by Stellar protocol rules.
   */
  path?: string[];
}

/** Options for {@link buildPolicyContractInvocationTransaction}. */
export interface PolicyContractInvocationOptions extends PolicyBuildOptions {
  /** Contract ID as a `C…` strkey (56 characters). */
  contractId: string;
  /** Contract function name to invoke (1–32 characters). */
  functionName: string;
  /**
   * Arguments passed to the contract function, already encoded as XDR
   * `xdr.ScVal` values. The builder does not guess encodings — callers own
   * the conversion (e.g. via `nativeToScVal`), because the correct
   * representation is contract-specific.
   */
  args?: xdr.ScVal[];
  /**
   * The value the invocation claims to move, evaluated by the policy gate.
   * Omit for invocations that transfer nothing (e.g. a read-only call).
   */
  contractSpend?: ContractSpendDetails;
}

/**
 * Thrown by every policy-gated builder when the local policy evaluation
 * rejects the transaction.
 *
 * The full {@link PolicyEvaluationResult} is available on `.evaluation`, and
 * the failing rule names on `.failedRules`, so callers can surface a precise
 * message instead of string-matching.
 */
export class PolicyViolationError extends ValidationError {
  /** The full evaluation report that rejected the transaction. */
  readonly evaluation: PolicyEvaluationResult;
  /** Names of the rules that failed, de-duplicated and in first-failure order. */
  readonly failedRules: string[];

  constructor(evaluation: PolicyEvaluationResult) {
    const failed = evaluation.failedRuleNames.length
      ? evaluation.failedRuleNames.join(', ')
      : 'unknown rules';
    super(`Transaction violates policy: ${failed}.`, {
      code: 'POLICY_VIOLATION',
      details: { failedRules: evaluation.failedRuleNames, evaluation },
    });
    this.name = 'PolicyViolationError';
    this.evaluation = evaluation;
    this.failedRules = evaluation.failedRuleNames;
  }
}

/* -------------------------------------------------------------------------- */
/* Envelope encoding                                                           */
/* -------------------------------------------------------------------------- */

/**
 * The `manageData` operation name the Astroid policy envelope is written
 * under. The `astroid.policy.v1.` prefix namespaces the envelope and carries
 * its schema version.
 */
export const POLICY_ENVELOPE_NAME = 'astroid.policy.v1.envelope';

/**
 * The `manageData` operation name carrying the evaluated `policyIds`, joined
 * by commas. Kept separate from {@link POLICY_ENVELOPE_NAME} because ids are
 * caller-supplied and unbounded, while the core envelope document must stay
 * within the 64-byte `manageData` value cap.
 */
export const POLICY_IDS_ENVELOPE_NAME = 'astroid.policy.v1.policies';

/**
 * Maximum byte length of a `manageData` value (Stellar protocol limit).
 * The core envelope document stays comfortably under it; `policyIds` are
 * validated against it explicitly.
 */
export const MAX_MANAGE_DATA_VALUE_BYTES = 64;

/**
 * Maximum number of intermediate assets a swap path may contain — the
 * Stellar protocol limit for `pathPayment*` operations.
 */
export const MAX_SWAP_PATH_LENGTH = 5;

/**
 * Read the Astroid policy envelope back out of a built transaction.
 *
 * Returns `undefined` when the transaction carries no envelope (e.g. it was
 * built by the plain builders) or when the encoded value is malformed —
 * reading is best-effort and never throws.
 */
export function readPolicyEnvelope(tx: Transaction): PolicyEnvelope | undefined {
  let core: PolicyEnvelope | undefined;
  let policyIds: string[] | undefined;

  for (const op of tx.operations) {
    if (op.type !== 'manageData') continue;

    if (op.name === POLICY_ENVELOPE_NAME) {
      if (!op.value) return undefined; // core document missing/corrupt — no envelope
      try {
        const parsed: unknown = JSON.parse(Buffer.from(op.value).toString('utf8'));
        if (parsed && typeof parsed === 'object' && 'v' in parsed && 'allowed' in parsed) {
          core = parsed as PolicyEnvelope;
          continue;
        }
        return undefined;
      } catch {
        return undefined;
      }
    }

    if (op.name === POLICY_IDS_ENVELOPE_NAME && op.value) {
      const joined = Buffer.from(op.value).toString('utf8');
      if (joined.length > 0) policyIds = joined.split(',');
    }
  }

  if (!core) return undefined;
  return policyIds !== undefined ? { ...core, policyIds } : core;
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

/** `XLM` (any case) accepted as the native-asset identifier in swaps. */
const NATIVE_ASSET_ALIASES = new Set(['XLM', 'NATIVE']);

/**
 * Parse an asset identifier into a stellar-base `Asset`, additionally
 * accepting bare `XLM`/`native` as the native asset.
 *
 * `parseAsset` (builder.ts) requires `CODE:ISSUER` for non-native assets but
 * rejects a bare `XLM` string; swaps legitimately take `XLM` on either side
 * of the conversion, so this thin extension keeps that common case ergonomic
 * while reusing the same validation underneath.
 */
function parseSwapAsset(asset: string): Asset {
  if (NATIVE_ASSET_ALIASES.has(asset.trim().toUpperCase())) return Asset.native();
  return parseAsset(asset);
}

/** Validate that `contractId` is a well-formed `C…` contract strkey. */
function assertValidContractId(contractId: string): void {
  const trimmed = contractId.trim();
  if (trimmed.length !== 56 || !trimmed.startsWith('C') || !StrKey.isValidContract(trimmed)) {
    throw new ValidationError(
      'contractId must be a valid Stellar contract strkey (C…, 56 characters).',
      { code: 'INVALID_CONTRACT_ID', details: { field: 'contractId' } },
    );
  }
}

/** Validate that `functionName` is a usable contract function name. */
function assertValidFunctionName(functionName: string): void {
  const trimmed = functionName.trim();
  if (trimmed.length === 0 || trimmed.length > 32) {
    throw new ValidationError('functionName must be 1–32 characters.', {
      code: 'INVALID_FUNCTION_NAME',
      details: { field: 'functionName' },
    });
  }
}

/**
 * Evaluate the caller's policy set against a transaction payload and throw
 * {@link PolicyViolationError} when the evaluation rejects it.
 */
function assertPolicyAllowed(
  policySet: PolicySet,
  tx: TransactionDetails,
  now: Date | number | undefined,
): void {
  const evaluation = evaluatePolicy(policySet, tx, { now });
  if (!evaluation.allowed) {
    throw new PolicyViolationError(evaluation);
  }
}

/**
 * Construct the policy envelope `manageData` operations.
 *
 * Returns the core document op plus — only when `policyIds` are supplied — the
 * separate op carrying the joined id list. The evaluation has already passed
 * by the time this runs (`allowed` is therefore always `true`); the operations
 * record *which* policies approved and when, so the envelope is evidence, not
 * a second gate.
 *
 * @throws {ValidationError} With code `POLICY_ENVELOPE_TOO_LARGE` when the
 *   joined policy ids exceed the 64-byte `manageData` value cap.
 */
function buildEnvelopeOperations(
  policyIds: string[] | undefined,
  now: Date | number | undefined,
): xdr.Operation[] {
  const envelope: PolicyEnvelope = {
    v: 1,
    allowed: true,
    failedRules: [],
    ts: now instanceof Date ? now.getTime() : (now ?? Date.now()),
  };
  const ops: xdr.Operation[] = [
    Operation.manageData({
      name: POLICY_ENVELOPE_NAME,
      value: Buffer.from(JSON.stringify(envelope), 'utf8'),
    }),
  ];

  if (policyIds !== undefined && policyIds.length > 0) {
    const joined = policyIds.join(',');
    if (Buffer.byteLength(joined, 'utf8') > MAX_MANAGE_DATA_VALUE_BYTES) {
      throw new ValidationError(
        `policyIds joined exceed the ${MAX_MANAGE_DATA_VALUE_BYTES}-byte manageData value cap ` +
          '(code POLICY_ENVELOPE_TOO_LARGE); supply fewer or shorter policy ids.',
        { code: 'POLICY_ENVELOPE_TOO_LARGE', details: { field: 'policyIds' } },
      );
    }
    ops.push(
      Operation.manageData({
        name: POLICY_IDS_ENVELOPE_NAME,
        value: Buffer.from(joined, 'utf8'),
      }),
    );
  }

  return ops;
}

/**
 * Shared tail of every policy-gated builder: assemble the primed
 * `TransactionBuilder`, add the caller's operations, append the policy
 * envelope, and build.
 *
 * The fee here is a **total** bid, mirroring `buildTransactionFromOperations`
 * in `multi-operation.ts`: stellar-base multiplies the builder fee by the
 * operation count, so the per-operation base fee is derived to make the final
 * `tx.fee` equal the caller's bid exactly.
 */
function assembleTransaction(
  options: PolicyBuildOptions,
  operations: xdr.Operation[],
): Transaction {
  const envelopeOps = buildEnvelopeOperations(options.policyIds, options.now);
  const opCount = operations.length + envelopeOps.length;
  if (opCount > MAX_OPERATIONS) {
    throw new ValidationError(
      `A policy-gated transaction may contain at most ${MAX_OPERATIONS} operations ` +
        `including the policy envelope (got ${opCount}).`,
      { code: 'TOO_MANY_OPERATIONS', details: { count: opCount } },
    );
  }

  // Sensible default: when the caller omits `fee`, bid exactly the network
  // floor for the whole bundle — including the envelope operation the builder
  // added on their behalf. An *explicit* bid below the floor still throws, so
  // underfunded calls are never silently corrected.
  const totalBid = options.fee === undefined ? opCount * MIN_BASE_FEE_STROOPS : Number(options.fee);
  if (!Number.isInteger(totalBid) || totalBid < opCount * MIN_BASE_FEE_STROOPS) {
    throw new ValidationError(
      `fee ${String(options.fee)} stroops is below the network minimum of ` +
        `${opCount * MIN_BASE_FEE_STROOPS} stroops (${opCount} op(s) × ${MIN_BASE_FEE_STROOPS}).`,
      { code: 'FEE_BELOW_MINIMUM' },
    );
  }
  if (totalBid > MAX_TOTAL_FEE_STROOPS) {
    throw new ValidationError(
      `fee bid ${totalBid} stroops exceeds the Astroid safety ceiling of ` +
        `${MAX_TOTAL_FEE_STROOPS} stroops.`,
      { code: 'FEE_BID_TOO_HIGH' },
    );
  }

  const perOpFee = Math.max(MIN_BASE_FEE_STROOPS, Math.floor(totalBid / opCount));
  let builder = new TransactionBuilder(options.source, {
    fee: String(perOpFee),
    networkPassphrase: options.networkPassphrase,
  });
  if (options.memoText !== undefined) {
    builder = builder.addMemo(Memo.text(options.memoText));
  }
  builder = builder.setTimeout(options.timeout ?? 300);
  for (const op of operations) builder.addOperation(op);
  for (const op of envelopeOps) builder.addOperation(op);
  return builder.build();
}

/* -------------------------------------------------------------------------- */
/* Builders                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Build a policy-gated Stellar payment transaction.
 *
 * Evaluates `options.policySet` against the payment first — a breach throws
 * {@link PolicyViolationError} and nothing is built — then assembles a
 * transaction containing the `payment` operation followed by the Astroid
 * policy envelope. Returns an **unsigned** transaction; sign locally (wallet
 * package offline signer) and submit via `submitPolicyTransaction`.
 *
 * @param options Payment parameters plus the policy set and build options.
 * @returns An unsigned Stellar `Transaction` carrying the policy envelope.
 * @throws {PolicyViolationError} When the policy evaluation rejects the spend.
 * @throws {ValidationError} For invalid destination, amount, asset, source,
 *   fee, or memo.
 *
 * @example
 * ```ts
 * const tx = buildPolicyPaymentTransaction({
 *   source: account,
 *   networkPassphrase: Networks.TESTNET,
 *   policySet: { rules: [{ name: 'allowlist', allowedRecipients: ['G…'] }] },
 *   destination: 'G…',
 *   asset: 'USDC:G…Issuer',
 *   amount: '25',
 *   policyIds: ['policy_123'],
 *   now: new Date('2026-01-01T00:00:00Z'),
 * });
 * ```
 */
export function buildPolicyPaymentTransaction(options: PolicyPaymentOptions): Transaction {
  const { destination, asset, amount, policySet, now, ...rest } = options;
  const buildOptions: PolicyBuildOptions = { ...rest, policySet };

  assertValidStellarPublicKey(destination, 'destination');
  assertValidPositiveAmount(amount, 'amount');
  const parsedAsset = parseAsset(asset);

  assertPolicyAllowed(
    policySet,
    {
      asset: parsedAsset.isNative() ? 'XLM' : parsedAsset.toString(),
      amount,
      recipientAddress: destination,
      senderAddress: buildOptions.source.accountId(),
    },
    now,
  );

  return assembleTransaction(options, [
    Operation.payment({
      destination: destination.trim(),
      asset: parsedAsset,
      amount: String(amount),
    }),
  ]);
}

/**
 * Build a policy-gated Stellar asset swap (`pathPaymentStrictReceive`).
 *
 * The source account pays **at most** `sendMax` of `sendAsset`; the
 * destination receives **exactly** `destAmount` of `destAsset`, routed
 * through `path`. Evaluates `options.policySet` against the conversion before
 * building — the *received* asset/amount/recipient are the payload the policy
 * sees, since that is what the treasury ends up spending. On rejection
 * {@link PolicyViolationError} is thrown and nothing is built.
 *
 * @param options Swap parameters plus the policy set and build options.
 * @returns An unsigned Stellar `Transaction` carrying the policy envelope.
 * @throws {PolicyViolationError} When the policy evaluation rejects the swap.
 * @throws {ValidationError} For invalid assets, amounts, path, destination,
 *   source, fee, or memo.
 *
 * @example
 * ```ts
 * const tx = buildPolicySwapTransaction({
 *   source: account,
 *   networkPassphrase: Networks.TESTNET,
 *   policySet,
 *   sendAsset: 'XLM',
 *   sendMax: '500',
 *   destination: 'G…',
 *   destAsset: 'USDC:G…Issuer',
 *   destAmount: '25',
 *   path: ['XLM'],
 * });
 * ```
 */
export function buildPolicySwapTransaction(options: PolicySwapOptions): Transaction {
  const { sendAsset, sendMax, destination, destAsset, destAmount, path, policySet, now, ...rest } =
    options;
  const buildOptions: PolicyBuildOptions = { ...rest, policySet };

  const parsedSendAsset = parseSwapAsset(sendAsset);
  const parsedDestAsset = parseSwapAsset(destAsset);
  assertValidStellarPublicKey(destination, 'destination');
  assertValidPositiveAmount(sendMax, 'sendMax');
  assertValidPositiveAmount(destAmount, 'destAmount');

  const parsedPath: Asset[] = [];
  if (path !== undefined) {
    if (!Array.isArray(path)) {
      throw new ValidationError('path must be an array of asset identifiers.', {
        code: 'INVALID_SWAP_PATH',
        details: { field: 'path' },
      });
    }
    if (path.length > MAX_SWAP_PATH_LENGTH) {
      throw new ValidationError(
        `path may contain at most ${MAX_SWAP_PATH_LENGTH} intermediate assets (got ${path.length}).`,
        { code: 'INVALID_SWAP_PATH', details: { field: 'path' } },
      );
    }
    for (const entry of path) parsedPath.push(parseSwapAsset(entry));
  }

  assertPolicyAllowed(
    policySet,
    {
      asset: parsedDestAsset.isNative() ? 'XLM' : parsedDestAsset.toString(),
      amount: destAmount,
      recipientAddress: destination,
      senderAddress: buildOptions.source.accountId(),
    },
    now,
  );

  return assembleTransaction(options, [
    Operation.pathPaymentStrictReceive({
      sendAsset: parsedSendAsset,
      sendMax: String(sendMax),
      destination: destination.trim(),
      destAsset: parsedDestAsset,
      destAmount: String(destAmount),
      path: parsedPath,
    }),
  ]);
}

/**
 * Build a policy-gated smart-contract invocation transaction.
 *
 * Assembles a Soroban `invokeContractFunction` operation targeting
 * `contractId.functionName` with `args`, gated by `options.policySet` first.
 * Because a raw `ScVal[]` does not decompose into the asset/amount/recipient
 * shape the local policy engine evaluates, the gate runs against
 * `contractSpend` — the caller's structured claim of what the invocation
 * moves. When it is omitted (a read-only call, say), a policy set that only
 * constrains recipients/amounts finds nothing to evaluate and passes.
 *
 * @param options Invocation parameters plus the policy set and build options.
 * @returns An unsigned Stellar `Transaction` carrying the policy envelope.
 * @throws {PolicyViolationError} When the policy evaluation rejects the claim.
 * @throws {ValidationError} For an invalid contract id, function name, args,
 *   source, fee, or memo.
 *
 * @example
 * ```ts
 * const tx = buildPolicyContractInvocationTransaction({
 *   source: account,
 *   networkPassphrase: Networks.TESTNET,
 *   policySet,
 *   contractId: 'C…',
 *   functionName: 'transfer',
 *   args: [nativeToScVal('G…', { type: 'address' }), nativeToScVal(25, { type: 'i128' })],
 *   contractSpend: { asset: 'USDC:G…Issuer', amount: '25', recipientAddress: 'G…' },
 * });
 * ```
 */
export function buildPolicyContractInvocationTransaction(
  options: PolicyContractInvocationOptions,
): Transaction {
  const { contractId, functionName, args, policySet, now, ...rest } = options;
  const buildOptions: PolicyBuildOptions = { ...rest, policySet };

  assertValidContractId(contractId);
  assertValidFunctionName(functionName);
  if (args !== undefined && !Array.isArray(args)) {
    throw new ValidationError('args must be an array of ScVal values.', {
      code: 'INVALID_CONTRACT_ARGS',
      details: { field: 'args' },
    });
  }

  const spend = options.contractSpend;
  if (spend !== undefined) {
    assertValidPositiveAmount(spend.amount, 'contractSpend.amount');
    assertPolicyAllowed(
      policySet,
      {
        asset: spend.asset,
        amount: spend.amount,
        ...(spend.recipientAddress !== undefined
          ? { recipientAddress: spend.recipientAddress }
          : {}),
        senderAddress: buildOptions.source.accountId(),
      },
      now,
    );
  } else {
    assertPolicyAllowed(policySet, { asset: '', amount: 0 }, now);
  }

  return assembleTransaction(options, [
    Operation.invokeContractFunction({
      contract: contractId.trim(),
      function: functionName.trim(),
      args: args ?? [],
    }),
  ]);
}

/**
 * Asset-descriptor-aware transaction builder.
 *
 * {@link buildAssetPaymentTransaction} is the canonical way an autonomous
 * agent constructs a **multi-asset** payment transaction from the typed
 * {@link AssetDescriptor} structures shared through `@astroid/types`. It
 * accepts either a structured descriptor (`{ type: 'issued', code: 'USDC',
 * issuer }`) or the loose string convention (`'XLM'`, `'USDC:G…Issuer'`),
 * validates the destination address and asset identifier **before** anything
 * is built, and returns a standard unsigned Stellar envelope ready for local
 * signing (see `@astroid/wallet`) and submission.
 *
 * Like every builder in this package it is pure: no network access, and all
 * invalid input surfaces as a structured {@link ValidationError} from
 * `@astroid/errors` with a machine-readable `code`.
 *
 * @module
 */

import {
  Asset,
  Operation,
  type Account,
  type FeeBumpTransaction,
  type Transaction,
} from '@stellar/stellar-base';
import { ValidationError } from '@astroid/errors';
import type { AssetDescriptor, IssuedAssetDescriptor, NativeAssetDescriptor } from '@astroid/types';

import { assertValidPositiveAmount, assertValidStellarPublicKey } from './validate.js';
import { createBuilder, type BuildTransactionOptions } from './builder.js';
import type { FeeBumpOptions } from './feeBump.js';
import { bumpFee } from './feeBump.js';

/* -------------------------------------------------------------------------- */
/* Public types                                                                */
/* -------------------------------------------------------------------------- */

/** Options for {@link buildAssetPaymentTransaction}. */
export interface AssetPaymentTransactionOptions extends BuildTransactionOptions {
  /** Destination Stellar account (`G…`). */
  destination: string;
  /**
   * The asset to transfer, as a structured {@link AssetDescriptor} or the
   * loose string convention (`XLM`, `CODE:ISSUER`).
   */
  asset: AssetDescriptor | string;
  /** Amount to send (decimal string or number). */
  amount: string | number;
  /** Sponsor the transaction fee with a Stellar fee-bump envelope. */
  feeBump?: Pick<FeeBumpOptions, 'feeSource' | 'baseFee' | 'feeBufferPercentage'>;
}

/** Everything {@link buildAssetPaymentTransaction} returns about the built envelope. */
export interface AssetPaymentTransactionResult {
  /** The unsigned payment transaction (or fee-bump envelope when sponsored). */
  transaction: Transaction | FeeBumpTransaction;
  /** Base64 XDR of the envelope — ready for signing and submission. */
  xdr: string;
  /** The canonical asset descriptor the payment was built from. */
  asset: AssetDescriptor;
  /** The resolved Stellar `Asset` carried by the payment operation. */
  stellarAsset: Asset;
  /** Destination account address (`G…`), trimmed. */
  destination: string;
  /** The payment amount, normalized to Stellar's 7-decimal string form. */
  amount: string;
}

/* -------------------------------------------------------------------------- */
/* Descriptor → stellar-base Asset                                             */
/* -------------------------------------------------------------------------- */

/** Throw unless `issuer` is a checksum-valid Stellar public key. */
function assertValidIssuer(issuer: string): void {
  assertValidStellarPublicKey(issuer, 'asset.issuer');
}

/**
 * Resolve an asset reference into the canonical {@link AssetDescriptor} and
 * its `@stellar/stellar-base` {@link Asset} twin.
 *
 * Structured descriptors are validated directly (an `issued` descriptor must
 * carry a checksum-valid issuer); plain strings are first parsed through
 * `parseAssetDescriptor` from `@astroid/types`, so `XLM`, bare codes and
 * `CODE:ISSUER` forms all normalize to the same union before validation.
 *
 * @param asset The asset reference to resolve.
 * @returns The canonical descriptor and matching Stellar `Asset`.
 * @throws {ValidationError} When the reference is malformed or its issuer is
 *   not a valid Stellar public key.
 *
 * @example
 * ```ts
 * const { asset, stellarAsset } = resolveAsset({ type: 'native' });
 * asset; // { type: 'native' }
 * stellarAsset.isNative(); // true
 * ```
 */
export function resolveAsset(asset: AssetDescriptor | string): {
  asset: AssetDescriptor;
  stellarAsset: Asset;
} {
  if (asset === null || asset === undefined) {
    throw new ValidationError('asset is required.', { code: 'INVALID_ASSET' });
  }

  // Already-structured descriptor: validate in place.
  if (typeof asset === 'object') {
    if (asset.type === 'native') {
      const native: NativeAssetDescriptor = { type: 'native' };
      return { asset: native, stellarAsset: Asset.native() };
    }
    if (asset.type === 'issued') {
      assertValidIssuer(asset.issuer);
      const issued: IssuedAssetDescriptor = {
        type: 'issued',
        code: asset.code,
        issuer: asset.issuer,
      };
      return { asset: issued, stellarAsset: new Asset(issued.code, issued.issuer) };
    }
    throw new ValidationError('asset must be a native or issued asset descriptor.', {
      code: 'INVALID_ASSET',
      details: { received: (asset as { type?: unknown }).type },
    });
  }

  // String form: delegate parsing/validation to the shared types helper.
  if (typeof asset !== 'string') {
    throw new ValidationError('asset must be a descriptor object or a string identifier.', {
      code: 'INVALID_ASSET',
    });
  }

  const trimmed = asset.trim();
  if (trimmed.length === 0) {
    throw new ValidationError('asset identifier must be a non-empty string.', {
      code: 'INVALID_ASSET',
    });
  }

  const separator = trimmed.indexOf(':');
  if (separator === -1) {
    if (trimmed.toUpperCase() === 'XLM') {
      const native: NativeAssetDescriptor = { type: 'native' };
      return { asset: native, stellarAsset: Asset.native() };
    }
    throw new ValidationError(
      `Non-native asset "${trimmed}" requires an issuer. Use CODE:ISSUER (e.g. USDC:G…).`,
      { code: 'INVALID_ASSET_ISSUER' },
    );
  }

  const code = trimmed.slice(0, separator);
  const issuer = trimmed.slice(separator + 1).trim();
  assertValidIssuer(issuer);
  const issued: IssuedAssetDescriptor = { type: 'issued', code, issuer };
  return { asset: issued, stellarAsset: new Asset(code, issuer) };
}

/**
 * Build a multi-asset payment transaction from a typed asset descriptor.
 *
 * Validates the destination address and asset identifier (descriptor or
 * string form) **before** construction, assembles the standard Stellar
 * `payment` operation with the requested amount, memo and fee, and — when
 * `feeBump` is supplied — wraps the result in a fee-bump envelope so a
 * sponsoring account pays the fee. The result is unsigned: sign it locally
 * (e.g. with `@astroid/wallet`'s offline signer) and submit via
 * `@astroid/transaction`'s submission helpers.
 *
 * @param options The payment to build, plus shared build options.
 * @returns An {@link AssetPaymentTransactionResult} with the envelope, its
 *   XDR and the resolved asset.
 * @throws {ValidationError} For an invalid destination, amount, asset, source
 *   account, memo, or a fee outside the accepted bounds.
 *
 * @example
 * ```ts
 * // Native XLM transfer:
 * const { xdr } = buildAssetPaymentTransaction({
 *   source: account,
 *   networkPassphrase: StellarNetworkPassphrase.TESTNET,
 *   destination: 'G…',
 *   asset: { type: 'native' },
 *   amount: '10.5',
 *   memoText: 'payout-42',
 * });
 *
 * // Custom trustline asset, fee-sponsored by a treasury account:
 * const usdc = await buildAssetPaymentTransaction({
 *   source: account,
 *   networkPassphrase: StellarNetworkPassphrase.TESTNET,
 *   destination: 'G…',
 *   asset: { type: 'issued', code: 'USDC', issuer: 'G…Issuer' },
 *   amount: '25',
 *   feeBump: { feeSource: { publicKey: sponsor.publicKey() } },
 * });
 * ```
 */
export function buildAssetPaymentTransaction(
  options: AssetPaymentTransactionOptions,
): AssetPaymentTransactionResult {
  const { destination, amount } = options;

  assertValidStellarPublicKey(destination, 'destination');
  assertValidPositiveAmount(amount, 'amount');

  const { asset, stellarAsset } = resolveAsset(options.asset);
  const trimmedDestination = destination.trim();

  const transaction = createBuilder(options)
    .addOperation(
      Operation.payment({
        destination: trimmedDestination,
        asset: stellarAsset,
        amount: String(amount),
      }),
    )
    .build();

  if (!options.feeBump) {
    return {
      transaction,
      xdr: transaction.toXDR(),
      asset,
      stellarAsset,
      destination: trimmedDestination,
      amount: String(amount),
    };
  }

  const bumped = bumpFee({
    ...options.feeBump,
    transaction,
    networkPassphrase: options.networkPassphrase,
  }).transaction;

  return {
    transaction: bumped,
    xdr: bumped.toXDR(),
    asset,
    stellarAsset,
    destination: trimmedDestination,
    amount: String(amount),
  };
}

/** Type re-export for callers assembling payments from account instances. */
export type { Account };

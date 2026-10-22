/**
 * Trustline verification utilities for `@astroid/wallet`.
 *
 * Stellar requires an explicit trustline before an account can hold a custom
 * asset. This module provides a helper that queries the wallet's live balance
 * to confirm the trustline exists before the agent attempts a transaction.
 *
 * @module
 */

import type { AssetBalance } from '@astroid/types';
import { TrustlineMissingError } from '@astroid/errors';

/**
 * Normalized asset identifier used for trustline lookups.
 *
 * Matches the `CODE:ISSUER` convention used by the Astroid API and
 * {@link assetIdentifierFromDescriptor}.
 */
export interface TrustlineAsset {
  /** Asset code (e.g. `USDC`). */
  code: string;
  /** Issuing Stellar account (`G…`). */
  issuer: string;
}

/**
 * Result of a trustline verification.
 */
export interface TrustlineVerificationResult {
  /** Whether the trustline is present and active. */
  verified: true;
  /** The matching balance entry from the wallet. */
  balance: AssetBalance;
  /** The asset that was verified. */
  asset: TrustlineAsset;
}

/**
 * Error codes for trustline verification failures.
 */
export const TrustlineErrorCode = {
  /** The wallet does not have a trustline for the requested asset. */
  MISSING: 'TRUSTLINE_MISSING',
  /** The wallet exists but the asset balance is frozen/unusable. */
  FROZEN: 'TRUSTLINE_FROZEN',
  /** The wallet was not found. */
  WALLET_NOT_FOUND: 'WALLET_NOT_FOUND',
} as const;

/** Union type of trustline error code values. */
export type TrustlineErrorCodeValue = (typeof TrustlineErrorCode)[keyof typeof TrustlineErrorCode];

/**
 * Verifies that a wallet has an active trustline for the specified asset.
 *
 * Queries the wallet's live on-chain balance via the Astroid API. A trustline
 * is considered present when the asset appears in the wallet's balance list
 * (even with a zero balance). For native XLM, the check always succeeds since
 * no trustline is required.
 *
 * @param walletResource - The wallet resource instance to query.
 * @param walletId - The wallet identifier.
 * @param assetCode - The asset code (e.g. `USDC`).
 * @param issuer - The asset issuer's Stellar public key (`G…`).
 * @returns Verification result with the matching balance entry.
 * @throws {TrustlineMissingError} When the wallet lacks the required trustline.
 * @throws {NotFoundError} When the wallet does not exist.
 * @throws {NetworkError} On transport failures.
 *
 * @example
 * ```ts
 * import { verifyAssetTrustline } from '@astroid/wallet';
 *
 * const result = await verifyAssetTrustline(astroid.wallets, 'wlt_123', 'USDC', 'GABC...');
 * console.log(result.balance.balance); // '100.00'
 * ```
 */
export async function verifyAssetTrustline(
  walletResource: Pick<
    import('./index.js').WalletResource,
    'getWalletBalances'
  >,
  walletId: string,
  assetCode: string,
  issuer: string,
): Promise<TrustlineVerificationResult> {
  // Native XLM never requires a trustline.
  if (assetCode === 'XLM') {
    return {
      verified: true,
      balance: { asset: 'XLM', balance: '0', issuer: null },
      asset: { code: 'XLM', issuer: '' },
    };
  }

  const balances = await walletResource.getWalletBalances(walletId, {
    assetCode,
    issuer,
  });

  const match = findMatchingBalance(balances.balances, assetCode, issuer);

  if (!match) {
    throw new TrustlineMissingError(
      `Wallet ${walletId} does not have a trustline for ${assetCode}:${issuer}`,
      {
        code: TrustlineErrorCode.MISSING,
        status: 422,
        details: { walletId, assetCode, issuer },
      },
    );
  }

  return {
    verified: true,
    balance: match,
    asset: { code: assetCode, issuer },
  };
}

/**
 * Finds a balance entry matching the exact asset code and issuer.
 *
 * Matching is case-sensitive for the asset code and issuer to match
 * Stellar's exact semantics.
 */
function findMatchingBalance(
  balances: AssetBalance[],
  assetCode: string,
  issuer: string,
): AssetBalance | undefined {
  return balances.find(
    (b) => b.asset === assetCode && b.issuer === issuer,
  );
}

/**
 * Checks whether a wallet has a trustline for the asset without throwing.
 *
 * Returns `true` if the trustline exists, `false` otherwise. Useful for
 * conditional logic where a missing trustline is an expected state rather
 * than an error.
 *
 * @param walletResource - The wallet resource instance to query.
 * @param walletId - The wallet identifier.
 * @param assetCode - The asset code (e.g. `USDC`).
 * @param issuer - The asset issuer's Stellar public key (`G…`).
 * @returns `true` when the trustline is present.
 */
export async function hasAssetTrustline(
  walletResource: Pick<
    import('./index.js').WalletResource,
    'getWalletBalances'
  >,
  walletId: string,
  assetCode: string,
  issuer: string,
): Promise<boolean> {
  try {
    await verifyAssetTrustline(walletResource, walletId, assetCode, issuer);
    return true;
  } catch (error) {
    if (error instanceof TrustlineMissingError) return false;
    throw error;
  }
}
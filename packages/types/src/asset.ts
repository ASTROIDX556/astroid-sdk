/**
 * Asset descriptor structures shared across the Astroid SDK.
 *
 * An {@link AssetDescriptor} is the canonical, typed way to name a Stellar
 * asset inside an agent's policy envelope or transaction payload. It replaces
 * the loose string convention (`XLM`, `USDC`, `USDC:G…Issuer`) with a
 * discriminated union while remaining fully interoperable with it:
 *
 * - {@link assetIdentifierFromDescriptor} renders a descriptor back to its
 *   string form.
 * - {@link parseAssetDescriptor} parses a string identifier (or a descriptor
 *   that is already structured) into the canonical union.
 *
 * Native XLM uses the `native` variant; every issued (trustline) asset uses
 * the `issued` variant with an explicit `code` and checksum-validated issuer.
 *
 * @module
 */

/** Discriminator tag for the native Stellar lumen asset. */
export const NATIVE_ASSET_CODE = 'XLM';

/**
 * The native Stellar asset (XLM, the network's built-in lumen).
 *
 * @example
 * ```ts
 * const xlm: NativeAssetDescriptor = { type: 'native' };
 * ```
 */
export interface NativeAssetDescriptor {
  /** Discriminator: the built-in network asset. */
  type: 'native';
}

/**
 * A custom issued (trustline) asset: `code` issued by `issuer`.
 *
 * @example
 * ```ts
 * const usdc: IssuedAssetDescriptor = {
 *   type: 'issued',
 *   code: 'USDC',
 *   issuer: 'GB…', // the issuing Stellar account
 * };
 * ```
 */
export interface IssuedAssetDescriptor {
  /** Discriminator: a custom trustline asset. */
  type: 'issued';
  /**
   * The asset code: 1–12 alphanumeric characters (Stellar's asset-code rule).
   */
  code: string;
  /** The issuing Stellar account (`G…`). */
  issuer: string;
}

/** Any Stellar asset, in its canonical structured form. */
export type AssetDescriptor = NativeAssetDescriptor | IssuedAssetDescriptor;

/**
 * The plain-string asset identifier convention used across the Astroid API:
 * `XLM`, a bare asset code, or `CODE:ISSUER`.
 */
export type AssetIdentifier = string;

/**
 * Render an {@link AssetDescriptor} back to its plain-string identifier.
 *
 * The native asset renders as `XLM`; an issued asset renders as
 * `` `${code}:${issuer}` `` — the same convention accepted by
 * {@link parseAssetDescriptor} and the rest of the Astroid API.
 *
 * @param asset The descriptor to render.
 * @returns The string identifier (e.g. `XLM` or `USDC:G…Issuer`).
 *
 * @example
 * ```ts
 * assetIdentifierFromDescriptor({ type: 'native' }); // 'XLM'
 * assetIdentifierFromDescriptor({ type: 'issued', code: 'USDC', issuer }); // 'USDC:G…'
 * ```
 */
export function assetIdentifierFromDescriptor(asset: AssetDescriptor): AssetIdentifier {
  if (asset.type === 'issued') {
    return `${asset.code}:${asset.issuer}`;
  }
  return NATIVE_ASSET_CODE;
}

/**
 * Whether `value` looks like a well-formed asset descriptor.
 *
 * A `native` descriptor must carry `type: 'native'`; an `issued` descriptor
 * must additionally carry a non-empty alphanumeric `code` (1–12 characters)
 * and a non-empty string `issuer`. Structural checks only — checksum
 * validation of the issuer is the transaction layer's job
 * (`@astroid/transaction`'s `parseAsset`).
 *
 * @param value The value to check.
 * @returns `true` when the value is a structurally valid descriptor.
 *
 * @example
 * ```ts
 * isAssetDescriptor({ type: 'native' }); // true
 * isAssetDescriptor({ type: 'issued', code: 'USDC', issuer: 'G…' }); // true
 * isAssetDescriptor('XLM'); // false — plain strings are identifiers, not descriptors
 * ```
 */
export function isAssetDescriptor(value: unknown): value is AssetDescriptor {
  if (value === null || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.type === 'native') return true;
  if (candidate.type !== 'issued') return false;
  return (
    typeof candidate.code === 'string' &&
    candidate.code.length > 0 &&
    /^[A-Za-z0-9]{1,12}$/.test(candidate.code) &&
    typeof candidate.issuer === 'string' &&
    candidate.issuer.trim().length > 0
  );
}

/**
 * Parse a loose asset reference into a canonical {@link AssetDescriptor}.
 *
 * Accepts:
 * - an already-structured {@link AssetDescriptor} (returned after re-validation),
 * - `XLM` (any casing) — the native descriptor,
 * - a bare 1–12 character asset code — **rejected**: a code without an issuer
 *   is ambiguous, and guessing an issuer would be dangerous for a payment,
 * - `CODE:ISSUER` — split into the `issued` descriptor.
 *
 * @param asset The string identifier or descriptor to parse.
 * @returns The canonical descriptor.
 * @throws {Error} When the identifier is empty, malformed, or missing an issuer.
 *
 * @example
 * ```ts
 * parseAssetDescriptor('XLM'); // { type: 'native' }
 * parseAssetDescriptor('USDC:GB…'); // { type: 'issued', code: 'USDC', issuer: 'GB…' }
 * parseAssetDescriptor({ type: 'native' }); // returned as-is
 * ```
 */
export function parseAssetDescriptor(asset: AssetIdentifier | AssetDescriptor): AssetDescriptor {
  if (asset !== null && typeof asset === 'object') {
    if (isAssetDescriptor(asset)) return asset;
    throw new Error(`Malformed asset descriptor: ${JSON.stringify(asset)}`);
  }

  if (typeof asset !== 'string') {
    throw new Error('asset must be a string identifier or an asset descriptor object.');
  }

  const trimmed = asset.trim();
  if (trimmed === '') {
    throw new Error('asset identifier must be a non-empty string.');
  }

  const separator = trimmed.indexOf(':');
  if (separator === -1) {
    if (trimmed.toUpperCase() === NATIVE_ASSET_CODE) {
      return { type: 'native' };
    }
    throw new Error(
      `Non-native asset "${trimmed}" requires an issuer. Use CODE:ISSUER (e.g. USDC:GB…).`,
    );
  }

  const code = trimmed.slice(0, separator);
  const issuer = trimmed.slice(separator + 1).trim();
  if (!/^[A-Za-z0-9]{1,12}$/.test(code)) {
    throw new Error(`Invalid asset code "${code}": use 1–12 alphanumeric characters.`);
  }
  if (issuer === '') {
    throw new Error(`Asset "${code}" is missing its issuer after ":".`);
  }
  return { type: 'issued', code, issuer };
}

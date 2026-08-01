/**
 * Stellar asset helpers.
 */

/** Whether an asset code refers to native XLM (case-insensitive). */
export function isNativeAsset(asset: string): boolean {
  const normalized = asset.trim().toUpperCase();
  return normalized === 'XLM' || normalized === 'NATIVE';
}

/**
 * Whether a string is a syntactically valid Stellar asset code (1–12
 * alphanumeric characters, per SEP-0011 Alphanumeric4/Alphanumeric12).
 */
export function isValidAssetCode(asset: string): boolean {
  return /^[A-Za-z0-9]{1,12}$/.test(asset);
}

/** A canonical `CODE:ISSUER` string, or just `CODE` for the native asset. */
export function assetIdentifier(code: string, issuer?: string | null): string {
  if (isNativeAsset(code)) return 'XLM';
  return issuer ? `${code}:${issuer}` : code;
}

/**
 * Parse a canonical asset identifier back into its parts.
 * `"USDC:GA..."` → `{ code: 'USDC', issuer: 'GA...' }`.
 */
export function parseAssetIdentifier(identifier: string): { code: string; issuer?: string } {
  const [code, issuer] = identifier.split(':');
  return issuer ? { code: code ?? identifier, issuer } : { code: code ?? identifier };
}

/**
 * Whether a string looks like a Stellar public key (Ed25519 account address:
 * starts with `G`, 56 base32 characters).
 */
export function isStellarAddress(value: string): boolean {
  return /^G[A-Z2-7]{55}$/.test(value);
}

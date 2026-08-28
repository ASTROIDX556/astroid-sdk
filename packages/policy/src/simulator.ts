import type { Policy, PolicyViolation } from '@astroid/types';

export interface DecodedOperation {
  type: string;
  sourceAccount?: string;
  destination?: string;
  recipient?: string;
  asset?: string;
  amount?: string | number;
  [key: string]: unknown;
}

export interface DecodedTxPayload {
  sourceAccount?: string;
  operations: DecodedOperation[];
  memo?: string;
  fee?: string | number;
}

export interface LocalPolicySimulationResult {
  passed: boolean;
  violations: PolicyViolation[];
}

export function simulatePolicyLocal(
  decodedTx: DecodedTxPayload,
  policies: Policy[]
): LocalPolicySimulationResult {
  const violations: PolicyViolation[] = [];

  if (!decodedTx || !Array.isArray(decodedTx.operations) || !Array.isArray(policies)) {
    return {
      passed: true,
      violations: [],
    };
  }

  for (const policy of policies) {
    if (!policy.enabled) continue;

    const config = policy.configuration || {};

    for (const op of decodedTx.operations) {
      const opAsset = op.asset || (config.asset as string | undefined);
      const opAmount = typeof op.amount === 'string' ? parseFloat(op.amount) : typeof op.amount === 'number' ? op.amount : 0;
      const opDest = op.destination || op.recipient || '';

      // 1. Asset Allowlist rule
      const allowedAssets = config.allowedAssets || (policy.type === 'asset_allowlist' && Array.isArray(config.assets) ? config.assets : undefined);
      if (Array.isArray(allowedAssets) && allowedAssets.length > 0) {
        if (opAsset && !allowedAssets.includes(opAsset)) {
          violations.push({
            policyId: policy.id,
            policyName: policy.name,
            policyType: policy.type,
            message: `Asset ${opAsset} is not in the allowed assets list [${allowedAssets.join(', ')}]`,
          });
        }
      }

      // 2. Blocked Assets rule
      const blockedAssets = config.blockedAssets;
      if (Array.isArray(blockedAssets) && blockedAssets.length > 0) {
        if (opAsset && blockedAssets.includes(opAsset)) {
          violations.push({
            policyId: policy.id,
            policyName: policy.name,
            policyType: policy.type,
            message: `Asset ${opAsset} is blocked by policy`,
          });
        }
      }

      // 3. Max Amount Limit rule
      const maxAmount = typeof config.maxAmount === 'number' ? config.maxAmount : typeof config.limit === 'number' ? config.limit : undefined;
      if (typeof maxAmount === 'number' && maxAmount > 0) {
        if (opAmount > maxAmount) {
          violations.push({
            policyId: policy.id,
            policyName: policy.name,
            policyType: policy.type,
            message: `Transfer amount ${opAmount} exceeds max limit of ${maxAmount}`,
            limit: maxAmount,
            actual: opAmount,
          });
        }
      }

      // 4. Destination Denylist rule
      const blockedRecipients = config.blockedRecipients || config.destinationDenylist || (policy.type === 'destination_denylist' && Array.isArray(config.recipients) ? config.recipients : undefined);
      if (Array.isArray(blockedRecipients) && blockedRecipients.length > 0) {
        if (opDest && blockedRecipients.includes(opDest)) {
          violations.push({
            policyId: policy.id,
            policyName: policy.name,
            policyType: policy.type,
            message: `Destination address ${opDest} is blocked on denylist`,
          });
        }
      }

      // 5. Allowed Recipients rule (if specified)
      const allowedRecipients = config.allowedRecipients;
      if (Array.isArray(allowedRecipients) && allowedRecipients.length > 0) {
        if (opDest && !allowedRecipients.includes(opDest)) {
          violations.push({
            policyId: policy.id,
            policyName: policy.name,
            policyType: policy.type,
            message: `Destination address ${opDest} is not in allowed recipients list`,
          });
        }
      }
    }
  }

  return {
    passed: violations.length === 0,
    violations,
  };
}
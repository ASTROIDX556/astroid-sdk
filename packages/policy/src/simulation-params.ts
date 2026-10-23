/**
 * `@astroid/policy` — policy simulation parameter builders.
 *
 * `simulatePolicy` needs a well-formed {@link PolicySimulationRequest} before it
 * can dry-run a transaction against an organization's rules. Hand-writing that
 * payload is error-prone: the asset must be a valid identifier, the amount a
 * positive finite value, and `walletId` / `agentId` are mutually exclusive.
 *
 * {@link PolicySimulationBuilder} offers a small, chainable, fully-typed API
 * for assembling a validated request — the exact payload accepted by both
 * `PolicyResource.simulatePolicy` and the standalone `simulatePolicy(client,
 * input)` helper. Each method validates its argument immediately; `build()`
 * additionally re-validates the complete request so a partially-constructed
 * payload can never slip through.
 *
 * The builder is pure and side-effect free; the only runtime dependency is the
 * structured {@link ValidationError} from `@astroid/errors`.
 *
 * @example
 * ```ts
 * import { simulationParams } from '@astroid/policy';
 *
 * const params = simulationParams()
 *   .forWallet('w_1')
 *   .withAsset('USDC')
 *   .withAmount('250.50')
 *   .toRecipient('GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW')
 *   .withMemo('invoice #42')
 *   .build();
 *
 * const result = await astroid.policies.simulatePolicy(params);
 * ```
 *
 * @module
 */

import { ValidationError } from '@astroid/errors';
import type { PolicySimulationRequest } from '@astroid/types';

import { isValidPolicyAsset } from './builder.js';

/** A plain, non-negative decimal (`"250"`, `"250.50"`, `"0"`). */
const DECIMAL_PATTERN = /^\d+(?:\.\d+)?$/;

/** Error code shared by every parameter-validation failure. */
const PARAMS_ERROR_CODE = 'INVALID_POLICY_SIMULATION_PARAMS';

/* -------------------------------------------------------------------------- */
/* Validation helpers                                                          */
/* -------------------------------------------------------------------------- */

/** Throw a {@link ValidationError} when `value` is not a non-empty string. */
function assertNonEmptyString(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ValidationError(`${field} must be a non-empty string.`, {
      code: PARAMS_ERROR_CODE,
      details: { field },
    });
  }
}

/** Whether `value` is a positive amount: finite number > 0 or decimal string > 0. */
function isPositiveAmount(value: unknown): value is number | string {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0;
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!DECIMAL_PATTERN.test(trimmed)) return false;
  return Number(trimmed) > 0;
}

/** Whether `value` is a non-negative amount: finite number ≥ 0 or decimal string ≥ 0. */
function isNonNegativeAmount(value: unknown): value is number | string {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0;
  if (typeof value !== 'string') return false;
  return DECIMAL_PATTERN.test(value.trim());
}

/**
 * Validate an arbitrary payload as a {@link PolicySimulationRequest}.
 *
 * Enforces every constraint the simulation endpoint depends on: a valid asset
 * identifier, a positive amount, non-empty optional address/memo fields,
 * well-formed `policyIds`, and the `walletId` / `agentId` exclusivity rule.
 * String fields are trimmed; leading/trailing whitespace on the asset or the
 * addresses never leaks into the request body.
 *
 * @param input The payload to validate (already strongly-typed values are
 *   returned as-is; `unknown` callers get full protection).
 * @returns A normalized {@link PolicySimulationRequest}.
 * @throws {ValidationError} With code `INVALID_POLICY_SIMULATION_PARAMS` when
 *   any constraint is violated.
 */
export function validatePolicySimulationParams(input: unknown): PolicySimulationRequest {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new ValidationError('Policy simulation parameters must be an object.', {
      code: PARAMS_ERROR_CODE,
      details: { field: 'root' },
    });
  }

  const record = input as Record<string, unknown>;

  // Scoping is optional but strictly exclusive.
  const walletId = record.walletId;
  const agentId = record.agentId;
  if (walletId !== undefined) assertNonEmptyString(walletId, 'walletId');
  if (agentId !== undefined) assertNonEmptyString(agentId, 'agentId');
  if (walletId !== undefined && agentId !== undefined) {
    throw new ValidationError('walletId and agentId are mutually exclusive.', {
      code: PARAMS_ERROR_CODE,
      details: { field: 'walletId' },
    });
  }

  // Asset and amount are required.
  const asset = record.asset;
  if (typeof asset !== 'string' || !isValidPolicyAsset(asset)) {
    throw new ValidationError(
      'asset must be XLM, a bare asset code, or CODE:ISSUER with a valid Stellar issuer.',
      { code: PARAMS_ERROR_CODE, details: { field: 'asset' } },
    );
  }
  const amount = record.amount;
  if (amount === undefined || !isPositiveAmount(amount)) {
    throw new ValidationError('amount must be a positive finite number or decimal string.', {
      code: PARAMS_ERROR_CODE,
      details: { field: 'amount' },
    });
  }

  // Optional transaction detail.
  const recipientAddress = record.recipientAddress;
  if (recipientAddress !== undefined) assertNonEmptyString(recipientAddress, 'recipientAddress');
  const senderAddress = record.senderAddress;
  if (senderAddress !== undefined) assertNonEmptyString(senderAddress, 'senderAddress');
  const memo = record.memo;
  if (memo !== undefined) assertNonEmptyString(memo, 'memo');
  const spentInWindow = record.spentInWindow;
  if (spentInWindow !== undefined && !isNonNegativeAmount(spentInWindow)) {
    throw new ValidationError(
      'spentInWindow must be a non-negative finite number or decimal string.',
      {
        code: PARAMS_ERROR_CODE,
        details: { field: 'spentInWindow' },
      },
    );
  }

  // Optional rule selection.
  const policyIds = record.policyIds;
  if (policyIds !== undefined) {
    if (
      !Array.isArray(policyIds) ||
      policyIds.length === 0 ||
      !policyIds.every((id) => typeof id === 'string' && id.trim() !== '')
    ) {
      throw new ValidationError('policyIds must be a non-empty array of non-empty strings.', {
        code: PARAMS_ERROR_CODE,
        details: { field: 'policyIds' },
      });
    }
  }
  const metadata = record.metadata;
  if (
    metadata !== undefined &&
    (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata))
  ) {
    throw new ValidationError('metadata must be a plain object.', {
      code: PARAMS_ERROR_CODE,
      details: { field: 'metadata' },
    });
  }

  // Normalized, trimmed request.
  return {
    ...(walletId !== undefined ? { walletId: (walletId as string).trim() } : {}),
    ...(agentId !== undefined ? { agentId: (agentId as string).trim() } : {}),
    asset: (asset as string).trim(),
    amount,
    ...(recipientAddress !== undefined
      ? { recipientAddress: (recipientAddress as string).trim() }
      : {}),
    ...(senderAddress !== undefined ? { senderAddress: (senderAddress as string).trim() } : {}),
    ...(memo !== undefined ? { memo: (memo as string).trim() } : {}),
    ...(spentInWindow !== undefined ? { spentInWindow } : {}),
    ...(policyIds !== undefined
      ? { policyIds: (policyIds as string[]).map((id) => id.trim()) }
      : {}),
    ...(metadata !== undefined ? { metadata: metadata as Record<string, unknown> } : {}),
  };
}

/* -------------------------------------------------------------------------- */
/* Fluent builder                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Fluent builder for {@link PolicySimulationRequest} parameters.
 *
 * Each `with*` / `for*` method sets a single field and returns `this`, so
 * parameters can be chained. Invalid inputs throw a {@link ValidationError}
 * immediately; {@link PolicySimulationBuilder.build} additionally runs the full
 * {@link validatePolicySimulationParams} check on the assembled request.
 *
 * @example
 * ```ts
 * const params = PolicySimulationBuilder.create()
 *   .forWallet('w_1')
 *   .withAsset('USDC')
 *   .withAmount('250')
 *   .toRecipient('GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW')
 *   .build();
 * ```
 */
export class PolicySimulationBuilder {
  private params: {
    walletId?: string;
    agentId?: string;
    asset?: string;
    amount?: string | number;
    recipientAddress?: string;
    senderAddress?: string;
    memo?: string;
    spentInWindow?: string | number;
    policyIds?: string[];
    metadata?: Record<string, unknown>;
  } = {};

  /** Start a new simulation-parameter builder. */
  static create(): PolicySimulationBuilder {
    return new PolicySimulationBuilder();
  }

  /** Scope the simulation to a wallet (clears any agent scoping). */
  forWallet(walletId: string): this {
    assertNonEmptyString(walletId, 'walletId');
    this.params.walletId = walletId.trim();
    delete this.params.agentId;
    return this;
  }

  /** Scope the simulation to an agent (clears any wallet scoping). */
  forAgent(agentId: string): this {
    assertNonEmptyString(agentId, 'agentId');
    this.params.agentId = agentId.trim();
    delete this.params.walletId;
    return this;
  }

  /** Set the asset to transfer (`XLM`, `USDC`, or `USDC:G…Issuer`). */
  withAsset(asset: string): this {
    if (!isValidPolicyAsset(asset)) {
      throw new ValidationError(
        'asset must be XLM, a bare asset code, or CODE:ISSUER with a valid Stellar issuer.',
        { code: PARAMS_ERROR_CODE, details: { field: 'asset' } },
      );
    }
    this.params.asset = asset.trim();
    return this;
  }

  /** Set the positive amount to transfer (number or decimal string). */
  withAmount(amount: string | number): this {
    if (!isPositiveAmount(amount)) {
      throw new ValidationError('amount must be a positive finite number or decimal string.', {
        code: PARAMS_ERROR_CODE,
        details: { field: 'amount' },
      });
    }
    this.params.amount = amount;
    return this;
  }

  /** Set the destination Stellar account (required by recipient rules). */
  toRecipient(recipientAddress: string): this {
    assertNonEmptyString(recipientAddress, 'recipientAddress');
    this.params.recipientAddress = recipientAddress.trim();
    return this;
  }

  /** Set the source Stellar account the spend is attributed to. */
  fromSender(senderAddress: string): this {
    assertNonEmptyString(senderAddress, 'senderAddress');
    this.params.senderAddress = senderAddress.trim();
    return this;
  }

  /** Attach an optional transaction memo. */
  withMemo(memo: string): this {
    assertNonEmptyString(memo, 'memo');
    this.params.memo = memo.trim();
    return this;
  }

  /** Record the amount already spent within the active budget window. */
  withSpentInWindow(spentInWindow: string | number): this {
    if (!isNonNegativeAmount(spentInWindow)) {
      throw new ValidationError(
        'spentInWindow must be a non-negative finite number or decimal string.',
        {
          code: PARAMS_ERROR_CODE,
          details: { field: 'spentInWindow' },
        },
      );
    }
    this.params.spentInWindow = spentInWindow;
    return this;
  }

  /** Restrict the evaluation to these policy rule ids. */
  withPolicyIds(...policyIds: string[]): this {
    if (policyIds.length === 0 || !policyIds.every((id) => id.trim() !== '')) {
      throw new ValidationError('policyIds must contain at least one non-empty string.', {
        code: PARAMS_ERROR_CODE,
        details: { field: 'policyIds' },
      });
    }
    this.params.policyIds = policyIds.map((id) => id.trim());
    return this;
  }

  /** Attach caller metadata echoed back by the API. */
  withMetadata(metadata: Record<string, unknown>): this {
    if (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata)) {
      throw new ValidationError('metadata must be a plain object.', {
        code: PARAMS_ERROR_CODE,
        details: { field: 'metadata' },
      });
    }
    this.params.metadata = metadata;
    return this;
  }

  /**
   * Produce the final, validated simulation request.
   *
   * @returns A {@link PolicySimulationRequest} accepted by
   *   `PolicyResource.simulatePolicy` and `simulatePolicy(client, input)`.
   * @throws {ValidationError} When any required parameter is missing or
   *   malformed.
   */
  build(): PolicySimulationRequest {
    return validatePolicySimulationParams(this.params);
  }
}

/** Convenience factory for {@link PolicySimulationBuilder}. */
export function simulationParams(): PolicySimulationBuilder {
  return new PolicySimulationBuilder();
}

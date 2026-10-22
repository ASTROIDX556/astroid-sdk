/**
 * `@astroid/policy` — fluent policy rule builder & validation utilities.
 *
 * Constructing a valid policy JSON document by hand is error-prone:
 * destination whitelists need Stellar-shaped public keys, spend caps must be
 * positive, and approval settings must agree with each other.
 * {@link PolicyRuleBuilder} offers a small, immutable, fully-typed API for
 * assembling a {@link PolicyDraft} — the exact payload accepted by
 * {@link PolicyResource.create} — while validating every parameter as it is
 * added and again as a whole before submission.
 *
 * Every mutator returns a **new** builder; the instance you call it on is never
 * changed, so a base rule can be forked safely. Built drafts copy their arrays,
 * so later builder calls cannot alter an earlier snapshot.
 *
 * @example
 * ```ts
 * import { PolicyRuleBuilder } from '@astroid/policy';
 *
 * const rule = new PolicyRuleBuilder('Treasury guardrails')
 *   .forAgent('agent_123')
 *   .allowDestination('GDEST…', 'GOTHER…')
 *   .maxAmount(500)
 *   .requireApproval()
 *   .build();
 *
 * await astroid.policies.create(rule);
 * ```
 *
 * @module
 */

import { ValidationError } from '@astroid/errors';
import type { Policy, PolicyConfiguration, PolicyType } from '@astroid/types';
import { PolicyCreateInputSchema } from './schemas.js';

/* -------------------------------------------------------------------------- */
/* Public types                                                                */
/* -------------------------------------------------------------------------- */

/**
 * A policy payload ready to be created: a {@link Policy} without the fields the
 * server owns (`id`, `organizationId`, timestamps).
 */
export type PolicyDraft = Omit<
  Policy,
  'id' | 'organizationId' | 'createdAt' | 'updatedAt' | 'deletedAt'
>;

/**
 * A draft whose `type` may still be inferred from its configuration. Used by
 * {@link validatePolicyRule} so an incomplete builder can be validated without
 * pretending it already has a type.
 */
export type PolicyDraftCandidate = Omit<PolicyDraft, 'type'> & { type?: PolicyType };

/** A single problem found while validating a policy rule. */
export interface PolicyValidationIssue {
  /** Dotted path to the offending field (e.g. `"configuration.allowedRecipients"`). */
  field: string;
  /** Human-readable explanation. */
  message: string;
}

/** Result of {@link PolicyRuleBuilder.validate}. */
export type PolicyRuleValidationResult =
  | { readonly valid: true; readonly issues: readonly PolicyValidationIssue[] }
  | { readonly valid: false; readonly issues: readonly PolicyValidationIssue[] };

/** Result of {@link PolicyRuleBuilder.safeBuild}. */
export type PolicyRuleBuildResult =
  | { readonly valid: true; readonly rule: PolicyDraft }
  | { readonly valid: false; readonly issues: readonly PolicyValidationIssue[] };

/** A time window during which the policy applies. */
export interface PolicyTimeWindow {
  /** Inclusive start (ISO-8601 or any `Date`-parseable string). */
  start: string;
  /** Exclusive end (ISO-8601 or any `Date`-parseable string). */
  end: string;
  /** Optional IANA timezone label (e.g. `"UTC"`). */
  timezone?: string;
}

/** Options accepted by the {@link PolicyRuleBuilder} constructor. */
export interface PolicyBuilderOptions {
  /** Human-readable policy name. */
  name?: string;
  /** Optional description. */
  description?: string;
  /** Scope the policy to a single agent. */
  agentId?: string | null;
  /** Evaluation priority (lower runs first). Defaults to `1`. */
  priority?: number;
  /** Whether the policy is active. Defaults to `true`. */
  enabled?: boolean;
  /** Force an explicit policy type instead of inferring one. */
  type?: PolicyType;
}

/** Alias of {@link PolicyBuilderOptions} using the builder's public name. */
export type PolicyRuleBuilderOptions = PolicyBuilderOptions;

/* -------------------------------------------------------------------------- */
/* Constants & format checks                                                   */
/* -------------------------------------------------------------------------- */

/** Stellar public key format: `G` followed by 55 base-32 characters. */
const STELLAR_PUBLIC_KEY_PATTERN = /^G[A-Z2-7]{55}$/;

/** Asset code: 1–12 alphanumeric characters (SEP-0011 Alphanumeric4/12). */
const ASSET_CODE_PATTERN = /^[A-Za-z0-9]{1,12}$/;

/** Policy amounts use Stellar's 7-decimal precision. */
const MAX_AMOUNT_DECIMALS = 7;

/**
 * Whether `value` is a syntactically valid Stellar public key (`G…`).
 *
 * This is a format check — it verifies the `G` prefix, length and base-32
 * alphabet, but not the CRC16 checksum. Policies are also validated server-side
 * against the full checksum before they are persisted. The policy package has
 * no Stellar SDK dependency, so this stays dependency-free.
 */
export function isValidPolicyAddress(value: unknown): value is string {
  return typeof value === 'string' && STELLAR_PUBLIC_KEY_PATTERN.test(value.trim());
}

/**
 * Whether `value` is a valid asset identifier: `XLM`, a bare asset code, or
 * `CODE:ISSUER` with a format-valid Stellar issuer.
 */
export function isValidPolicyAsset(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (trimmed === '') return false;
  if (trimmed.toUpperCase() === 'XLM') return true;

  const parts = trimmed.split(':');
  if (parts.length > 2) return false;
  const [code, issuer] = parts;
  if (!code || !ASSET_CODE_PATTERN.test(code)) return false;
  if (issuer !== undefined && !isValidPolicyAddress(issuer)) return false;
  return true;
}

/* -------------------------------------------------------------------------- */
/* Parameter guards                                                            */
/* -------------------------------------------------------------------------- */

/** Throw a {@link ValidationError} when `value` is not a valid Stellar address. */
function assertAddress(value: string, field: string): void {
  if (!isValidPolicyAddress(value)) {
    throw new ValidationError(`${field} must be a valid Stellar public key (G…).`, {
      code: 'INVALID_POLICY_ADDRESS',
      details: { field },
    });
  }
}

/** Throw a {@link ValidationError} when `value` is not a valid asset identifier. */
function assertAsset(value: string, field: string): void {
  if (!isValidPolicyAsset(value)) {
    throw new ValidationError(
      `${field} must be XLM, a bare asset code, or CODE:ISSUER with a valid Stellar issuer.`,
      { code: 'INVALID_POLICY_ASSET', details: { field } },
    );
  }
}

/** Number of decimal places in a finite number, without floating-point maths. */
function countDecimalPlaces(value: number): number {
  const text = value.toString();
  const [mantissa = '', exponentText] = text.split('e');
  const fraction = mantissa.split('.')[1] ?? '';
  if (exponentText === undefined) return fraction.length;
  return Math.max(0, fraction.length - Number(exponentText));
}

/** Throw a {@link ValidationError} when `value` is not a positive, 7-decimal amount. */
function assertPositiveAmount(value: number, field: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new ValidationError(`${field} must be a positive finite number.`, {
      code: 'INVALID_POLICY_AMOUNT',
      details: { field },
    });
  }
  const places = countDecimalPlaces(value);
  if (places > MAX_AMOUNT_DECIMALS) {
    throw new ValidationError(
      `${field} must have at most ${MAX_AMOUNT_DECIMALS} decimal places (received ${places}).`,
      { code: 'INVALID_POLICY_AMOUNT', details: { field } },
    );
  }
}

/** Throw a {@link ValidationError} when a signing threshold is not a positive integer. */
function assertRequiredSignatures(value: number): void {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new ValidationError('requiredSignatures must be a positive integer.', {
      code: 'INVALID_POLICY_APPROVAL',
      details: { field: 'requiredSignatures' },
    });
  }
}

/** Throw a {@link ValidationError} when the time window is malformed or unordered. */
function assertTimeWindow(window: PolicyTimeWindow): void {
  const start = Date.parse(window.start);
  const end = Date.parse(window.end);
  if (Number.isNaN(start)) {
    throw new ValidationError('timeWindow.start must be a parseable date string.', {
      code: 'INVALID_POLICY_TIME_WINDOW',
      details: { field: 'timeWindow.start' },
    });
  }
  if (Number.isNaN(end)) {
    throw new ValidationError('timeWindow.end must be a parseable date string.', {
      code: 'INVALID_POLICY_TIME_WINDOW',
      details: { field: 'timeWindow.end' },
    });
  }
  if (start >= end) {
    throw new ValidationError('timeWindow.start must be before timeWindow.end.', {
      code: 'INVALID_POLICY_TIME_WINDOW',
      details: { field: 'timeWindow' },
    });
  }
}

/* -------------------------------------------------------------------------- */
/* Rule-family inference                                                       */
/* -------------------------------------------------------------------------- */

/** Infer the most specific {@link PolicyType} for a configuration. */
function inferPolicyType(configuration: PolicyConfiguration): PolicyType | null {
  const families: PolicyType[] = [];
  if (configuration.maxAmount !== undefined) families.push('MAX_AMOUNT');
  if (configuration.minAmount !== undefined) families.push('MIN_AMOUNT');
  if (configuration.allowedRecipients?.length) families.push('ALLOWED_RECIPIENTS');
  if (configuration.blockedRecipients?.length) families.push('BLOCKED_RECIPIENTS');
  if (configuration.allowedAssets?.length) families.push('ALLOWED_ASSETS');
  if (configuration.blockedAssets?.length) families.push('BLOCKED_ASSETS');
  if (configuration.dailyLimit !== undefined) families.push('DAILY_BUDGET');
  if (configuration.weeklyLimit !== undefined) families.push('WEEKLY_BUDGET');
  if (configuration.monthlyLimit !== undefined) families.push('MONTHLY_BUDGET');
  if (configuration.timeWindow !== undefined) families.push('TIME_WINDOW');

  if (families.length === 0) return null;
  if (families.length === 1) {
    const [only] = families;
    if (only !== undefined) return only;
  }
  return 'COMPOSITE';
}

/* -------------------------------------------------------------------------- */
/* Validation                                                                  */
/* -------------------------------------------------------------------------- */

/** Configuration field each single-condition policy type requires. */
type RequiredConfigurationField =
  | 'maxAmount'
  | 'minAmount'
  | 'allowedAssets'
  | 'blockedAssets'
  | 'allowedRecipients'
  | 'blockedRecipients'
  | 'dailyLimit'
  | 'weeklyLimit'
  | 'monthlyLimit'
  | 'timeWindow';

const REQUIRED_CONFIGURATION_FIELD: Partial<Record<PolicyType, RequiredConfigurationField>> = {
  MAX_AMOUNT: 'maxAmount',
  MIN_AMOUNT: 'minAmount',
  ALLOWED_ASSETS: 'allowedAssets',
  BLOCKED_ASSETS: 'blockedAssets',
  ALLOWED_RECIPIENTS: 'allowedRecipients',
  BLOCKED_RECIPIENTS: 'blockedRecipients',
  DAILY_BUDGET: 'dailyLimit',
  WEEKLY_BUDGET: 'weeklyLimit',
  MONTHLY_BUDGET: 'monthlyLimit',
  TIME_WINDOW: 'timeWindow',
};

/** Build a field issue for a malformed amount, or `null` when it is valid. */
function amountIssue(value: unknown, field: string): PolicyValidationIssue | null {
  if (value === undefined) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return { field, message: `${field} must be a positive finite number.` };
  }
  const places = countDecimalPlaces(value);
  if (places > MAX_AMOUNT_DECIMALS) {
    return {
      field,
      message: `${field} must have at most ${MAX_AMOUNT_DECIMALS} decimal places (received ${places}).`,
    };
  }
  return null;
}

/**
 * Validate a policy draft without throwing. Returns every semantic issue found
 * (empty when the draft is valid) so callers can surface all problems at once.
 *
 * @param draft The policy payload to inspect.
 * @returns     A list of {@link PolicyValidationIssue}s.
 */
export function validatePolicyRule(draft: PolicyDraftCandidate): PolicyValidationIssue[] {
  const issues: PolicyValidationIssue[] = [];
  const config: PolicyConfiguration = draft.configuration ?? {};

  if (typeof draft.name !== 'string' || draft.name.trim() === '') {
    issues.push({ field: 'name', message: 'Policy name is required.' });
  }

  if (!draft.type) {
    issues.push({
      field: 'type',
      message: 'Policy type is required. Add at least one condition or pass an explicit type.',
    });
    if (Object.keys(config).length === 0) {
      issues.push({
        field: 'configuration',
        message: 'At least one rule condition is required.',
      });
    }
  } else {
    const required = REQUIRED_CONFIGURATION_FIELD[draft.type];
    if (required !== undefined && config[required] === undefined) {
      issues.push({
        field: `configuration.${required}`,
        message: `Policy type ${draft.type} requires ${required}.`,
      });
    }
  }

  if (typeof draft.priority !== 'number' || !Number.isFinite(draft.priority)) {
    issues.push({ field: 'priority', message: 'priority must be a finite number.' });
  }
  if (typeof draft.enabled !== 'boolean') {
    issues.push({ field: 'enabled', message: 'enabled must be a boolean.' });
  }

  for (const field of [
    'maxAmount',
    'minAmount',
    'dailyLimit',
    'weeklyLimit',
    'monthlyLimit',
  ] as const) {
    const issue = amountIssue(config[field], `configuration.${field}`);
    if (issue !== null) issues.push(issue);
  }

  if (
    typeof config.maxAmount === 'number' &&
    typeof config.minAmount === 'number' &&
    config.minAmount > config.maxAmount
  ) {
    issues.push({
      field: 'configuration.minAmount',
      message: 'minAmount must not exceed maxAmount.',
    });
  }

  const listChecks: ReadonlyArray<
    readonly [string, readonly string[] | undefined, (value: unknown) => value is string]
  > = [
    ['configuration.allowedRecipients', config.allowedRecipients, isValidPolicyAddress],
    ['configuration.blockedRecipients', config.blockedRecipients, isValidPolicyAddress],
    ['configuration.allowedAssets', config.allowedAssets, isValidPolicyAsset],
    ['configuration.blockedAssets', config.blockedAssets, isValidPolicyAsset],
  ];

  for (const [field, list, validator] of listChecks) {
    if (list === undefined) continue;
    if (list.length === 0) {
      issues.push({ field, message: `${field} must contain at least one entry.` });
      continue;
    }
    list.forEach((entry, index) => {
      if (!validator(entry)) {
        issues.push({ field: `${field}[${index}]`, message: `"${entry}" is not valid.` });
      }
    });
  }

  if (config.timeWindow) {
    const { start, end } = config.timeWindow;
    const startMs = typeof start === 'string' ? Date.parse(start) : Number.NaN;
    const endMs = typeof end === 'string' ? Date.parse(end) : Number.NaN;
    if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
      issues.push({
        field: 'configuration.timeWindow',
        message: 'timeWindow start/end must be parseable dates.',
      });
    } else if (startMs >= endMs) {
      issues.push({
        field: 'configuration.timeWindow',
        message: 'timeWindow.start must be before timeWindow.end.',
      });
    }
  }

  if (config.requiresApproval !== undefined && typeof config.requiresApproval !== 'boolean') {
    issues.push({
      field: 'configuration.requiresApproval',
      message: 'requiresApproval must be a boolean.',
    });
  }

  if (config.requiredSignatures !== undefined) {
    if (
      typeof config.requiredSignatures !== 'number' ||
      !Number.isInteger(config.requiredSignatures) ||
      config.requiredSignatures <= 0
    ) {
      issues.push({
        field: 'configuration.requiredSignatures',
        message: 'requiredSignatures must be a positive integer.',
      });
    } else if (config.requiresApproval === false) {
      issues.push({
        field: 'configuration.requiredSignatures',
        message: 'requiredSignatures cannot be set when requiresApproval is false.',
      });
    }
  }

  return issues;
}

/** Map Zod schema failures to the builder's field-issue shape. */
function schemaIssues(candidate: PolicyDraftCandidate): PolicyValidationIssue[] {
  if (candidate.type === undefined) return [];
  const result = PolicyCreateInputSchema.safeParse(candidate);
  if (result.success) return [];
  return result.error.issues.map((issue) => ({
    field: issue.path.length > 0 ? issue.path.map((segment) => String(segment)).join('.') : 'input',
    message: issue.message,
  }));
}

/** Run semantic validation first, then schema validation without duplicate fields. */
function collectValidationIssues(candidate: PolicyDraftCandidate): PolicyValidationIssue[] {
  const issues = validatePolicyRule(candidate);
  const seenFields = new Set(issues.map((issue) => issue.field));
  for (const issue of schemaIssues(candidate)) {
    if (seenFields.has(issue.field)) continue;
    seenFields.add(issue.field);
    issues.push(issue);
  }
  return issues;
}

/**
 * Validate a policy draft and throw a structured {@link ValidationError} when
 * it is invalid. Returns the draft unchanged on success, so it can be used
 * inline.
 *
 * @throws {ValidationError} With code `INVALID_POLICY_RULE` when invalid.
 */
export function assertValidPolicyRule(draft: PolicyDraft): PolicyDraft {
  const issues = collectValidationIssues(draft);
  if (issues.length > 0) {
    const summary = issues.map((issue) => `${issue.field}: ${issue.message}`).join('; ');
    throw new ValidationError(`Policy rule is invalid — ${summary}`, {
      code: 'INVALID_POLICY_RULE',
      details: { issues },
    });
  }
  return draft;
}

/* -------------------------------------------------------------------------- */
/* Immutable state helpers                                                     */
/* -------------------------------------------------------------------------- */

/** Internal builder snapshot. */
interface PolicyRuleBuilderState {
  name: string;
  description?: string;
  type?: PolicyType;
  configuration: PolicyConfiguration;
  priority: number;
  enabled: boolean;
  agentId?: string | null;
}

/** Deep-copy every array/object the builder owns. */
function cloneConfiguration(configuration: PolicyConfiguration): PolicyConfiguration {
  const clone: PolicyConfiguration = { ...configuration };
  if (configuration.allowedRecipients !== undefined) {
    clone.allowedRecipients = [...configuration.allowedRecipients];
  }
  if (configuration.blockedRecipients !== undefined) {
    clone.blockedRecipients = [...configuration.blockedRecipients];
  }
  if (configuration.allowedAssets !== undefined) {
    clone.allowedAssets = [...configuration.allowedAssets];
  }
  if (configuration.blockedAssets !== undefined) {
    clone.blockedAssets = [...configuration.blockedAssets];
  }
  if (configuration.timeWindow !== undefined) {
    clone.timeWindow = { ...configuration.timeWindow };
  }
  if (configuration.allowedHours !== undefined) {
    const hours = configuration.allowedHours;
    clone.allowedHours = {
      ...hours,
      ...(hours.days !== undefined ? { days: [...hours.days] } : {}),
    };
  }
  return clone;
}

/** Copy a builder state so no mutable value is shared. */
function cloneState(state: PolicyRuleBuilderState): PolicyRuleBuilderState {
  return { ...state, configuration: cloneConfiguration(state.configuration) };
}

/** Append values that are not already present, preserving insertion order. */
function appendUnique(
  existing: readonly string[] | undefined,
  additions: readonly string[],
): string[] {
  const result = existing === undefined ? [] : [...existing];
  for (const value of additions) {
    if (!result.includes(value)) result.push(value);
  }
  return result;
}

/* -------------------------------------------------------------------------- */
/* Fluent builder                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Immutable fluent builder for policy rules.
 *
 * Each method validates its own parameters, returns a **new** builder, and
 * leaves the receiver untouched. {@link PolicyRuleBuilder.build} resolves the
 * policy `type` (explicit, or inferred from the configured conditions, or
 * `COMPOSITE` when more than one family is used) and runs the full semantic +
 * schema validation before returning a deeply-copied {@link PolicyDraft}.
 *
 * Destination and asset lists deduplicate repeated entries while preserving
 * first-seen order. Addresses and assets are trimmed; duplicates are compared
 * after trimming.
 *
 * @example
 * ```ts
 * const base = new PolicyRuleBuilder('Payroll')
 *   .allowDestination(...teamAddresses)
 *   .maxAmount(10_000);
 *
 * const withApproval = base.requireApproval(true, 2);
 * const rule = withApproval.build();
 * // `base` is unchanged and can be forked again.
 * ```
 */
export class PolicyRuleBuilder {
  private state: PolicyRuleBuilderState;

  /**
   * @param nameOrOptions Policy name, or a {@link PolicyBuilderOptions} object.
   */
  constructor(nameOrOptions: string | PolicyBuilderOptions = {}) {
    const options: PolicyBuilderOptions =
      typeof nameOrOptions === 'string' ? { name: nameOrOptions } : nameOrOptions;

    this.state = {
      name: options.name ?? '',
      configuration: {},
      priority: options.priority ?? 1,
      enabled: options.enabled ?? true,
    };
    if (options.description !== undefined) this.state.description = options.description;
    if (options.type !== undefined) this.state.type = options.type;
    if (options.agentId !== undefined) this.state.agentId = options.agentId;
  }

  /** Start a new builder with the given name. */
  static create(name: string): PolicyRuleBuilder {
    return new PolicyRuleBuilder(name);
  }

  /** Return a new builder with a snapshot of `state`. */
  private static fromState(state: PolicyRuleBuilderState): PolicyRuleBuilder {
    const builder = new PolicyRuleBuilder(state.name);
    builder.state = cloneState(state);
    return builder;
  }

  /** Fork the current state, cloning the configuration. */
  private fork(overrides: Partial<PolicyRuleBuilderState>): PolicyRuleBuilder {
    return PolicyRuleBuilder.fromState({
      ...this.state,
      ...overrides,
      configuration: cloneConfiguration(overrides.configuration ?? this.state.configuration),
    });
  }

  /** Set the policy name. */
  withName(name: string): PolicyRuleBuilder {
    if (typeof name !== 'string' || name.trim() === '') {
      throw new ValidationError('Policy name is required.', { code: 'INVALID_POLICY_NAME' });
    }
    return this.fork({ name });
  }

  /** Set the optional description. */
  withDescription(description: string): PolicyRuleBuilder {
    return this.fork({ description });
  }

  /** Scope the policy to a single agent (`null` clears the scope). */
  forAgent(agentId: string | null): PolicyRuleBuilder {
    return this.fork({ agentId });
  }

  /** Set an explicit policy type, overriding inference. */
  ofType(type: PolicyType): PolicyRuleBuilder {
    return this.fork({ type });
  }

  /** Set the evaluation priority (lower runs first). */
  withPriority(priority: number): PolicyRuleBuilder {
    if (typeof priority !== 'number' || !Number.isFinite(priority) || priority < 0) {
      throw new ValidationError('priority must be a non-negative finite number.', {
        code: 'INVALID_POLICY_PRIORITY',
      });
    }
    return this.fork({ priority });
  }

  /** Enable or disable the policy. */
  enabled(enabled: boolean): PolicyRuleBuilder {
    return this.fork({ enabled: Boolean(enabled) });
  }

  /* ------------------------------ destinations ---------------------------- */

  /**
   * Allow one or more destinations (Stellar `G…` addresses).
   *
   * Accepts several arguments in one call and may be called repeatedly;
   * duplicates are ignored.
   */
  allowDestination(...addresses: string[]): PolicyRuleBuilder {
    if (addresses.length === 0) return this.fork({});
    const normalised = addresses.map((address) => {
      assertAddress(address, 'allowedRecipients');
      return address.trim();
    });
    return this.fork({
      configuration: {
        ...this.state.configuration,
        allowedRecipients: appendUnique(this.state.configuration.allowedRecipients, normalised),
      },
    });
  }

  /** Allow several destinations at once. Alias of {@link allowDestination}. */
  allowDestinations(...addresses: string[]): PolicyRuleBuilder {
    return this.allowDestination(...addresses);
  }

  /** Block one or more destinations (Stellar `G…` addresses). */
  denyDestination(...addresses: string[]): PolicyRuleBuilder {
    if (addresses.length === 0) return this.fork({});
    const normalised = addresses.map((address) => {
      assertAddress(address, 'blockedRecipients');
      return address.trim();
    });
    return this.fork({
      configuration: {
        ...this.state.configuration,
        blockedRecipients: appendUnique(this.state.configuration.blockedRecipients, normalised),
      },
    });
  }

  /** Block several destinations at once. Alias of {@link denyDestination}. */
  denyDestinations(...addresses: string[]): PolicyRuleBuilder {
    return this.denyDestination(...addresses);
  }

  /* -------------------------------- assets -------------------------------- */

  /**
   * Restrict transfers to one or more assets (`XLM`, a bare code, or
   * `CODE:ISSUER`). Duplicates are ignored.
   */
  allowAsset(...assets: string[]): PolicyRuleBuilder {
    if (assets.length === 0) return this.fork({});
    const normalised = assets.map((asset) => {
      assertAsset(asset, 'allowedAssets');
      return asset.trim();
    });
    return this.fork({
      configuration: {
        ...this.state.configuration,
        allowedAssets: appendUnique(this.state.configuration.allowedAssets, normalised),
      },
    });
  }

  /** Restrict transfers to several assets. Alias of {@link allowAsset}. */
  allowAssets(...assets: string[]): PolicyRuleBuilder {
    return this.allowAsset(...assets);
  }

  /** Block one or more assets. */
  denyAsset(...assets: string[]): PolicyRuleBuilder {
    if (assets.length === 0) return this.fork({});
    const normalised = assets.map((asset) => {
      assertAsset(asset, 'blockedAssets');
      return asset.trim();
    });
    return this.fork({
      configuration: {
        ...this.state.configuration,
        blockedAssets: appendUnique(this.state.configuration.blockedAssets, normalised),
      },
    });
  }

  /** Block several assets. Alias of {@link denyAsset}. */
  denyAssets(...assets: string[]): PolicyRuleBuilder {
    return this.denyAsset(...assets);
  }

  /* ------------------------------ spend limits ---------------------------- */

  /** Cap each individual transfer at `amount` (positive, at most 7 decimals). */
  maxAmount(amount: number): PolicyRuleBuilder {
    assertPositiveAmount(amount, 'maxAmount');
    return this.fork({
      configuration: { ...this.state.configuration, maxAmount: amount },
    });
  }

  /** Require each transfer to be at least `amount` (positive, at most 7 decimals). */
  minAmount(amount: number): PolicyRuleBuilder {
    assertPositiveAmount(amount, 'minAmount');
    const max = this.state.configuration.maxAmount;
    if (typeof max === 'number' && amount > max) {
      throw new ValidationError('minAmount must not exceed maxAmount.', {
        code: 'INVALID_POLICY_AMOUNT',
        details: { field: 'minAmount' },
      });
    }
    return this.fork({
      configuration: { ...this.state.configuration, minAmount: amount },
    });
  }

  /** Cap spend over a rolling day at `amount`. */
  dailyLimit(amount: number): PolicyRuleBuilder {
    assertPositiveAmount(amount, 'dailyLimit');
    return this.fork({
      configuration: { ...this.state.configuration, dailyLimit: amount },
    });
  }

  /** Cap spend over a rolling week at `amount`. */
  weeklyLimit(amount: number): PolicyRuleBuilder {
    assertPositiveAmount(amount, 'weeklyLimit');
    return this.fork({
      configuration: { ...this.state.configuration, weeklyLimit: amount },
    });
  }

  /** Cap spend over a rolling month at `amount`. */
  monthlyLimit(amount: number): PolicyRuleBuilder {
    assertPositiveAmount(amount, 'monthlyLimit');
    return this.fork({
      configuration: { ...this.state.configuration, monthlyLimit: amount },
    });
  }

  /**
   * Require human/agent approval before a transfer may proceed.
   *
   * @param required           Whether approval is required. Defaults to `true`.
   * @param requiredSignatures Optional signing-weight threshold (positive
   *                           integer) stored as `configuration.requiredSignatures`.
   */
  requireApproval(required: boolean = true, requiredSignatures?: number): PolicyRuleBuilder {
    if (typeof required !== 'boolean') {
      throw new ValidationError('requiresApproval must be a boolean.', {
        code: 'INVALID_POLICY_APPROVAL',
        details: { field: 'requiresApproval' },
      });
    }
    const configuration: PolicyConfiguration = {
      ...this.state.configuration,
      requiresApproval: required,
    };
    if (requiredSignatures !== undefined) {
      assertRequiredSignatures(requiredSignatures);
      configuration.requiredSignatures = requiredSignatures;
    }
    return this.fork({ configuration });
  }

  /**
   * Set the signing-weight threshold required for approval.
   *
   * Stored as `configuration.requiredSignatures`; pair it with
   * {@link requireApproval}.
   */
  requiredSignatures(count: number): PolicyRuleBuilder {
    assertRequiredSignatures(count);
    return this.fork({
      configuration: { ...this.state.configuration, requiredSignatures: count },
    });
  }

  /** Restrict the policy to an ordered time window. */
  timeWindow(window: PolicyTimeWindow): PolicyRuleBuilder {
    assertTimeWindow(window);
    return this.fork({
      configuration: {
        ...this.state.configuration,
        timeWindow: {
          start: window.start,
          end: window.end,
          ...(window.timezone !== undefined ? { timezone: window.timezone } : {}),
        },
      },
    });
  }

  /* -------------------------------- terminal ------------------------------ */

  /** Resolve the explicit or inferred policy type. */
  private resolveType(): PolicyType | undefined {
    return this.state.type ?? inferPolicyType(this.state.configuration) ?? undefined;
  }

  /** Build a deep-copied candidate draft. */
  private toCandidate(): PolicyDraftCandidate {
    const type = this.resolveType();
    return {
      name: this.state.name,
      ...(type !== undefined ? { type } : {}),
      configuration: cloneConfiguration(this.state.configuration),
      priority: this.state.priority,
      enabled: this.state.enabled,
      ...(this.state.description !== undefined ? { description: this.state.description } : {}),
      ...(this.state.agentId !== undefined ? { agentId: this.state.agentId } : {}),
    };
  }

  /**
   * Validate the accumulated rule without throwing and report **every**
   * problem, so a UI can show all issues at once.
   */
  validate(): PolicyRuleValidationResult {
    const issues = collectValidationIssues(this.toCandidate());
    return issues.length === 0 ? { valid: true, issues: [] } : { valid: false, issues };
  }

  /**
   * Validate and build without throwing.
   *
   * @returns `{ valid: true, rule }` on success, otherwise
   *          `{ valid: false, issues }` with every problem found.
   */
  safeBuild(): PolicyRuleBuildResult {
    const candidate = this.toCandidate();
    const issues = collectValidationIssues(candidate);
    if (issues.length > 0) return { valid: false, issues };
    if (candidate.type === undefined) {
      return {
        valid: false,
        issues: [{ field: 'type', message: 'Policy type is required.' }],
      };
    }
    // Rebuild explicitly (rather than spreading the rest and appending `type`)
    // so the serialized payload keeps the conventional key order.
    const rule: PolicyDraft = {
      name: candidate.name,
      type: candidate.type,
      configuration: candidate.configuration,
      priority: candidate.priority,
      enabled: candidate.enabled,
      ...(candidate.description !== undefined ? { description: candidate.description } : {}),
      ...(candidate.agentId !== undefined ? { agentId: candidate.agentId } : {}),
    };
    return { valid: true, rule };
  }

  /**
   * Produce the final, validated policy draft.
   *
   * @returns A {@link PolicyDraft} accepted by `PolicyResource.create`.
   * @throws {ValidationError} With code `INVALID_POLICY_RULE` when the rule is
   *   incomplete or any accumulated parameter is invalid.
   */
  build(): PolicyDraft {
    const result = this.safeBuild();
    if (!result.valid) {
      const summary = result.issues.map((issue) => `${issue.field}: ${issue.message}`).join('; ');
      throw new ValidationError(`Policy rule is invalid — ${summary}`, {
        code: 'INVALID_POLICY_RULE',
        details: { issues: result.issues },
      });
    }
    return result.rule;
  }

  /**
   * Serialise the validated rule, so `JSON.stringify(builder)` emits the same
   * payload as {@link build}.
   *
   * @throws {ValidationError} When the accumulated rule is invalid.
   */
  toJSON(): PolicyDraft {
    return this.build();
  }
}

/**
 * Backwards-compatible alias of {@link PolicyRuleBuilder}.
 *
 * @deprecated Use {@link PolicyRuleBuilder}; this alias is kept so existing
 * `PolicyBuilder` imports continue to type-check.
 */
export const PolicyBuilder = PolicyRuleBuilder;
export type PolicyBuilder = PolicyRuleBuilder;

/**
 * Convenience factory for {@link PolicyRuleBuilder}. Equivalent to
 * `new PolicyRuleBuilder(name)`.
 */
export function policy(name: string): PolicyRuleBuilder {
  return new PolicyRuleBuilder(name);
}

/**
 * `@astroid/policy` — input validation and sanitization helpers for policy configurations.
 *
 * Policies governing autonomous agent financial operations require strict structural
 * validation before being submitted to the Astroid API. This module validates and
 * sanitizes policy configuration objects on the client side, preventing malformed
 * payloads from reaching the network layer.
 *
 * @module
 */

import { ValidationError } from '@astroid/errors';
import type { PolicyConfiguration } from '@astroid/types';
import { isValidPolicyAddress, isValidPolicyAsset } from './builder.js';

/** Alias of PolicyConfiguration for naming consistency with acceptance criteria. */
export type PolicyConfig = PolicyConfiguration;

/** Error code shared by policy validation errors. */
export const POLICY_VALIDATION_ERROR_CODE = 'INVALID_POLICY_CONFIG';

/**
 * Validates and sanitizes a policy configuration object.
 *
 * Checks:
 * - Root configuration must be an object and not null or array.
 * - Required fields / parameters if provided are valid and non-empty.
 * - Numeric bounds on spending limits (maxAmount, minAmount, dailyLimit, weeklyLimit, monthlyLimit)
 *   must be finite non-negative numbers (> 0 or >= 0 as applicable, not NaN/Infinity, not negative).
 * - minAmount cannot exceed maxAmount if both are specified.
 * - Valid address formats for Stellar accounts (G... 56 chars base32 or StrKey contract C...) in
 *   allowedRecipients, blockedRecipients, or single recipient fields.
 * - Valid asset formats (XLM, bare code 1-12 chars, or CODE:ISSUER with valid Stellar address).
 * - Time window format (valid parseable start/end dates with start before end).
 * - Sanitizes string values by trimming whitespace.
 *
 * @param config The raw policy configuration to validate.
 * @returns The sanitized and typed PolicyConfig.
 * @throws {ValidationError} When the configuration violates structural or business rules.
 */
export function validatePolicyConfig(config: unknown): PolicyConfig {
  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    throw new ValidationError('Policy configuration must be a non-null object.', {
      code: POLICY_VALIDATION_ERROR_CODE,
      details: { field: 'config' },
    });
  }

  const raw = config as Record<string, unknown>;
  const sanitized: PolicyConfig = {};

  // Numeric limit bounds check
  const numericLimits: Array<keyof PolicyConfiguration & string> = [
    'maxAmount',
    'minAmount',
    'dailyLimit',
    'weeklyLimit',
    'monthlyLimit',
  ];

  for (const field of numericLimits) {
    if (raw[field] !== undefined) {
      const val = raw[field];
      if (typeof val !== 'number' || !Number.isFinite(val) || Number.isNaN(val) || val < 0) {
        throw new ValidationError(
          `Policy limit "${field}" must be a non-negative finite number, received: ${String(val)}`,
          {
            code: POLICY_VALIDATION_ERROR_CODE,
            details: { field, value: val },
          },
        );
      }
      sanitized[field] = val;
    }
  }

  // Cross-field check: minAmount <= maxAmount
  if (
    typeof sanitized.minAmount === 'number' &&
    typeof sanitized.maxAmount === 'number' &&
    sanitized.minAmount > sanitized.maxAmount
  ) {
    throw new ValidationError(
      `Policy "minAmount" (${sanitized.minAmount}) cannot exceed "maxAmount" (${sanitized.maxAmount}).`,
      {
        code: POLICY_VALIDATION_ERROR_CODE,
        details: { field: 'minAmount', minAmount: sanitized.minAmount, maxAmount: sanitized.maxAmount },
      },
    );
  }

  // Single asset check
  if (raw.asset !== undefined) {
    if (typeof raw.asset !== 'string' || raw.asset.trim() === '') {
      throw new ValidationError('Policy "asset" must be a non-empty string.', {
        code: POLICY_VALIDATION_ERROR_CODE,
        details: { field: 'asset' },
      });
    }
    const trimmedAsset = raw.asset.trim();
    if (!isValidPolicyAsset(trimmedAsset)) {
      throw new ValidationError(
        `Policy "asset" must be XLM, a valid asset code, or CODE:ISSUER, received: "${trimmedAsset}"`,
        {
          code: POLICY_VALIDATION_ERROR_CODE,
          details: { field: 'asset', value: trimmedAsset },
        },
      );
    }
    sanitized.asset = trimmedAsset;
  }

  // Allowed / Blocked assets lists
  for (const field of ['allowedAssets', 'blockedAssets'] as const) {
    if (raw[field] !== undefined) {
      const list = raw[field];
      if (!Array.isArray(list)) {
        throw new ValidationError(`Policy "${field}" must be an array of asset strings.`, {
          code: POLICY_VALIDATION_ERROR_CODE,
          details: { field },
        });
      }
      const sanitizedList: string[] = [];
      for (let i = 0; i < list.length; i++) {
        const item = list[i];
        if (typeof item !== 'string' || item.trim() === '') {
          throw new ValidationError(
            `Policy "${field}[${i}]" must be a non-empty string.`,
            {
              code: POLICY_VALIDATION_ERROR_CODE,
              details: { field: `${field}[${i}]` },
            },
          );
        }
        const trimmed = item.trim();
        if (!isValidPolicyAsset(trimmed)) {
          throw new ValidationError(
            `Policy "${field}[${i}]" contains invalid asset identifier: "${trimmed}"`,
            {
              code: POLICY_VALIDATION_ERROR_CODE,
              details: { field: `${field}[${i}]`, value: trimmed },
            },
          );
        }
        sanitizedList.push(trimmed);
      }
      sanitized[field] = sanitizedList;
    }
  }

  // Allowed / Blocked recipients lists (Stellar public keys G... or StrKey contract addresses C...)
  for (const field of ['allowedRecipients', 'blockedRecipients'] as const) {
    if (raw[field] !== undefined) {
      const list = raw[field];
      if (!Array.isArray(list)) {
        throw new ValidationError(`Policy "${field}" must be an array of Stellar addresses.`, {
          code: POLICY_VALIDATION_ERROR_CODE,
          details: { field },
        });
      }
      const sanitizedList: string[] = [];
      for (let i = 0; i < list.length; i++) {
        const item = list[i];
        if (typeof item !== 'string' || item.trim() === '') {
          throw new ValidationError(
            `Policy "${field}[${i}]" must be a non-empty string.`,
            {
              code: POLICY_VALIDATION_ERROR_CODE,
              details: { field: `${field}[${i}]` },
            },
          );
        }
        const trimmed = item.trim();
        if (!isValidPolicyAddress(trimmed)) {
          throw new ValidationError(
            `Policy "${field}[${i}]" must be a valid Stellar public key (G...), received: "${trimmed}"`,
            {
              code: POLICY_VALIDATION_ERROR_CODE,
              details: { field: `${field}[${i}]`, value: trimmed },
            },
          );
        }
        sanitizedList.push(trimmed);
      }
      sanitized[field] = sanitizedList;
    }
  }

  // Single recipientAddress if present
  if (raw.recipientAddress !== undefined) {
    if (typeof raw.recipientAddress !== 'string' || raw.recipientAddress.trim() === '') {
      throw new ValidationError('Policy "recipientAddress" must be a non-empty string.', {
        code: POLICY_VALIDATION_ERROR_CODE,
        details: { field: 'recipientAddress' },
      });
    }
    const trimmed = raw.recipientAddress.trim();
    if (!isValidPolicyAddress(trimmed)) {
      throw new ValidationError(
        `Policy "recipientAddress" must be a valid Stellar public key (G...), received: "${trimmed}"`,
        {
          code: POLICY_VALIDATION_ERROR_CODE,
          details: { field: 'recipientAddress', value: trimmed },
        },
      );
    }
    sanitized.recipientAddress = trimmed;
  }

  // Time window validation
  if (raw.timeWindow !== undefined) {
    if (raw.timeWindow === null || typeof raw.timeWindow !== 'object' || Array.isArray(raw.timeWindow)) {
      throw new ValidationError('Policy "timeWindow" must be an object with start and end date strings.', {
        code: POLICY_VALIDATION_ERROR_CODE,
        details: { field: 'timeWindow' },
      });
    }
    const tw = raw.timeWindow as Record<string, unknown>;
    if (typeof tw.start !== 'string' || tw.start.trim() === '') {
      throw new ValidationError('Policy "timeWindow.start" must be a non-empty date string.', {
        code: POLICY_VALIDATION_ERROR_CODE,
        details: { field: 'timeWindow.start' },
      });
    }
    if (typeof tw.end !== 'string' || tw.end.trim() === '') {
      throw new ValidationError('Policy "timeWindow.end" must be a non-empty date string.', {
        code: POLICY_VALIDATION_ERROR_CODE,
        details: { field: 'timeWindow.end' },
      });
    }

    const startMs = Date.parse(tw.start);
    const endMs = Date.parse(tw.end);
    if (Number.isNaN(startMs)) {
      throw new ValidationError('Policy "timeWindow.start" must be a parseable date string.', {
        code: POLICY_VALIDATION_ERROR_CODE,
        details: { field: 'timeWindow.start', value: tw.start },
      });
    }
    if (Number.isNaN(endMs)) {
      throw new ValidationError('Policy "timeWindow.end" must be a parseable date string.', {
        code: POLICY_VALIDATION_ERROR_CODE,
        details: { field: 'timeWindow.end', value: tw.end },
      });
    }
    if (startMs >= endMs) {
      throw new ValidationError('Policy "timeWindow.start" must be before "timeWindow.end".', {
        code: POLICY_VALIDATION_ERROR_CODE,
        details: { field: 'timeWindow' },
      });
    }

    sanitized.timeWindow = {
      start: tw.start.trim(),
      end: tw.end.trim(),
      ...(typeof tw.timezone === 'string' ? { timezone: tw.timezone.trim() } : {}),
    };
  }

  // Allowed hours validation
  if (raw.allowedHours !== undefined) {
    if (raw.allowedHours === null || typeof raw.allowedHours !== 'object' || Array.isArray(raw.allowedHours)) {
      throw new ValidationError('Policy "allowedHours" must be an object with startHour and endHour.', {
        code: POLICY_VALIDATION_ERROR_CODE,
        details: { field: 'allowedHours' },
      });
    }
    const ah = raw.allowedHours as Record<string, unknown>;
    const { startHour, endHour, days, timezone } = ah;
    if (
      typeof startHour !== 'number' ||
      !Number.isInteger(startHour) ||
      startHour < 0 ||
      startHour > 23
    ) {
      throw new ValidationError('Policy "allowedHours.startHour" must be an integer between 0 and 23.', {
        code: POLICY_VALIDATION_ERROR_CODE,
        details: { field: 'allowedHours.startHour', value: startHour },
      });
    }
    if (
      typeof endHour !== 'number' ||
      !Number.isInteger(endHour) ||
      endHour < 0 ||
      endHour > 23
    ) {
      throw new ValidationError('Policy "allowedHours.endHour" must be an integer between 0 and 23.', {
        code: POLICY_VALIDATION_ERROR_CODE,
        details: { field: 'allowedHours.endHour', value: endHour },
      });
    }
    if (days !== undefined) {
      if (!Array.isArray(days) || !days.every((d) => typeof d === 'number' && Number.isInteger(d) && d >= 0 && d <= 6)) {
        throw new ValidationError('Policy "allowedHours.days" must be an array of integers from 0 to 6.', {
          code: POLICY_VALIDATION_ERROR_CODE,
          details: { field: 'allowedHours.days' },
        });
      }
    }

    sanitized.allowedHours = {
      startHour,
      endHour,
      ...(days !== undefined ? { days: [...days] } : {}),
      ...(typeof timezone === 'string' ? { timezone: timezone.trim() } : {}),
    };
  }

  // requiredSignatures
  if (raw.requiredSignatures !== undefined) {
    const val = raw.requiredSignatures;
    if (typeof val !== 'number' || !Number.isInteger(val) || val <= 0) {
      throw new ValidationError('Policy "requiredSignatures" must be a positive integer.', {
        code: POLICY_VALIDATION_ERROR_CODE,
        details: { field: 'requiredSignatures', value: val },
      });
    }
    sanitized.requiredSignatures = val;
  }

  // requiresApproval
  if (raw.requiresApproval !== undefined) {
    if (typeof raw.requiresApproval !== 'boolean') {
      throw new ValidationError('Policy "requiresApproval" must be a boolean.', {
        code: POLICY_VALIDATION_ERROR_CODE,
        details: { field: 'requiresApproval', value: raw.requiresApproval },
      });
    }
    sanitized.requiresApproval = raw.requiresApproval;
  }

  // Pass-through any extra custom fields for JSONB flexibility
  for (const [key, val] of Object.entries(raw)) {
    if (!(key in sanitized)) {
      sanitized[key] = val;
    }
  }

  return sanitized;
}

/**
 * Type guard for checking if an unknown value satisfies {@link PolicyConfig}.
 *
 * @param config Value to test.
 * @returns true if valid, false otherwise.
 */
export function isValidPolicyConfig(config: unknown): config is PolicyConfig {
  try {
    validatePolicyConfig(config);
    return true;
  } catch {
    return false;
  }
}

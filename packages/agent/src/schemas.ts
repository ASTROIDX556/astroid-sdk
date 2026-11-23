/**
 * Zod schemas for `@astroid/agent` resource parameters.
 *
 * TypeScript types are erased at runtime, so a payload built from a form, a
 * JSON body, `localStorage` or a query string can still be malformed by the time
 * it reaches a resource method. These schemas validate the wire contract for
 * agent creation, updates and list queries **before** a request is dispatched,
 * and report the exact offending field instead of relying on a server `422`.
 *
 * The create/update schemas are the canonical DTO schemas shared with
 * `@astroid/types`, so the SDK and its consumers agree on one definition. The
 * query schema validates the filters accepted by `agents.list()` /
 * `agents.iterate()`. Parsing helpers throw {@link AstroidValidationError}, the
 * same typed error the resource methods already use, with the invalid field in
 * `details.field`.
 *
 * @module
 */

import {
  AGENT_ROLE_VALUES,
  AGENT_STATUS_VALUES,
  CreateAgentDtoSchema,
  UpdateAgentDtoSchema,
  type AgentRole,
  type AgentStatus,
  type CreateAgentParams,
  type ListAgentsParams,
  type UpdateAgentParams,
} from '@astroid/types';
import { z } from 'zod';

import { AstroidValidationError } from './errors.js';

/* -------------------------------------------------------------------------- */
/* Create / update schemas                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Schema for an agent creation payload (`POST /agents`).
 *
 * Alias of {@link CreateAgentDtoSchema} exported from this package so consumers
 * can validate a payload without importing `@astroid/types` directly.
 */
export const CreateAgentParamsSchema: z.ZodType<CreateAgentParams> = CreateAgentDtoSchema;

/**
 * Schema for an agent update payload (`PATCH /agents/:id`).
 *
 * Alias of {@link UpdateAgentDtoSchema}; at least one updatable field must be
 * present, and an empty patch is rejected before it costs a round trip.
 */
export const UpdateAgentParamsSchema: z.ZodType<UpdateAgentParams> = UpdateAgentDtoSchema;

/* -------------------------------------------------------------------------- */
/* Query schema                                                                */
/* -------------------------------------------------------------------------- */

/** A non-blank string, trimmed by the caller where relevant. */
const nonBlankString = z.string().refine((value) => value.trim() !== '', {
  message: 'Expected a non-blank string',
});

/**
 * Schema for the filter and pagination parameters of `agents.list()`.
 *
 * `page` and `limit` are 1-based positive integers, `status`/`role` must be
 * members of their respective enums, and the string filters must not be blank.
 * `cursor` and `page` are mutually exclusive keyset/offset pagination modes;
 * supplying both is rejected because the API cannot honour both at once.
 */
export const AgentQueryParamsSchema: z.ZodType<ListAgentsParams> = z
  .object({
    page: z.number().int().min(1, 'Expected "page" to be a positive integer').optional(),
    limit: z.number().int().min(1, 'Expected "limit" to be a positive integer').optional(),
    cursor: nonBlankString.optional(),
    order: z.enum(['asc', 'desc']).optional(),
    status: z
      .custom<AgentStatus>(
        (value) => typeof value === 'string' && (AGENT_STATUS_VALUES as readonly string[]).includes(value),
        { message: 'Expected a valid agent status' },
      )
      .optional(),
    role: z
      .custom<AgentRole>(
        (value) => typeof value === 'string' && (AGENT_ROLE_VALUES as readonly string[]).includes(value),
        { message: 'Expected a valid agent role' },
      )
      .optional(),
    tag: nonBlankString.optional(),
    search: nonBlankString.optional(),
  })
  .refine((value) => !(value.page !== undefined && value.cursor !== undefined), {
    message: 'Pass either "page" or "cursor", not both',
    path: ['cursor'],
  });

/* -------------------------------------------------------------------------- */
/* Error conversion                                                            */
/* -------------------------------------------------------------------------- */

/** Render a Zod issue path as the field-addressed notation used across the SDK. */
export function formatIssuePath(path: readonly PropertyKey[], fallback = '(root)'): string {
  if (path.length === 0) return fallback;
  let rendered = '';
  for (const segment of path) {
    if (typeof segment === 'number') {
      rendered += `[${segment}]`;
    } else {
      rendered += rendered === '' ? String(segment) : `.${String(segment)}`;
    }
  }
  return rendered || fallback;
}

/**
 * Convert a {@link z.ZodError} into an {@link AstroidValidationError}.
 *
 * The message names the first invalid field and repeats Zod's own explanation,
 * and `details` carries the field path, a stable `expected` code and every
 * issue found so a form can highlight multiple fields at once.
 *
 * @param error   The Zod error to convert.
 * @param action  The operation name used in the message (e.g. `create`).
 * @param input   The original input, for diagnostics when it is not an object.
 */
export function toAstroidValidationError(
  error: z.ZodError,
  action: string,
  input?: unknown,
): AstroidValidationError {
  const issues = error.issues.map((issue) => ({
    field: formatIssuePath(issue.path),
    code: issue.code,
    message: issue.message,
  }));
  const first = issues[0];
  const field = first?.field ?? '(root)';
  const reason = first?.message ?? 'Invalid value';
  const message =
    field === '(root)'
      ? `Agent validation failed (${action}): ${reason}.`
      : `Agent validation failed (${action}): "${field}" ${reason.replace(/^Expected /, 'must be ')}.`;

  return new AstroidValidationError(message, {
    field,
    expected: first?.code ?? 'invalid',
    received: input,
    issues,
  });
}

/* -------------------------------------------------------------------------- */
/* Parsing helpers                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Validate and narrow an agent creation payload with Zod.
 *
 * @param params The untrusted payload.
 * @returns      The validated payload.
 * @throws {AstroidValidationError} With the offending field in `details.field`.
 */
export function parseCreateAgentParams(params: unknown): CreateAgentParams {
  const result = CreateAgentParamsSchema.safeParse(params);
  if (!result.success) {
    throw toAstroidValidationError(result.error, 'create', params);
  }
  return result.data;
}

/**
 * Validate and narrow an agent update payload with Zod.
 *
 * @param params The untrusted payload.
 * @returns      The validated payload.
 * @throws {AstroidValidationError} With the offending field in `details.field`.
 */
export function parseUpdateAgentParams(params: unknown): UpdateAgentParams {
  const result = UpdateAgentParamsSchema.safeParse(params);
  if (!result.success) {
    throw toAstroidValidationError(result.error, 'update', params);
  }
  return result.data;
}

/**
 * Validate agent list/query parameters with Zod.
 *
 * @param params The untrusted query parameters (or `undefined` for defaults).
 * @returns      The validated parameters.
 * @throws {AstroidValidationError} With the offending field in `details.field`.
 */
export function parseAgentQueryParams(params: unknown = {}): ListAgentsParams {
  const result = AgentQueryParamsSchema.safeParse(params ?? {});
  if (!result.success) {
    throw toAstroidValidationError(result.error, 'query', params);
  }
  return result.data;
}

/**
 * Assert that an agent creation payload conforms to {@link CreateAgentParamsSchema}.
 *
 * @throws {AstroidValidationError} When the payload does not match the schema.
 */
export function assertValidCreateAgentSchema(params: unknown): asserts params is CreateAgentParams {
  parseCreateAgentParams(params);
}

/**
 * Assert that an agent update payload conforms to {@link UpdateAgentParamsSchema}.
 *
 * @throws {AstroidValidationError} When the payload does not match the schema.
 */
export function assertValidUpdateAgentSchema(params: unknown): asserts params is UpdateAgentParams {
  parseUpdateAgentParams(params);
}

/**
 * Assert that agent query parameters conform to {@link AgentQueryParamsSchema}.
 *
 * @throws {AstroidValidationError} When any parameter is invalid.
 */
export function assertValidAgentQueryParams(
  params: unknown,
): asserts params is ListAgentsParams | undefined {
  parseAgentQueryParams(params);
}

/** Inferred input type of {@link CreateAgentParamsSchema}. */
export type CreateAgentParamsInput = z.input<typeof CreateAgentParamsSchema>;

/** Inferred input type of {@link UpdateAgentParamsSchema}. */
export type UpdateAgentParamsInput = z.input<typeof UpdateAgentParamsSchema>;

/** Inferred type of {@link AgentQueryParamsSchema}. */
export type AgentQueryParams = z.infer<typeof AgentQueryParamsSchema>;

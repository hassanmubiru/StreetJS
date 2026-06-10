// src/enterprise/console/validators.ts
// Pure input validators for the Enterprise Console operations.
//
// Each validator returns a ValidationResult. On failure it names the offending
// `field` and a `message` so the rejection identifies the invalid input
// (Req 6.8). Validators never mutate state.

import type { DataClassificationLevel } from '../data-policy.js';
import type { ConsoleRequest, ValidationResult } from './types.js';

const CLASSIFICATION_LEVELS: ReadonlyArray<DataClassificationLevel> = [
  'public',
  'internal',
  'confidential',
  'restricted',
];

const AUDIT_FORMATS = ['jsonl', 'csv'] as const;
const USER_ACTIONS = ['create', 'update', 'disable'] as const;
const TENANT_STATUSES = ['active', 'suspended'] as const;

function fail(field: string, message: string): ValidationResult {
  return { ok: false, field, message };
}

/** Return the body as a plain object, or null if it is not one. */
function asObject(body: unknown): Record<string, unknown> | null {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return null;
  return body as Record<string, unknown>;
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

function isValidIsoDate(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && !Number.isNaN(Date.parse(v));
}

// ── Tenant ─────────────────────────────────────────────────────────────────────

export function validateCreateTenant(req: ConsoleRequest): ValidationResult {
  const body = asObject(req.body);
  if (!body) return fail('body', 'request body must be a JSON object');
  if (!isNonEmptyString(body['name'])) return fail('name', 'name is required and must be a non-empty string');
  if (body['plan'] !== undefined && typeof body['plan'] !== 'string') {
    return fail('plan', 'plan must be a string when provided');
  }
  if (body['connectionString'] !== undefined && typeof body['connectionString'] !== 'string') {
    return fail('connectionString', 'connectionString must be a string when provided');
  }
  const value: Record<string, unknown> = { name: (body['name'] as string).trim() };
  if (typeof body['plan'] === 'string') value['plan'] = body['plan'];
  if (typeof body['connectionString'] === 'string') value['connectionString'] = body['connectionString'];
  return { ok: true, value };
}

export function validateUpdateTenant(
  req: ConsoleRequest,
  params: Record<string, string>,
): ValidationResult {
  if (!isNonEmptyString(params['id'])) return fail('id', 'tenant id path parameter is required');
  const body = asObject(req.body);
  if (!body) return fail('body', 'request body must be a JSON object');

  const value: Record<string, unknown> = {};
  if (body['name'] !== undefined) {
    if (!isNonEmptyString(body['name'])) return fail('name', 'name must be a non-empty string');
    value['name'] = (body['name'] as string).trim();
  }
  if (body['plan'] !== undefined) {
    if (typeof body['plan'] !== 'string') return fail('plan', 'plan must be a string');
    value['plan'] = body['plan'];
  }
  if (body['status'] !== undefined) {
    if (!TENANT_STATUSES.includes(body['status'] as never)) {
      return fail('status', `status must be one of: ${TENANT_STATUSES.join(', ')}`);
    }
    value['status'] = body['status'];
  }
  if (Object.keys(value).length === 0) {
    return fail('body', 'at least one of name, plan, or status must be provided');
  }
  return { ok: true, value };
}

export function validateSuspendTenant(
  _req: ConsoleRequest,
  params: Record<string, string>,
): ValidationResult {
  if (!isNonEmptyString(params['id'])) return fail('id', 'tenant id path parameter is required');
  return { ok: true, value: {} };
}

// ── Policy ───────────────────────────────────────────────────────────────────

export function validateRbacPolicy(req: ConsoleRequest): ValidationResult {
  const body = asObject(req.body);
  if (!body) return fail('body', 'request body must be a JSON object');
  const roles = body['roles'];
  if (!Array.isArray(roles)) return fail('roles', 'roles must be an array');
  for (let i = 0; i < roles.length; i++) {
    const entry = asObject(roles[i]);
    if (!entry) return fail(`roles[${i}]`, 'each role entry must be an object');
    if (!isNonEmptyString(entry['role'])) return fail(`roles[${i}].role`, 'role must be a non-empty string');
    if (!isStringArray(entry['permissions'])) {
      return fail(`roles[${i}].permissions`, 'permissions must be an array of strings');
    }
  }
  return { ok: true, value: { roles } };
}

export function validateMfaPolicy(req: ConsoleRequest): ValidationResult {
  const body = asObject(req.body);
  if (!body) return fail('body', 'request body must be a JSON object');
  if (typeof body['required'] !== 'boolean') return fail('required', 'required must be a boolean');
  if (body['methods'] !== undefined && !isStringArray(body['methods'])) {
    return fail('methods', 'methods must be an array of strings when provided');
  }
  const value: Record<string, unknown> = { required: body['required'] };
  if (body['methods'] !== undefined) value['methods'] = body['methods'];
  return { ok: true, value };
}

export function validateRetentionPolicy(req: ConsoleRequest): ValidationResult {
  const body = asObject(req.body);
  if (!body) return fail('body', 'request body must be a JSON object');
  if (!isNonEmptyString(body['entity'])) return fail('entity', 'entity is required and must be a non-empty string');
  const days = body['retentionDays'];
  if (typeof days !== 'number' || !Number.isInteger(days) || days <= 0) {
    return fail('retentionDays', 'retentionDays must be a positive integer');
  }
  return { ok: true, value: { entity: (body['entity'] as string).trim(), retentionDays: days } };
}

export function validateClassificationPolicy(req: ConsoleRequest): ValidationResult {
  const body = asObject(req.body);
  if (!body) return fail('body', 'request body must be a JSON object');
  if (!isNonEmptyString(body['field'])) return fail('field', 'field is required and must be a non-empty string');
  if (!CLASSIFICATION_LEVELS.includes(body['level'] as never)) {
    return fail('level', `level must be one of: ${CLASSIFICATION_LEVELS.join(', ')}`);
  }
  return { ok: true, value: { field: (body['field'] as string).trim(), level: body['level'] } };
}

// ── Compliance ─────────────────────────────────────────────────────────────────

export function validateAuditExport(req: ConsoleRequest): ValidationResult {
  const body = asObject(req.body);
  if (!body) return fail('body', 'request body must be a JSON object');
  if (!isValidIsoDate(body['from'])) return fail('from', 'from must be a valid ISO-8601 date');
  if (!isValidIsoDate(body['to'])) return fail('to', 'to must be a valid ISO-8601 date');
  if (!AUDIT_FORMATS.includes(body['format'] as never)) {
    return fail('format', `format must be one of: ${AUDIT_FORMATS.join(', ')}`);
  }
  if (Date.parse(body['from'] as string) > Date.parse(body['to'] as string)) {
    return fail('from', 'from must not be after to');
  }
  return { ok: true, value: { from: body['from'], to: body['to'], format: body['format'] } };
}

/** Read-only operations accept no input and never fail validation. */
export function validateNoInput(): ValidationResult {
  return { ok: true, value: {} };
}

// ── Admin ───────────────────────────────────────────────────────────────────────

export function validateManageUser(req: ConsoleRequest): ValidationResult {
  const body = asObject(req.body);
  if (!body) return fail('body', 'request body must be a JSON object');
  if (!USER_ACTIONS.includes(body['action'] as never)) {
    return fail('action', `action must be one of: ${USER_ACTIONS.join(', ')}`);
  }
  if (!isNonEmptyString(body['userId'])) return fail('userId', 'userId is required and must be a non-empty string');
  if (body['roles'] !== undefined && !isStringArray(body['roles'])) {
    return fail('roles', 'roles must be an array of strings when provided');
  }
  const value: Record<string, unknown> = { action: body['action'], userId: (body['userId'] as string).trim() };
  if (body['roles'] !== undefined) value['roles'] = body['roles'];
  return { ok: true, value };
}

export function validateRotateKey(req: ConsoleRequest): ValidationResult {
  const body = asObject(req.body);
  if (!body) return fail('body', 'request body must be a JSON object');
  if (!isNonEmptyString(body['keyId'])) return fail('keyId', 'keyId is required and must be a non-empty string');
  return { ok: true, value: { keyId: (body['keyId'] as string).trim() } };
}

export function validateManageSecret(
  req: ConsoleRequest,
  params: Record<string, string>,
): ValidationResult {
  if (!isNonEmptyString(params['name'])) return fail('name', 'secret name path parameter is required');
  const body = asObject(req.body);
  if (!body) return fail('body', 'request body must be a JSON object');
  if (typeof body['value'] !== 'string' || body['value'].length === 0) {
    return fail('value', 'value is required and must be a non-empty string');
  }
  return { ok: true, value: { value: body['value'] } };
}

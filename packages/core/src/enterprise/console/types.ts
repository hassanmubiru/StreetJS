// src/enterprise/console/types.ts
// Shared types for the Enterprise Console REST surface.
//
// Zero runtime dependencies — Node core only. The console handlers reuse the
// framework's JwtService (security/jwt.ts) for authentication and a small RBAC
// model for authorization, and delegate all state mutations to a ConsoleBackend
// (backend.ts) which is wired to tenancy/enterprise services in production.

import type { DataClassificationLevel } from '../data-policy.js';

/** HTTP methods used by the Enterprise Console surface. */
export type ConsoleMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * A normalized request handed to the console. Decoupled from the HTTP server so
 * the handlers stay pure and testable: the production adapter maps a
 * StreetContext onto this shape, but tests can construct it directly.
 */
export interface ConsoleRequest {
  method: ConsoleMethod;
  /** Request path, e.g. `/api/admin/tenants/abc`. */
  path: string;
  /** Header map; keys are expected lower-cased (e.g. `authorization`). */
  headers: Record<string, string | undefined>;
  /** Parsed JSON body (or undefined for body-less requests). */
  body?: unknown;
}

/** A normalized response returned by the console. */
export interface ConsoleResponse {
  status: number;
  body: unknown;
}

/** The authenticated principal derived from a verified JWT. */
export interface ConsolePrincipal {
  id: string;
  email: string;
  roles: string[];
}

/**
 * Result of validating a request's input.
 * `ok: false` carries the offending `field` and a human-readable `message` so
 * the rejection identifies the invalid input (Req 6.8).
 */
export type ValidationResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; field: string; message: string };

/** Logical grouping used for authorization and OpenAPI tagging. */
export type ConsoleArea = 'tenant' | 'policy' | 'compliance' | 'admin';

/**
 * A single console operation: a method + path-pattern, the roles allowed to
 * invoke it, an input validator, and the action that performs the state change
 * against the backend. The lifecycle (authn → authz → validate → perform) is
 * enforced uniformly by EnterpriseConsole, never inside `perform`.
 */
export interface ConsoleRoute {
  operationId: string;
  area: ConsoleArea;
  method: ConsoleMethod;
  /** Path pattern with `:name` segments, e.g. `/api/admin/tenants/:id`. */
  pattern: string;
  summary: string;
  /** A principal is authorized iff it holds at least one of these roles. */
  requiredRoles: string[];
  /** Validate the request; on success returns the normalized value. */
  validate(req: ConsoleRequest, params: Record<string, string>): ValidationResult;
  /** Perform the operation after authn/authz/validation succeed. */
  perform(
    backend: ConsoleBackend,
    ctx: { principal: ConsolePrincipal; params: Record<string, string>; value: Record<string, unknown> },
  ): Promise<ConsoleResponse>;
}

// ── Backend operation payloads ─────────────────────────────────────────────────

export interface CreateTenantInput {
  name: string;
  plan?: string;
  connectionString?: string;
}

export interface UpdateTenantInput {
  name?: string;
  plan?: string;
  status?: 'active' | 'suspended';
}

export interface RbacPolicyInput {
  roles: Array<{ role: string; permissions: string[] }>;
}

export interface MfaPolicyInput {
  required: boolean;
  methods?: string[];
}

export interface RetentionPolicyInput {
  entity: string;
  retentionDays: number;
}

export interface ClassificationPolicyInput {
  field: string;
  level: DataClassificationLevel;
}

export interface AuditExportInput {
  from: string;
  to: string;
  format: 'jsonl' | 'csv';
}

export interface ManageUserInput {
  action: 'create' | 'update' | 'disable';
  userId: string;
  roles?: string[];
}

export interface RotateKeyInput {
  keyId: string;
}

export interface ManageSecretInput {
  value: string;
}

/**
 * State-mutating + read operations the console delegates to. In production this
 * is implemented over tenancy/provisioner, enterprise/data-policy,
 * enterprise/audit-logger, and cloud/secret-providers; an in-memory
 * implementation lives in backend.ts for tests and default wiring.
 */
export interface ConsoleBackend {
  // Tenant (Req 6.1)
  createTenant(input: CreateTenantInput): Promise<{ id: string }>;
  updateTenant(id: string, input: UpdateTenantInput): Promise<{ id: string }>;
  suspendTenant(id: string): Promise<{ id: string; status: 'suspended' }>;

  // Policy (Req 6.2)
  setRbacPolicy(input: RbacPolicyInput): Promise<void>;
  setMfaPolicy(input: MfaPolicyInput): Promise<void>;
  setRetentionPolicy(input: RetentionPolicyInput): Promise<void>;
  setClassificationPolicy(input: ClassificationPolicyInput): Promise<void>;

  // Compliance (Req 6.3)
  exportAudit(input: AuditExportInput): Promise<{ format: string; recordCount: number }>;
  generateComplianceReport(): Promise<{ generatedAt: string; entries: unknown[] }>;
  securityPosture(): Promise<Record<string, unknown>>;

  // Admin (Req 6.4)
  manageUser(input: ManageUserInput): Promise<{ userId: string; action: string }>;
  rotateKey(input: RotateKeyInput): Promise<{ keyId: string; rotatedAt: string }>;
  manageSecret(name: string, input: ManageSecretInput): Promise<{ name: string }>;
}

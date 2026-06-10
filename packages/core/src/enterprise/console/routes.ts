// src/enterprise/console/routes.ts
// The Enterprise Console route table. Maps the EnterpriseConsoleApi surface from
// the design (Components → Enterprise Console APIs) onto concrete operations,
// each with required roles, an input validator, and a backend action.
//
// Required roles follow a least-privilege RBAC model: a dedicated role per area
// plus the catch-all `admin`. Authorization succeeds if the principal holds any
// of an operation's roles.

import type {
  AuditExportInput,
  ClassificationPolicyInput,
  ConsoleRoute,
  CreateTenantInput,
  ManageSecretInput,
  ManageUserInput,
  MfaPolicyInput,
  RbacPolicyInput,
  RetentionPolicyInput,
  RotateKeyInput,
  UpdateTenantInput,
} from './types.js';
import {
  validateAuditExport,
  validateClassificationPolicy,
  validateCreateTenant,
  validateManageSecret,
  validateManageUser,
  validateMfaPolicy,
  validateNoInput,
  validateRbacPolicy,
  validateRetentionPolicy,
  validateRotateKey,
  validateSuspendTenant,
  validateUpdateTenant,
} from './validators.js';

const ROLE_ADMIN = 'admin';

export const CONSOLE_ROUTES: ConsoleRoute[] = [
  // ── Tenant (Req 6.1) ──────────────────────────────────────────────────────
  {
    operationId: 'createTenant',
    area: 'tenant',
    method: 'POST',
    pattern: '/api/admin/tenants',
    summary: 'Create a tenant',
    requiredRoles: [ROLE_ADMIN, 'tenant:write'],
    validate: (req) => validateCreateTenant(req),
    perform: async (backend, { value }) => {
      const result = await backend.createTenant(value as unknown as CreateTenantInput);
      return { status: 201, body: result };
    },
  },
  {
    operationId: 'updateTenant',
    area: 'tenant',
    method: 'PATCH',
    pattern: '/api/admin/tenants/:id',
    summary: 'Update a tenant',
    requiredRoles: [ROLE_ADMIN, 'tenant:write'],
    validate: (req, params) => validateUpdateTenant(req, params),
    perform: async (backend, { params, value }) => {
      const result = await backend.updateTenant(params['id']!, value as unknown as UpdateTenantInput);
      return { status: 200, body: result };
    },
  },
  {
    operationId: 'suspendTenant',
    area: 'tenant',
    method: 'POST',
    pattern: '/api/admin/tenants/:id/suspend',
    summary: 'Suspend a tenant',
    requiredRoles: [ROLE_ADMIN, 'tenant:write'],
    validate: (req, params) => validateSuspendTenant(req, params),
    perform: async (backend, { params }) => {
      const result = await backend.suspendTenant(params['id']!);
      return { status: 200, body: result };
    },
  },

  // ── Policy (Req 6.2) ──────────────────────────────────────────────────────
  {
    operationId: 'setRbacPolicy',
    area: 'policy',
    method: 'PUT',
    pattern: '/api/admin/policies/rbac',
    summary: 'Set the RBAC policy',
    requiredRoles: [ROLE_ADMIN, 'policy:write'],
    validate: (req) => validateRbacPolicy(req),
    perform: async (backend, { value }) => {
      await backend.setRbacPolicy(value as unknown as RbacPolicyInput);
      return { status: 200, body: { ok: true } };
    },
  },
  {
    operationId: 'setMfaPolicy',
    area: 'policy',
    method: 'PUT',
    pattern: '/api/admin/policies/mfa',
    summary: 'Set the MFA policy',
    requiredRoles: [ROLE_ADMIN, 'policy:write'],
    validate: (req) => validateMfaPolicy(req),
    perform: async (backend, { value }) => {
      await backend.setMfaPolicy(value as unknown as MfaPolicyInput);
      return { status: 200, body: { ok: true } };
    },
  },
  {
    operationId: 'setRetentionPolicy',
    area: 'policy',
    method: 'PUT',
    pattern: '/api/admin/policies/retention',
    summary: 'Set a data-retention policy',
    requiredRoles: [ROLE_ADMIN, 'policy:write'],
    validate: (req) => validateRetentionPolicy(req),
    perform: async (backend, { value }) => {
      await backend.setRetentionPolicy(value as unknown as RetentionPolicyInput);
      return { status: 200, body: { ok: true } };
    },
  },
  {
    operationId: 'setClassificationPolicy',
    area: 'policy',
    method: 'PUT',
    pattern: '/api/admin/policies/classification',
    summary: 'Set a data-classification policy',
    requiredRoles: [ROLE_ADMIN, 'policy:write'],
    validate: (req) => validateClassificationPolicy(req),
    perform: async (backend, { value }) => {
      await backend.setClassificationPolicy(value as unknown as ClassificationPolicyInput);
      return { status: 200, body: { ok: true } };
    },
  },

  // ── Compliance (Req 6.3) ──────────────────────────────────────────────────
  {
    operationId: 'exportAudit',
    area: 'compliance',
    method: 'GET',
    pattern: '/api/admin/compliance/audit-export',
    summary: 'Export audit records',
    requiredRoles: [ROLE_ADMIN, 'compliance:read'],
    validate: (req) => validateAuditExport(req),
    perform: async (backend, { value }) => {
      const result = await backend.exportAudit(value as unknown as AuditExportInput);
      return { status: 200, body: result };
    },
  },
  {
    operationId: 'generateComplianceReport',
    area: 'compliance',
    method: 'GET',
    pattern: '/api/admin/compliance/report',
    summary: 'Generate a compliance report',
    requiredRoles: [ROLE_ADMIN, 'compliance:read'],
    validate: () => validateNoInput(),
    perform: async (backend) => {
      const result = await backend.generateComplianceReport();
      return { status: 200, body: result };
    },
  },
  {
    operationId: 'securityPosture',
    area: 'compliance',
    method: 'GET',
    pattern: '/api/admin/compliance/posture',
    summary: 'Report security posture',
    requiredRoles: [ROLE_ADMIN, 'compliance:read'],
    validate: () => validateNoInput(),
    perform: async (backend) => {
      const result = await backend.securityPosture();
      return { status: 200, body: result };
    },
  },

  // ── Admin (Req 6.4) ───────────────────────────────────────────────────────
  {
    operationId: 'manageUser',
    area: 'admin',
    method: 'POST',
    pattern: '/api/admin/users',
    summary: 'Manage a user',
    requiredRoles: [ROLE_ADMIN, 'user:write'],
    validate: (req) => validateManageUser(req),
    perform: async (backend, { value }) => {
      const result = await backend.manageUser(value as unknown as ManageUserInput);
      return { status: 200, body: result };
    },
  },
  {
    operationId: 'rotateKey',
    area: 'admin',
    method: 'POST',
    pattern: '/api/admin/keys/rotate',
    summary: 'Rotate a signing/encryption key',
    requiredRoles: [ROLE_ADMIN, 'key:rotate'],
    validate: (req) => validateRotateKey(req),
    perform: async (backend, { value }) => {
      const result = await backend.rotateKey(value as unknown as RotateKeyInput);
      return { status: 200, body: result };
    },
  },
  {
    operationId: 'manageSecret',
    area: 'admin',
    method: 'PUT',
    pattern: '/api/admin/secrets/:name',
    summary: 'Create or update a secret',
    requiredRoles: [ROLE_ADMIN, 'secret:write'],
    validate: (req, params) => validateManageSecret(req, params),
    perform: async (backend, { params, value }) => {
      const result = await backend.manageSecret(params['name']!, value as unknown as ManageSecretInput);
      return { status: 200, body: result };
    },
  },
];

// src/enterprise/console/backend.ts
// ConsoleBackend implementations.
//
// `InMemoryConsoleBackend` is the default, dependency-free implementation used
// for tests and local wiring. It exposes `snapshot()` so callers can assert that
// rejected requests leave all state byte-for-byte unchanged (Req 6.8).
//
// `ServiceConsoleBackend` adapts the in-memory store onto the real
// tenancy/enterprise services (tenant provisioning, audit export, compliance
// reporting, secret rotation) so the same handlers run against production state.

import { randomUUID } from 'node:crypto';
import type {
  AuditExportInput,
  ClassificationPolicyInput,
  ConsoleBackend,
  CreateTenantInput,
  ManageSecretInput,
  ManageUserInput,
  MfaPolicyInput,
  RbacPolicyInput,
  RetentionPolicyInput,
  RotateKeyInput,
  UpdateTenantInput,
} from './types.js';

interface TenantRecord {
  id: string;
  name: string;
  plan: string | null;
  status: 'active' | 'suspended';
}

interface ConsoleState {
  tenants: Record<string, TenantRecord>;
  policies: {
    rbac: RbacPolicyInput | null;
    mfa: MfaPolicyInput | null;
    retention: Record<string, number>;
    classification: Record<string, string>;
  };
  users: Record<string, { roles: string[]; disabled: boolean }>;
  secrets: Record<string, string>;
  rotatedKeys: Record<string, string>;
}

function emptyState(): ConsoleState {
  return {
    tenants: {},
    policies: { rbac: null, mfa: null, retention: {}, classification: {} },
    users: {},
    secrets: {},
    rotatedKeys: {},
  };
}

/**
 * In-memory ConsoleBackend. All mutations are confined to `_state`, which can be
 * captured with `snapshot()` for state-unchanged assertions.
 */
export class InMemoryConsoleBackend implements ConsoleBackend {
  private _state: ConsoleState = emptyState();

  /** Deep, stable JSON snapshot of all console state. */
  snapshot(): string {
    return JSON.stringify(this._state);
  }

  async createTenant(input: CreateTenantInput): Promise<{ id: string }> {
    const id = randomUUID();
    this._state.tenants[id] = {
      id,
      name: input.name,
      plan: input.plan ?? null,
      status: 'active',
    };
    return { id };
  }

  async updateTenant(id: string, input: UpdateTenantInput): Promise<{ id: string }> {
    const existing = this._state.tenants[id];
    if (!existing) throw new ConsoleNotFoundError(`tenant ${id} not found`);
    if (input.name !== undefined) existing.name = input.name;
    if (input.plan !== undefined) existing.plan = input.plan;
    if (input.status !== undefined) existing.status = input.status;
    return { id };
  }

  async suspendTenant(id: string): Promise<{ id: string; status: 'suspended' }> {
    const existing = this._state.tenants[id];
    if (!existing) throw new ConsoleNotFoundError(`tenant ${id} not found`);
    existing.status = 'suspended';
    return { id, status: 'suspended' };
  }

  async setRbacPolicy(input: RbacPolicyInput): Promise<void> {
    this._state.policies.rbac = { roles: input.roles.map((r) => ({ role: r.role, permissions: [...r.permissions] })) };
  }

  async setMfaPolicy(input: MfaPolicyInput): Promise<void> {
    this._state.policies.mfa = { required: input.required, ...(input.methods ? { methods: [...input.methods] } : {}) };
  }

  async setRetentionPolicy(input: RetentionPolicyInput): Promise<void> {
    this._state.policies.retention[input.entity] = input.retentionDays;
  }

  async setClassificationPolicy(input: ClassificationPolicyInput): Promise<void> {
    this._state.policies.classification[input.field] = input.level;
  }

  async exportAudit(input: AuditExportInput): Promise<{ format: string; recordCount: number }> {
    // In-memory backend has no persisted audit log; report a zero-record export
    // of the requested format/window. The ServiceConsoleBackend streams real rows.
    return { format: input.format, recordCount: 0 };
  }

  async generateComplianceReport(): Promise<{ generatedAt: string; entries: unknown[] }> {
    const entries = Object.entries(this._state.policies.classification).map(([field, level]) => ({
      field,
      level,
      retentionDays: this._state.policies.retention[field] ?? null,
    }));
    return { generatedAt: new Date().toISOString(), entries };
  }

  async securityPosture(): Promise<Record<string, unknown>> {
    return {
      mfaRequired: this._state.policies.mfa?.required ?? false,
      rbacConfigured: this._state.policies.rbac !== null,
      tenantCount: Object.keys(this._state.tenants).length,
      retentionPolicies: Object.keys(this._state.policies.retention).length,
    };
  }

  async manageUser(input: ManageUserInput): Promise<{ userId: string; action: string }> {
    const existing = this._state.users[input.userId] ?? { roles: [], disabled: false };
    if (input.action === 'disable') {
      existing.disabled = true;
    } else {
      existing.disabled = false;
      if (input.roles) existing.roles = [...input.roles];
    }
    this._state.users[input.userId] = existing;
    return { userId: input.userId, action: input.action };
  }

  async rotateKey(input: RotateKeyInput): Promise<{ keyId: string; rotatedAt: string }> {
    const rotatedAt = new Date().toISOString();
    this._state.rotatedKeys[input.keyId] = rotatedAt;
    return { keyId: input.keyId, rotatedAt };
  }

  async manageSecret(name: string, input: ManageSecretInput): Promise<{ name: string }> {
    this._state.secrets[name] = input.value;
    return { name };
  }
}

/** Thrown by a backend when a referenced resource does not exist. */
export class ConsoleNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConsoleNotFoundError';
  }
}

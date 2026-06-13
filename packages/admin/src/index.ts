// packages/admin/src/index.ts
// Official Street Framework admin module: @streetjs/admin.
//
// A cohesive admin/back-office domain:
//   * User management   — create/list/suspend/activate/delete, role assignment.
//   * Roles & permissions (RBAC) — wildcard-aware permission grants.
//   * Authorization      — `can(userId, permission)` resolves a user's roles to
//                          permissions (suspended users are denied everything).
//   * Audit log          — every mutating admin action appends an immutable
//                          event; `auditLog` queries with filters + pagination.
//
// Permissions use a `domain:action` convention with `*` wildcards, e.g. a role
// granting `users:*` satisfies `users:read`, and `*` satisfies anything.
//
// State is in-memory for a single instance; the service is the seam for a
// persistent adapter (sibling @streetjs/* packages show the Postgres pattern).

import { randomUUID } from 'node:crypto';

// ── Types ─────────────────────────────────────────────────────────────────────

export type UserStatus = 'active' | 'suspended';

export interface AdminUser {
  id: string;
  email: string;
  status: UserStatus;
  roles: string[];
  createdAt: number;
}

export interface Role {
  name: string;
  permissions: string[];
}

export interface AuditEvent {
  id: string;
  actorId: string;
  action: string;
  target: string | null;
  metadata: Record<string, unknown>;
  createdAt: number;
  /** Monotonic ordering key. */
  seq: number;
}

export interface AuditQuery {
  actorId?: string;
  action?: string;
  target?: string;
  /** Only events with createdAt >= since. */
  since?: number;
  /** Only events with createdAt <= until. */
  until?: number;
  limit?: number;
  /** Only events with seq < before (older), for pagination. */
  before?: number;
}

export interface AdminServiceOptions {
  now?: () => number;
  idGen?: () => string;
}

/** Permission match: `granted` may use `*` wildcards (`users:*`, `*`, `*:read`). */
export function permissionMatches(granted: string, requested: string): boolean {
  if (granted === '*' || granted === requested) return true;
  const g = granted.split(':');
  const r = requested.split(':');
  if (g.length !== r.length) return false;
  return g.every((part, i) => part === '*' || part === r[i]);
}

// ── Service ─────────────────────────────────────────────────────────────────────

export class AdminService {
  private readonly users = new Map<string, AdminUser>();
  private readonly emailIndex = new Map<string, string>(); // email -> userId
  private readonly roles = new Map<string, Role>();
  private readonly audit: AuditEvent[] = [];
  private auditSeq = 0;

  private readonly now: () => number;
  private readonly idGen: () => string;

  constructor(options: AdminServiceOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.idGen = options.idGen ?? (() => randomUUID());
  }

  // ── Users ──────────────────────────────────────────────────────────────────

  createUser(actorId: string, input: { email: string; roles?: string[] }): AdminUser {
    requireId(actorId, 'actorId');
    const email = requireEmail(input?.email);
    if (this.emailIndex.has(email)) throw new Error(`A user with email "${email}" already exists`);
    for (const r of input.roles ?? []) this.requireRole(r);
    const user: AdminUser = {
      id: this.idGen(),
      email,
      status: 'active',
      roles: [...new Set(input.roles ?? [])],
      createdAt: this.now(),
    };
    this.users.set(user.id, user);
    this.emailIndex.set(email, user.id);
    this.appendAudit(actorId, 'user.create', user.id, { email });
    return clone(user);
  }

  getUser(id: string): AdminUser | undefined {
    const u = this.users.get(requireId(id, 'id'));
    return u ? clone(u) : undefined;
  }

  listUsers(filter: { status?: UserStatus; role?: string } = {}): AdminUser[] {
    return [...this.users.values()]
      .filter((u) => (!filter.status || u.status === filter.status) && (!filter.role || u.roles.includes(filter.role)))
      .map(clone)
      .sort((a, b) => (a.email < b.email ? -1 : a.email > b.email ? 1 : 0));
  }

  suspendUser(actorId: string, userId: string): AdminUser {
    requireId(actorId, 'actorId');
    const u = this.requireUser(userId);
    if (u.status !== 'suspended') {
      u.status = 'suspended';
      this.appendAudit(actorId, 'user.suspend', userId, {});
    }
    return clone(u);
  }

  activateUser(actorId: string, userId: string): AdminUser {
    requireId(actorId, 'actorId');
    const u = this.requireUser(userId);
    if (u.status !== 'active') {
      u.status = 'active';
      this.appendAudit(actorId, 'user.activate', userId, {});
    }
    return clone(u);
  }

  assignRole(actorId: string, userId: string, role: string): AdminUser {
    requireId(actorId, 'actorId');
    const u = this.requireUser(userId);
    this.requireRole(role);
    if (!u.roles.includes(role)) {
      u.roles.push(role);
      this.appendAudit(actorId, 'user.assignRole', userId, { role });
    }
    return clone(u);
  }

  revokeRole(actorId: string, userId: string, role: string): AdminUser {
    requireId(actorId, 'actorId');
    const u = this.requireUser(userId);
    const idx = u.roles.indexOf(role);
    if (idx >= 0) {
      u.roles.splice(idx, 1);
      this.appendAudit(actorId, 'user.revokeRole', userId, { role });
    }
    return clone(u);
  }

  deleteUser(actorId: string, userId: string): boolean {
    requireId(actorId, 'actorId');
    const u = this.users.get(requireId(userId, 'userId'));
    if (!u) return false;
    this.users.delete(u.id);
    this.emailIndex.delete(u.email);
    this.appendAudit(actorId, 'user.delete', userId, { email: u.email });
    return true;
  }

  // ── Roles & permissions ───────────────────────────────────────────────────────

  createRole(actorId: string, input: { name: string; permissions?: string[] }): Role {
    requireId(actorId, 'actorId');
    const name = requireNonEmpty(input?.name, 'name');
    if (this.roles.has(name)) throw new Error(`Role "${name}" already exists`);
    const role: Role = { name, permissions: [...new Set((input.permissions ?? []).map((p) => requireNonEmpty(p, 'permission')))] };
    this.roles.set(name, role);
    this.appendAudit(actorId, 'role.create', name, { permissions: role.permissions });
    return cloneRole(role);
  }

  getRole(name: string): Role | undefined {
    const r = this.roles.get(requireNonEmpty(name, 'name'));
    return r ? cloneRole(r) : undefined;
  }

  listRoles(): Role[] {
    return [...this.roles.values()].map(cloneRole).sort((a, b) => (a.name < b.name ? -1 : 1));
  }

  grantPermission(actorId: string, role: string, permission: string): Role {
    requireId(actorId, 'actorId');
    const r = this.requireRole(role);
    const perm = requireNonEmpty(permission, 'permission');
    if (!r.permissions.includes(perm)) {
      r.permissions.push(perm);
      this.appendAudit(actorId, 'role.grant', role, { permission: perm });
    }
    return cloneRole(r);
  }

  revokePermission(actorId: string, role: string, permission: string): Role {
    requireId(actorId, 'actorId');
    const r = this.requireRole(role);
    const idx = r.permissions.indexOf(permission);
    if (idx >= 0) {
      r.permissions.splice(idx, 1);
      this.appendAudit(actorId, 'role.revoke', role, { permission });
    }
    return cloneRole(r);
  }

  deleteRole(actorId: string, name: string): boolean {
    requireId(actorId, 'actorId');
    const role = this.roles.get(requireNonEmpty(name, 'name'));
    if (!role) return false;
    this.roles.delete(name);
    // Detach the role from any users that held it.
    for (const u of this.users.values()) {
      const idx = u.roles.indexOf(name);
      if (idx >= 0) u.roles.splice(idx, 1);
    }
    this.appendAudit(actorId, 'role.delete', name, {});
    return true;
  }

  // ── Authorization ───────────────────────────────────────────────────────────

  /** The effective (deduped) permission set a user has via its roles. */
  permissionsOf(userId: string): string[] {
    const u = this.users.get(requireId(userId, 'userId'));
    if (!u) return [];
    const perms = new Set<string>();
    for (const roleName of u.roles) {
      for (const p of this.roles.get(roleName)?.permissions ?? []) perms.add(p);
    }
    return [...perms].sort();
  }

  /**
   * Whether `userId` may perform `permission`. Suspended or unknown users are
   * always denied. Wildcards in granted permissions are honored.
   */
  can(userId: string, permission: string): boolean {
    const u = this.users.get(requireId(userId, 'userId'));
    if (!u || u.status !== 'active') return false;
    const requested = requireNonEmpty(permission, 'permission');
    for (const granted of this.permissionsOf(userId)) {
      if (permissionMatches(granted, requested)) return true;
    }
    return false;
  }

  // ── Audit viewer ──────────────────────────────────────────────────────────────

  /** Query the audit log, newest first, with filters and pagination. */
  auditLog(query: AuditQuery = {}): AuditEvent[] {
    const limit = query.limit && query.limit > 0 ? Math.floor(query.limit) : 100;
    const out: AuditEvent[] = [];
    for (let i = this.audit.length - 1; i >= 0 && out.length < limit; i--) {
      const e = this.audit[i]!;
      if (query.before !== undefined && e.seq >= query.before) continue;
      if (query.actorId && e.actorId !== query.actorId) continue;
      if (query.action && e.action !== query.action) continue;
      if (query.target && e.target !== query.target) continue;
      if (query.since !== undefined && e.createdAt < query.since) continue;
      if (query.until !== undefined && e.createdAt > query.until) continue;
      out.push({ ...e, metadata: { ...e.metadata } });
    }
    return out;
  }

  /** Total number of audit events recorded. */
  auditCount(): number {
    return this.audit.length;
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private appendAudit(actorId: string, action: string, target: string | null, metadata: Record<string, unknown>): void {
    this.audit.push({
      id: this.idGen(),
      actorId,
      action,
      target,
      metadata: { ...metadata },
      createdAt: this.now(),
      seq: ++this.auditSeq,
    });
  }

  private requireUser(id: string): AdminUser {
    const u = this.users.get(requireId(id, 'userId'));
    if (!u) throw new Error(`User "${id}" not found`);
    return u;
  }

  private requireRole(name: string): Role {
    const r = this.roles.get(requireNonEmpty(name, 'role'));
    if (!r) throw new Error(`Role "${name}" not found`);
    return r;
  }
}

// ── helpers ─────────────────────────────────────────────────────────────────────

function clone(u: AdminUser): AdminUser {
  return { ...u, roles: [...u.roles] };
}

function cloneRole(r: Role): Role {
  return { name: r.name, permissions: [...r.permissions] };
}

function requireId(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`AdminService: ${field} must be a non-empty string`);
  }
  return value;
}

function requireNonEmpty(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`AdminService: ${field} must be a non-empty string`);
  }
  return value;
}

function requireEmail(value: unknown): string {
  if (typeof value !== 'string' || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) {
    throw new Error('AdminService: a valid email is required');
  }
  return value.toLowerCase();
}

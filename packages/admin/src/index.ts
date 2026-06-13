// packages/admin/src/index.ts
// Official Street Framework admin module: @streetjs/admin.
//
// A cohesive admin/back-office domain over a pluggable async store:
//   * User management   — create/list/suspend/activate/delete, role assignment.
//   * Roles & permissions (RBAC) — wildcard-aware permission grants.
//   * Authorization      — `can(userId, permission)` resolves a user's roles to
//                          permissions (suspended users are denied everything).
//   * Audit log          — every mutating admin action appends an immutable
//                          event; `auditLog` queries with filters + pagination.
//
// Permissions use a `domain:action` convention with `*` wildcards. State lives
// behind {@link AdminStore}: {@link InMemoryAdminStore} (default) or the
// Postgres-backed adapter in ./pg.

import { randomUUID } from 'node:crypto';

import type { AdminUser, Role, AuditEvent, AuditQuery, UserStatus } from './types.js';
import { permissionMatches } from './types.js';
import { InMemoryAdminStore, type AdminStore } from './store.js';

export * from './types.js';
export * from './store.js';
export * from './pg.js';

export interface AdminServiceOptions {
  store?: AdminStore;
  now?: () => number;
  idGen?: () => string;
}

export class AdminService {
  private readonly store: AdminStore;
  private readonly now: () => number;
  private readonly idGen: () => string;

  constructor(options: AdminServiceOptions = {}) {
    this.store = options.store ?? new InMemoryAdminStore();
    this.now = options.now ?? (() => Date.now());
    this.idGen = options.idGen ?? (() => randomUUID());
  }

  // ── Users ──────────────────────────────────────────────────────────────────

  async createUser(actorId: string, input: { email: string; roles?: string[] }): Promise<AdminUser> {
    requireId(actorId, 'actorId');
    const email = requireEmail(input?.email);
    if (await this.store.getUserByEmail(email)) throw new Error(`A user with email "${email}" already exists`);
    for (const r of input.roles ?? []) await this.requireRole(r);
    const user: AdminUser = {
      id: this.idGen(),
      email,
      status: 'active',
      roles: [...new Set(input.roles ?? [])],
      createdAt: this.now(),
    };
    await this.store.insertUser(user);
    await this.appendAudit(actorId, 'user.create', user.id, { email });
    return user;
  }

  async getUser(id: string): Promise<AdminUser | undefined> {
    return this.store.getUser(requireId(id, 'id'));
  }

  async listUsers(filter: { status?: UserStatus; role?: string } = {}): Promise<AdminUser[]> {
    const all = await this.store.listUsers();
    return all
      .filter((u) => (!filter.status || u.status === filter.status) && (!filter.role || u.roles.includes(filter.role)))
      .sort((a, b) => (a.email < b.email ? -1 : a.email > b.email ? 1 : 0));
  }

  async suspendUser(actorId: string, userId: string): Promise<AdminUser> {
    requireId(actorId, 'actorId');
    const u = await this.requireUser(userId);
    if (u.status !== 'suspended') {
      u.status = 'suspended';
      await this.store.updateUser(u);
      await this.appendAudit(actorId, 'user.suspend', userId, {});
    }
    return u;
  }

  async activateUser(actorId: string, userId: string): Promise<AdminUser> {
    requireId(actorId, 'actorId');
    const u = await this.requireUser(userId);
    if (u.status !== 'active') {
      u.status = 'active';
      await this.store.updateUser(u);
      await this.appendAudit(actorId, 'user.activate', userId, {});
    }
    return u;
  }

  async assignRole(actorId: string, userId: string, role: string): Promise<AdminUser> {
    requireId(actorId, 'actorId');
    const u = await this.requireUser(userId);
    await this.requireRole(role);
    if (!u.roles.includes(role)) {
      u.roles.push(role);
      await this.store.updateUser(u);
      await this.appendAudit(actorId, 'user.assignRole', userId, { role });
    }
    return u;
  }

  async revokeRole(actorId: string, userId: string, role: string): Promise<AdminUser> {
    requireId(actorId, 'actorId');
    const u = await this.requireUser(userId);
    const idx = u.roles.indexOf(role);
    if (idx >= 0) {
      u.roles.splice(idx, 1);
      await this.store.updateUser(u);
      await this.appendAudit(actorId, 'user.revokeRole', userId, { role });
    }
    return u;
  }

  async deleteUser(actorId: string, userId: string): Promise<boolean> {
    requireId(actorId, 'actorId');
    const u = await this.store.getUser(requireId(userId, 'userId'));
    if (!u) return false;
    await this.store.deleteUser(u.id);
    await this.appendAudit(actorId, 'user.delete', userId, { email: u.email });
    return true;
  }

  // ── Roles & permissions ───────────────────────────────────────────────────────

  async createRole(actorId: string, input: { name: string; permissions?: string[] }): Promise<Role> {
    requireId(actorId, 'actorId');
    const name = requireNonEmpty(input?.name, 'name');
    if (await this.store.getRole(name)) throw new Error(`Role "${name}" already exists`);
    const role: Role = {
      name,
      permissions: [...new Set((input.permissions ?? []).map((p) => requireNonEmpty(p, 'permission')))],
    };
    await this.store.insertRole(role);
    await this.appendAudit(actorId, 'role.create', name, { permissions: role.permissions });
    return role;
  }

  async getRole(name: string): Promise<Role | undefined> {
    return this.store.getRole(requireNonEmpty(name, 'name'));
  }

  async listRoles(): Promise<Role[]> {
    return (await this.store.listRoles()).sort((a, b) => (a.name < b.name ? -1 : 1));
  }

  async grantPermission(actorId: string, role: string, permission: string): Promise<Role> {
    requireId(actorId, 'actorId');
    const r = await this.requireRole(role);
    const perm = requireNonEmpty(permission, 'permission');
    if (!r.permissions.includes(perm)) {
      r.permissions.push(perm);
      await this.store.updateRole(r);
      await this.appendAudit(actorId, 'role.grant', role, { permission: perm });
    }
    return r;
  }

  async revokePermission(actorId: string, role: string, permission: string): Promise<Role> {
    requireId(actorId, 'actorId');
    const r = await this.requireRole(role);
    const idx = r.permissions.indexOf(permission);
    if (idx >= 0) {
      r.permissions.splice(idx, 1);
      await this.store.updateRole(r);
      await this.appendAudit(actorId, 'role.revoke', role, { permission });
    }
    return r;
  }

  async deleteRole(actorId: string, name: string): Promise<boolean> {
    requireId(actorId, 'actorId');
    const role = await this.store.getRole(requireNonEmpty(name, 'name'));
    if (!role) return false;
    await this.store.deleteRole(name);
    // Detach the role from any users that held it.
    for (const u of await this.store.listUsers()) {
      const idx = u.roles.indexOf(name);
      if (idx >= 0) {
        u.roles.splice(idx, 1);
        await this.store.updateUser(u);
      }
    }
    await this.appendAudit(actorId, 'role.delete', name, {});
    return true;
  }

  // ── Authorization ───────────────────────────────────────────────────────────

  async permissionsOf(userId: string): Promise<string[]> {
    const u = await this.store.getUser(requireId(userId, 'userId'));
    if (!u) return [];
    const perms = new Set<string>();
    for (const roleName of u.roles) {
      const role = await this.store.getRole(roleName);
      for (const p of role?.permissions ?? []) perms.add(p);
    }
    return [...perms].sort();
  }

  async can(userId: string, permission: string): Promise<boolean> {
    const u = await this.store.getUser(requireId(userId, 'userId'));
    if (!u || u.status !== 'active') return false;
    const requested = requireNonEmpty(permission, 'permission');
    for (const granted of await this.permissionsOf(userId)) {
      if (permissionMatches(granted, requested)) return true;
    }
    return false;
  }

  // ── Audit viewer ──────────────────────────────────────────────────────────────

  async auditLog(query: AuditQuery = {}): Promise<AuditEvent[]> {
    return this.store.queryAudit(query);
  }

  async auditCount(): Promise<number> {
    return this.store.countAudit();
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private async appendAudit(actorId: string, action: string, target: string | null, metadata: Record<string, unknown>): Promise<void> {
    await this.store.appendAudit({ id: this.idGen(), actorId, action, target, metadata, createdAt: this.now() });
  }

  private async requireUser(id: string): Promise<AdminUser> {
    const u = await this.store.getUser(requireId(id, 'userId'));
    if (!u) throw new Error(`User "${id}" not found`);
    return u;
  }

  private async requireRole(name: string): Promise<Role> {
    const r = await this.store.getRole(requireNonEmpty(name, 'role'));
    if (!r) throw new Error(`Role "${name}" not found`);
    return r;
  }
}

// ── helpers ─────────────────────────────────────────────────────────────────────

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
  if (typeof value !== 'string' || !isValidEmail(value)) {
    throw new Error('AdminService: a valid email is required');
  }
  return value.toLowerCase();
}

/**
 * Linear, backtracking-free email shape check (avoids the polynomial ReDoS of
 * an `[^@\s]+@[^@\s]+\.[^@\s]+` style regex). Requires: exactly one `@`, a
 * non-empty local part, a domain containing a non-edge `.`, and no whitespace.
 */
function isValidEmail(value: string): boolean {
  if (/\s/.test(value)) return false; // single bounded scan, no backtracking
  const at = value.indexOf('@');
  if (at <= 0) return false; // '@' present and local part non-empty
  if (value.indexOf('@', at + 1) !== -1) return false; // exactly one '@'
  const domain = value.slice(at + 1);
  const dot = domain.indexOf('.');
  // domain must contain a '.' that is neither first nor last char.
  return dot > 0 && dot < domain.length - 1;
}

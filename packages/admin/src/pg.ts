// packages/admin/src/pg.ts
// Postgres-backed AdminStore. Roles/permissions and user role lists are stored
// as JSONB; the audit log uses a BIGINT IDENTITY for the monotonic seq. Apply
// ADMIN_MIGRATION_SQL once at bootstrap.

import type { AdminUser, Role, AuditEvent, AuditQuery } from './types.js';
import type { AdminStore, NewAuditEvent } from './store.js';

export const ADMIN_MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS street_admin_users (
  id         TEXT PRIMARY KEY,
  email      TEXT NOT NULL UNIQUE,
  status     TEXT NOT NULL,
  roles      JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS street_admin_roles (
  name        TEXT PRIMARY KEY,
  permissions JSONB NOT NULL DEFAULT '[]'::jsonb
);
CREATE TABLE IF NOT EXISTS street_admin_audit (
  seq        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id         TEXT NOT NULL,
  actor_id   TEXT NOT NULL,
  action     TEXT NOT NULL,
  target     TEXT,
  metadata   JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS street_admin_audit_actor_idx ON street_admin_audit (actor_id, seq DESC);
CREATE INDEX IF NOT EXISTS street_admin_audit_action_idx ON street_admin_audit (action, seq DESC);
`.trim();

export interface AdminPool {
  query(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: Record<string, unknown>[]; rowCount: number; command: string }>;
}

/** Postgres-backed {@link AdminStore} over {@link ADMIN_MIGRATION_SQL}. */
export class PgAdminStore implements AdminStore {
  constructor(private readonly pool: AdminPool) {}

  async insertUser(user: AdminUser): Promise<void> {
    await this.pool.query(
      `INSERT INTO street_admin_users (id, email, status, roles, created_at)
       VALUES ($1, $2, $3, $4::jsonb, $5)`,
      [user.id, user.email, user.status, JSON.stringify(user.roles), user.createdAt],
    );
  }

  async getUser(id: string): Promise<AdminUser | undefined> {
    const res = await this.pool.query(`SELECT * FROM street_admin_users WHERE id = $1`, [id]);
    return res.rows[0] ? rowToUser(res.rows[0]) : undefined;
  }

  async getUserByEmail(email: string): Promise<AdminUser | undefined> {
    const res = await this.pool.query(`SELECT * FROM street_admin_users WHERE email = $1`, [email]);
    return res.rows[0] ? rowToUser(res.rows[0]) : undefined;
  }

  async listUsers(): Promise<AdminUser[]> {
    const res = await this.pool.query(`SELECT * FROM street_admin_users`, []);
    return res.rows.map(rowToUser);
  }

  async updateUser(user: AdminUser): Promise<void> {
    await this.pool.query(
      `UPDATE street_admin_users SET email = $2, status = $3, roles = $4::jsonb WHERE id = $1`,
      [user.id, user.email, user.status, JSON.stringify(user.roles)],
    );
  }

  async deleteUser(id: string): Promise<boolean> {
    const res = await this.pool.query(`DELETE FROM street_admin_users WHERE id = $1`, [id]);
    return res.rowCount > 0;
  }

  async insertRole(role: Role): Promise<void> {
    await this.pool.query(
      `INSERT INTO street_admin_roles (name, permissions) VALUES ($1, $2::jsonb)`,
      [role.name, JSON.stringify(role.permissions)],
    );
  }

  async getRole(name: string): Promise<Role | undefined> {
    const res = await this.pool.query(`SELECT * FROM street_admin_roles WHERE name = $1`, [name]);
    return res.rows[0] ? rowToRole(res.rows[0]) : undefined;
  }

  async listRoles(): Promise<Role[]> {
    const res = await this.pool.query(`SELECT * FROM street_admin_roles`, []);
    return res.rows.map(rowToRole);
  }

  async updateRole(role: Role): Promise<void> {
    await this.pool.query(
      `UPDATE street_admin_roles SET permissions = $2::jsonb WHERE name = $1`,
      [role.name, JSON.stringify(role.permissions)],
    );
  }

  async deleteRole(name: string): Promise<boolean> {
    const res = await this.pool.query(`DELETE FROM street_admin_roles WHERE name = $1`, [name]);
    return res.rowCount > 0;
  }

  async appendAudit(event: NewAuditEvent): Promise<void> {
    await this.pool.query(
      `INSERT INTO street_admin_audit (id, actor_id, action, target, metadata, created_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
      [event.id, event.actorId, event.action, event.target, JSON.stringify(event.metadata), event.createdAt],
    );
  }

  async queryAudit(query: AuditQuery): Promise<AuditEvent[]> {
    const params: unknown[] = [];
    const clauses: string[] = [];
    const add = (v: unknown) => params.push(v);
    if (query.actorId) { add(query.actorId); clauses.push(`actor_id = $${params.length}`); }
    if (query.action) { add(query.action); clauses.push(`action = $${params.length}`); }
    if (query.target) { add(query.target); clauses.push(`target = $${params.length}`); }
    if (query.since !== undefined) { add(query.since); clauses.push(`created_at >= $${params.length}`); }
    if (query.until !== undefined) { add(query.until); clauses.push(`created_at <= $${params.length}`); }
    if (query.before !== undefined) { add(query.before); clauses.push(`seq < $${params.length}`); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const limit = query.limit && query.limit > 0 ? Math.floor(query.limit) : 100;
    add(limit);
    const res = await this.pool.query(
      `SELECT * FROM street_admin_audit ${where} ORDER BY seq DESC LIMIT $${params.length}`,
      params,
    );
    return res.rows.map(rowToAudit);
  }

  async countAudit(): Promise<number> {
    const res = await this.pool.query(`SELECT COUNT(*)::int AS n FROM street_admin_audit`, []);
    return Number(res.rows[0]?.['n'] ?? 0);
  }
}

function parseJsonArray(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === 'string' && raw.length > 0) return JSON.parse(raw) as string[];
  return [];
}

function parseJsonObject(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object') return raw as Record<string, unknown>;
  if (typeof raw === 'string' && raw.length > 0) return JSON.parse(raw) as Record<string, unknown>;
  return {};
}

function rowToUser(row: Record<string, unknown>): AdminUser {
  return {
    id: String(row['id']),
    email: String(row['email']),
    status: String(row['status']) === 'suspended' ? 'suspended' : 'active',
    roles: parseJsonArray(row['roles']),
    createdAt: Number(row['created_at']),
  };
}

function rowToRole(row: Record<string, unknown>): Role {
  return { name: String(row['name']), permissions: parseJsonArray(row['permissions']) };
}

function rowToAudit(row: Record<string, unknown>): AuditEvent {
  return {
    seq: Number(row['seq']),
    id: String(row['id']),
    actorId: String(row['actor_id']),
    action: String(row['action']),
    target: row['target'] == null ? null : String(row['target']),
    metadata: parseJsonObject(row['metadata']),
    createdAt: Number(row['created_at']),
  };
}

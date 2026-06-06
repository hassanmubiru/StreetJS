// src/auth/audit-writer.ts
// Append-only audit log writer and its migration SQL.

// ── Migration SQL ─────────────────────────────────────────────────────────────

/**
 * Creates the `street_audit_log` table with an append-only guarantee.
 *
 * The append-only protection is enforced by a trigger function that raises an
 * exception on any UPDATE or DELETE, paired with a BEFORE UPDATE OR DELETE
 * trigger. Both the function and trigger are created idempotently so the
 * migration can be re-run safely.
 */
export const AUDIT_LOG_MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS street_audit_log (
  id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  event      TEXT NOT NULL,
  actor_id   TEXT,
  ip         TEXT,
  user_agent TEXT,
  details    JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION street_audit_log_append_only()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'street_audit_log is append-only: % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS street_audit_log_append_only_trigger ON street_audit_log;
CREATE TRIGGER street_audit_log_append_only_trigger
  BEFORE UPDATE OR DELETE ON street_audit_log
  FOR EACH ROW
  EXECUTE FUNCTION street_audit_log_append_only();
`.trim();

// ── Pool type ─────────────────────────────────────────────────────────────────

interface AuditQueryResult {
  rows: Record<string, string | null>[];
  rowCount: number;
  command: string;
}

interface AuditConnection {
  query(sql: string, params?: unknown[]): Promise<AuditQueryResult>;
}

/** Minimal database pool surface required by {@link AuditWriter}. */
export interface AuditPool {
  query(sql: string, params?: unknown[]): Promise<AuditQueryResult>;
  transaction<T>(fn: (conn: AuditConnection) => Promise<T>): Promise<T>;
}

// ── Interfaces ────────────────────────────────────────────────────────────────

export type AuditEvent =
  | 'login_success'
  | 'login_failure'
  | 'logout'
  | 'token_refresh'
  | 'session_revoked'
  | 'permission_denied';

export interface AuditRecord {
  event: AuditEvent;
  actorId?: string;
  ip?: string;
  userAgent?: string;
  details?: Record<string, unknown>;
}

// ── AuditWriter ───────────────────────────────────────────────────────────────

export class AuditWriter {
  private readonly _pool: AuditPool;

  constructor(pool: AuditPool) {
    this._pool = pool;
  }

  /**
   * Write an audit log entry inside a transaction.
   * If the write fails, the error propagates so the calling transaction is
   * rolled back.
   */
  async write(record: AuditRecord): Promise<void> {
    await this._pool.transaction(async (conn) => {
      await conn.query(
        `INSERT INTO street_audit_log (event, actor_id, ip, user_agent, details)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          record.event,
          record.actorId ?? null,
          record.ip ?? null,
          record.userAgent ?? null,
          JSON.stringify(record.details ?? {}),
        ],
      );
    });
  }
}

// ── Auth-flow integration helpers ─────────────────────────────────────────────

/**
 * Contextual details captured for an audit event. These map onto the optional
 * columns of {@link AuditRecord} (everything except the fixed `event`), so an
 * application can wire an audit entry in a single call from a controller,
 * guard, or middleware without restating the event string.
 */
export type AuditEventDetails = Omit<AuditRecord, 'event'>;

/**
 * Write an audit entry for an authentication-related `event`.
 *
 * This is the single low-level seam the per-event helpers below build on. It
 * delegates to {@link AuditWriter.write}, so a failed write rejects and a
 * caller running inside its own transaction will roll back.
 */
export function auditAuthEvent(
  writer: AuditWriter,
  event: AuditEvent,
  details: AuditEventDetails = {},
): Promise<void> {
  return writer.write({ event, ...details });
}

/** Record a successful login (`login_success`). */
export function auditLoginSuccess(writer: AuditWriter, details: AuditEventDetails = {}): Promise<void> {
  return auditAuthEvent(writer, 'login_success', details);
}

/** Record a failed login attempt (`login_failure`). */
export function auditLoginFailure(writer: AuditWriter, details: AuditEventDetails = {}): Promise<void> {
  return auditAuthEvent(writer, 'login_failure', details);
}

/** Record a logout (`logout`). */
export function auditLogout(writer: AuditWriter, details: AuditEventDetails = {}): Promise<void> {
  return auditAuthEvent(writer, 'logout', details);
}

/** Record an access-token refresh / rotation (`token_refresh`). */
export function auditTokenRefresh(writer: AuditWriter, details: AuditEventDetails = {}): Promise<void> {
  return auditAuthEvent(writer, 'token_refresh', details);
}

/** Record a session revocation (`session_revoked`). */
export function auditSessionRevoked(writer: AuditWriter, details: AuditEventDetails = {}): Promise<void> {
  return auditAuthEvent(writer, 'session_revoked', details);
}

/** Record an authorization denial (`permission_denied`). */
export function auditPermissionDenied(writer: AuditWriter, details: AuditEventDetails = {}): Promise<void> {
  return auditAuthEvent(writer, 'permission_denied', details);
}

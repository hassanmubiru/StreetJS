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
// ── AuditWriter ───────────────────────────────────────────────────────────────
export class AuditWriter {
    _pool;
    constructor(pool) {
        this._pool = pool;
    }
    /**
     * Write an audit log entry inside a transaction.
     * If the write fails, the error propagates so the calling transaction is
     * rolled back.
     */
    async write(record) {
        await this._pool.transaction(async (conn) => {
            await conn.query(`INSERT INTO street_audit_log (event, actor_id, ip, user_agent, details)
         VALUES ($1, $2, $3, $4, $5)`, [
                record.event,
                record.actorId ?? null,
                record.ip ?? null,
                record.userAgent ?? null,
                JSON.stringify(record.details ?? {}),
            ]);
        });
    }
}
//# sourceMappingURL=audit-writer.js.map
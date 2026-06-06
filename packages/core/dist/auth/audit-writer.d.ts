/**
 * Creates the `street_audit_log` table with an append-only guarantee.
 *
 * The append-only protection is enforced by a trigger function that raises an
 * exception on any UPDATE or DELETE, paired with a BEFORE UPDATE OR DELETE
 * trigger. Both the function and trigger are created idempotently so the
 * migration can be re-run safely.
 */
export declare const AUDIT_LOG_MIGRATION_SQL: string;
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
export type AuditEvent = 'login_success' | 'login_failure' | 'logout' | 'token_refresh' | 'session_revoked' | 'permission_denied';
export interface AuditRecord {
    event: AuditEvent;
    actorId?: string;
    ip?: string;
    userAgent?: string;
    details?: Record<string, unknown>;
}
export declare class AuditWriter {
    private readonly _pool;
    constructor(pool: AuditPool);
    /**
     * Write an audit log entry inside a transaction.
     * If the write fails, the error propagates so the calling transaction is
     * rolled back.
     */
    write(record: AuditRecord): Promise<void>;
}
export {};
//# sourceMappingURL=audit-writer.d.ts.map
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
export declare function auditAuthEvent(writer: AuditWriter, event: AuditEvent, details?: AuditEventDetails): Promise<void>;
/** Record a successful login (`login_success`). */
export declare function auditLoginSuccess(writer: AuditWriter, details?: AuditEventDetails): Promise<void>;
/** Record a failed login attempt (`login_failure`). */
export declare function auditLoginFailure(writer: AuditWriter, details?: AuditEventDetails): Promise<void>;
/** Record a logout (`logout`). */
export declare function auditLogout(writer: AuditWriter, details?: AuditEventDetails): Promise<void>;
/** Record an access-token refresh / rotation (`token_refresh`). */
export declare function auditTokenRefresh(writer: AuditWriter, details?: AuditEventDetails): Promise<void>;
/** Record a session revocation (`session_revoked`). */
export declare function auditSessionRevoked(writer: AuditWriter, details?: AuditEventDetails): Promise<void>;
/** Record an authorization denial (`permission_denied`). */
export declare function auditPermissionDenied(writer: AuditWriter, details?: AuditEventDetails): Promise<void>;
export {};
//# sourceMappingURL=audit-writer.d.ts.map
import type { MiddlewareFn } from '../core/types.js';
export declare const SESSION_STORE_MIGRATION_SQL: string;
export declare const AUDIT_LOG_MIGRATION_SQL: string;
export interface SessionData {
    userId: string;
    data?: Record<string, unknown>;
    expiresAt?: Date;
}
export interface SessionStorePool {
    query(sql: string, params?: unknown[]): Promise<{
        rows: Record<string, string | null>[];
        rowCount: number;
        command: string;
    }>;
    transaction<T>(fn: (conn: {
        query(sql: string, params?: unknown[]): Promise<{
            rows: Record<string, string | null>[];
            rowCount: number;
            command: string;
        }>;
    }) => Promise<T>): Promise<T>;
}
export type AuditEvent = 'login_success' | 'login_failure' | 'logout' | 'token_refresh' | 'session_revoked' | 'permission_denied';
export interface AuditRecord {
    event: AuditEvent;
    actorId?: string;
    ip?: string;
    userAgent?: string;
    details?: Record<string, unknown>;
}
export declare class StreetSessionStore {
    private readonly _pool;
    /** LRU cache: sessionId → true (revoked) */
    private readonly _revokedCache;
    constructor(pool: SessionStorePool);
    /** Create a new session. Returns the sessionId. */
    create(data: SessionData): Promise<string>;
    /** Find a session by ID. Returns null if not found or expired. */
    find(sessionId: string): Promise<SessionData | null>;
    /** Revoke a session by ID. */
    revoke(sessionId: string): Promise<void>;
    /** Revoke all sessions for a user. */
    revokeAll(userId: string): Promise<void>;
    /** Check if a session is revoked (cache-first, DB fallback). */
    isRevoked(sessionId: string): Promise<boolean>;
}
/**
 * Middleware that checks session revocation on every authenticated request.
 * Expects `ctx.state['sessionId']` to be set by an upstream auth middleware.
 */
export declare function sessionRevocationMiddleware(store: StreetSessionStore): MiddlewareFn;
export declare class AuditWriter {
    private readonly _pool;
    constructor(pool: SessionStorePool);
    /**
     * Write an audit log entry inside a transaction.
     * If the write fails, the calling transaction is rolled back.
     */
    write(record: AuditRecord): Promise<void>;
}
//# sourceMappingURL=session-store.d.ts.map
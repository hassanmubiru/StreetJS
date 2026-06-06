import type { MiddlewareFn } from '../core/types.js';
export { AuditWriter, AUDIT_LOG_MIGRATION_SQL } from './audit-writer.js';
export type { AuditEvent, AuditRecord, AuditPool } from './audit-writer.js';
export { auditAuthEvent, auditLoginSuccess, auditLoginFailure, auditLogout, auditTokenRefresh, auditSessionRevoked, auditPermissionDenied, } from './audit-writer.js';
export type { AuditEventDetails } from './audit-writer.js';
import type { AuditWriter as AuditWriterType } from './audit-writer.js';
export declare const SESSION_STORE_MIGRATION_SQL: string;
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
/** Optional configuration for {@link StreetSessionStore}. */
export interface StreetSessionStoreOptions {
    /**
     * When provided, the store emits a `session_revoked` audit entry on every
     * {@link StreetSessionStore.revoke} and {@link StreetSessionStore.revokeAll}
     * call. Omitting it keeps the store's behaviour and dependencies unchanged.
     */
    auditWriter?: AuditWriterType;
}
export declare class StreetSessionStore {
    private readonly _pool;
    /** LRU cache: sessionId → true (revoked) */
    private readonly _revokedCache;
    /** Optional audit writer used to record `session_revoked` events. */
    private readonly _auditWriter?;
    constructor(pool: SessionStorePool, options?: StreetSessionStoreOptions);
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
//# sourceMappingURL=session-store.d.ts.map
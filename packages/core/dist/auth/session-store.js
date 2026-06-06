// src/auth/session-store.ts
// Server-side session store, revocation middleware, audit writer.
import * as crypto from 'node:crypto';
import { LruCache } from '../cache/lru.js';
import { UnauthorizedException } from '../http/exceptions.js';
// Re-export the audit log surface from its dedicated module so existing
// consumers (and index.ts) keep importing it from session-store unchanged.
export { AuditWriter, AUDIT_LOG_MIGRATION_SQL } from './audit-writer.js';
// ── Migration SQL ─────────────────────────────────────────────────────────────
export const SESSION_STORE_MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS street_sessions (
  session_id TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  data       JSONB NOT NULL DEFAULT '{}',
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS street_sessions_user_idx ON street_sessions (user_id);
`.trim();
// ── StreetSessionStore ────────────────────────────────────────────────────────
export class StreetSessionStore {
    _pool;
    /** LRU cache: sessionId → true (revoked) */
    _revokedCache;
    constructor(pool) {
        this._pool = pool;
        this._revokedCache = new LruCache({ maxEntries: 50_000, ttlMs: 5 * 60 * 1000 });
    }
    /** Create a new session. Returns the sessionId. */
    async create(data) {
        const sessionId = crypto.randomBytes(32).toString('base64url');
        const expiresAt = data.expiresAt ?? new Date(Date.now() + 24 * 60 * 60 * 1000);
        await this._pool.query(`INSERT INTO street_sessions (session_id, user_id, data, expires_at)
       VALUES ($1, $2, $3, $4)`, [sessionId, data.userId, JSON.stringify(data.data ?? {}), expiresAt.toISOString()]);
        return sessionId;
    }
    /** Find a session by ID. Returns null if not found or expired. */
    async find(sessionId) {
        const result = await this._pool.query('SELECT user_id, data, expires_at FROM street_sessions WHERE session_id = $1', [sessionId]);
        const row = result.rows[0];
        if (!row)
            return null;
        const expiresAt = row['expires_at'] ? new Date(row['expires_at']) : null;
        if (expiresAt && expiresAt < new Date())
            return null;
        return {
            userId: row['user_id'],
            data: row['data'] ? JSON.parse(row['data']) : {},
            expiresAt: expiresAt ?? undefined,
        };
    }
    /** Revoke a session by ID. */
    async revoke(sessionId) {
        await this._pool.query('DELETE FROM street_sessions WHERE session_id = $1', [sessionId]);
        this._revokedCache.set(sessionId, true);
    }
    /** Revoke all sessions for a user. */
    async revokeAll(userId) {
        const sessions = await this._pool.query('SELECT session_id FROM street_sessions WHERE user_id = $1', [userId]);
        await this._pool.query('DELETE FROM street_sessions WHERE user_id = $1', [userId]);
        for (const row of sessions.rows) {
            if (row['session_id']) {
                this._revokedCache.set(row['session_id'], true);
            }
        }
    }
    /** Check if a session is revoked (cache-first, DB fallback). */
    async isRevoked(sessionId) {
        const cached = this._revokedCache.get(sessionId);
        if (cached !== undefined)
            return cached;
        const result = await this._pool.query('SELECT session_id FROM street_sessions WHERE session_id = $1', [sessionId]);
        const revoked = result.rows.length === 0;
        if (revoked)
            this._revokedCache.set(sessionId, true);
        return revoked;
    }
}
// ── Session revocation middleware ─────────────────────────────────────────────
/**
 * Middleware that checks session revocation on every authenticated request.
 * Expects `ctx.state['sessionId']` to be set by an upstream auth middleware.
 */
export function sessionRevocationMiddleware(store) {
    return async (ctx, next) => {
        const sessionId = ctx.state?.['sessionId'];
        if (sessionId) {
            const revoked = await store.isRevoked(sessionId);
            if (revoked) {
                throw new UnauthorizedException('Session has been revoked');
            }
        }
        await next();
    };
}
//# sourceMappingURL=session-store.js.map
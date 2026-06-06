// src/auth/session-store.ts
// Server-side session store, revocation middleware, audit writer.

import * as crypto from 'node:crypto';
import type { MiddlewareFn } from '../core/types.js';
import { LruCache } from '../cache/lru.js';
import { UnauthorizedException } from '../http/exceptions.js';

// Re-export the audit log surface from its dedicated module so existing
// consumers (and index.ts) keep importing it from session-store unchanged.
export { AuditWriter, AUDIT_LOG_MIGRATION_SQL } from './audit-writer.js';
export type { AuditEvent, AuditRecord, AuditPool } from './audit-writer.js';

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

// ── Interfaces ────────────────────────────────────────────────────────────────

export interface SessionData {
  userId: string;
  data?: Record<string, unknown>;
  expiresAt?: Date;
}

export interface SessionStorePool {
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, string | null>[]; rowCount: number; command: string }>;
  transaction<T>(fn: (conn: { query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, string | null>[]; rowCount: number; command: string }> }) => Promise<T>): Promise<T>;
}

// ── StreetSessionStore ────────────────────────────────────────────────────────

export class StreetSessionStore {
  private readonly _pool: SessionStorePool;
  /** LRU cache: sessionId → true (revoked) */
  private readonly _revokedCache: LruCache<string, boolean>;

  constructor(pool: SessionStorePool) {
    this._pool = pool;
    this._revokedCache = new LruCache<string, boolean>({ maxEntries: 50_000, ttlMs: 5 * 60 * 1000 });
  }

  /** Create a new session. Returns the sessionId. */
  async create(data: SessionData): Promise<string> {
    const sessionId = crypto.randomBytes(32).toString('base64url');
    const expiresAt = data.expiresAt ?? new Date(Date.now() + 24 * 60 * 60 * 1000);

    await this._pool.query(
      `INSERT INTO street_sessions (session_id, user_id, data, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [sessionId, data.userId, JSON.stringify(data.data ?? {}), expiresAt.toISOString()],
    );

    return sessionId;
  }

  /** Find a session by ID. Returns null if not found or expired. */
  async find(sessionId: string): Promise<SessionData | null> {
    const result = await this._pool.query(
      'SELECT user_id, data, expires_at FROM street_sessions WHERE session_id = $1',
      [sessionId],
    );

    const row = result.rows[0];
    if (!row) return null;

    const expiresAt = row['expires_at'] ? new Date(row['expires_at']) : null;
    if (expiresAt && expiresAt < new Date()) return null;

    return {
      userId: row['user_id']!,
      data: row['data'] ? JSON.parse(row['data']) as Record<string, unknown> : {},
      expiresAt: expiresAt ?? undefined,
    };
  }

  /** Revoke a session by ID. */
  async revoke(sessionId: string): Promise<void> {
    await this._pool.query('DELETE FROM street_sessions WHERE session_id = $1', [sessionId]);
    this._revokedCache.set(sessionId, true);
  }

  /** Revoke all sessions for a user. */
  async revokeAll(userId: string): Promise<void> {
    const sessions = await this._pool.query(
      'SELECT session_id FROM street_sessions WHERE user_id = $1',
      [userId],
    );

    await this._pool.query('DELETE FROM street_sessions WHERE user_id = $1', [userId]);

    for (const row of sessions.rows) {
      if (row['session_id']) {
        this._revokedCache.set(row['session_id'], true);
      }
    }
  }

  /** Check if a session is revoked (cache-first, DB fallback). */
  async isRevoked(sessionId: string): Promise<boolean> {
    const cached = this._revokedCache.get(sessionId);
    if (cached !== undefined) return cached;

    const result = await this._pool.query(
      'SELECT session_id FROM street_sessions WHERE session_id = $1',
      [sessionId],
    );

    const revoked = result.rows.length === 0;
    if (revoked) this._revokedCache.set(sessionId, true);
    return revoked;
  }
}

// ── Session revocation middleware ─────────────────────────────────────────────

/**
 * Middleware that checks session revocation on every authenticated request.
 * Expects `ctx.state['sessionId']` to be set by an upstream auth middleware.
 */
export function sessionRevocationMiddleware(store: StreetSessionStore): MiddlewareFn {
  return async (ctx, next) => {
    const sessionId = ctx.state?.['sessionId'] as string | undefined;

    if (sessionId) {
      const revoked = await store.isRevoked(sessionId);
      if (revoked) {
        throw new UnauthorizedException('Session has been revoked');
      }
    }

    await next();
  };
}

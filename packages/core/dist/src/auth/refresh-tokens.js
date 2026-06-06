// src/auth/refresh-tokens.ts
// Refresh token issuance, rotation with replay-attack detection, and family revocation.
import * as crypto from 'node:crypto';
import { auditTokenRefresh } from './audit-writer.js';
// ── Migration SQL ─────────────────────────────────────────────────────────────
export const REFRESH_TOKENS_MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS street_refresh_tokens (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  token_hash  TEXT NOT NULL UNIQUE,
  family_id   TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS street_refresh_tokens_hash_idx ON street_refresh_tokens (token_hash);
CREATE INDEX IF NOT EXISTS street_refresh_tokens_family_idx ON street_refresh_tokens (family_id);
`.trim();
// ── Errors ────────────────────────────────────────────────────────────────────
export class TokenReplayError extends Error {
    constructor() {
        super('Refresh token replay detected — entire token family has been revoked');
        this.name = 'TokenReplayError';
    }
}
// ── RefreshTokenService ───────────────────────────────────────────────────────
export class RefreshTokenService {
    _pool;
    _jwt;
    _accessTtlMs;
    _refreshTtlMs;
    _auditWriter;
    constructor(pool, jwt, opts) {
        this._pool = pool;
        this._jwt = jwt;
        this._accessTtlMs = opts?.accessTokenTtlMs ?? 15 * 60 * 1000;
        this._refreshTtlMs = opts?.refreshTokenTtlMs ?? 30 * 24 * 60 * 60 * 1000;
        this._auditWriter = opts?.auditWriter;
    }
    /**
     * Issue a new access token + refresh token pair for `userId`.
     * If `familyId` is not provided, a new one is generated.
     */
    async issue(userId, familyId) {
        const family = familyId ?? crypto.randomBytes(16).toString('hex');
        const rawRefreshToken = crypto.randomBytes(32).toString('base64url');
        const tokenHash = crypto.createHash('sha256').update(rawRefreshToken).digest('hex');
        const expiresAt = new Date(Date.now() + this._refreshTtlMs);
        await this._pool.query(`INSERT INTO street_refresh_tokens (token_hash, family_id, user_id, expires_at)
       VALUES ($1, $2, $3, $4)`, [tokenHash, family, userId, expiresAt.toISOString()]);
        const accessToken = this._jwt.sign({ sub: userId }, { expiresInSeconds: Math.floor(this._accessTtlMs / 1000) });
        return { accessToken, refreshToken: rawRefreshToken };
    }
    /**
     * Rotate a refresh token.
     * Atomically invalidates the old token and issues new tokens.
     * On replay (already revoked), revokes the entire family and throws TokenReplayError.
     */
    async rotate(rawRefreshToken, auditContext = {}) {
        const tokenHash = crypto.createHash('sha256').update(rawRefreshToken).digest('hex');
        const result = await this._pool.transaction(async (conn) => {
            // Find the token
            const found = await conn.query(`SELECT id, family_id, user_id, expires_at, revoked_at
         FROM street_refresh_tokens WHERE token_hash = $1`, [tokenHash]);
            const row = found.rows[0];
            if (!row) {
                throw new Error('Refresh token not found');
            }
            // Replay attack: token already revoked
            if (row['revoked_at'] !== null) {
                // Revoke entire family
                await conn.query(`UPDATE street_refresh_tokens SET revoked_at = NOW() WHERE family_id = $1 AND revoked_at IS NULL`, [row['family_id']]);
                throw new TokenReplayError();
            }
            // Check expiry
            const expiresAt = row['expires_at'] ? new Date(row['expires_at']) : null;
            if (expiresAt && expiresAt < new Date()) {
                throw new Error('Refresh token expired');
            }
            // Revoke old token
            await conn.query(`UPDATE street_refresh_tokens SET revoked_at = NOW() WHERE id = $1`, [row['id']]);
            const userId = row['user_id'];
            const familyId = row['family_id'];
            // Issue new token pair
            const newRaw = crypto.randomBytes(32).toString('base64url');
            const newHash = crypto.createHash('sha256').update(newRaw).digest('hex');
            const newExpiry = new Date(Date.now() + this._refreshTtlMs);
            await conn.query(`INSERT INTO street_refresh_tokens (token_hash, family_id, user_id, expires_at)
         VALUES ($1, $2, $3, $4)`, [newHash, familyId, userId, newExpiry.toISOString()]);
            const accessToken = this._jwt.sign({ sub: userId }, { expiresInSeconds: Math.floor(this._accessTtlMs / 1000) });
            return { accessToken, refreshToken: newRaw, userId, familyId };
        });
        // Record the successful rotation. Written after the rotation transaction
        // commits so the audit entry reflects a completed refresh; a failed audit
        // write still propagates to the caller.
        if (this._auditWriter) {
            await auditTokenRefresh(this._auditWriter, {
                actorId: result.userId,
                ...auditContext,
                details: { familyId: result.familyId, ...(auditContext.details ?? {}) },
            });
        }
        return { accessToken: result.accessToken, refreshToken: result.refreshToken };
    }
    /**
     * Revoke all refresh tokens in a family (used on replay detection or explicit logout).
     */
    async revokeFamily(familyId) {
        await this._pool.query(`UPDATE street_refresh_tokens SET revoked_at = NOW() WHERE family_id = $1`, [familyId]);
    }
    /**
     * Revoke all refresh tokens for a user.
     */
    async revokeAll(userId) {
        await this._pool.query(`UPDATE street_refresh_tokens SET revoked_at = NOW() WHERE user_id = $1`, [userId]);
    }
}
//# sourceMappingURL=refresh-tokens.js.map
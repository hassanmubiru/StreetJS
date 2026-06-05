// src/auth/api-keys.ts
// API key generation, verification, and revocation with SHA-256 hashing
// and LRU caching for 60-second lookup results.
import * as crypto from 'node:crypto';
import { LruCache } from '../cache/lru.js';
import { UnauthorizedException } from '../http/exceptions.js';
// ── Migration SQL ─────────────────────────────────────────────────────────────
export const API_KEYS_MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS street_api_keys (
  id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  key_hash   TEXT NOT NULL UNIQUE,
  prefix     TEXT NOT NULL,
  name       TEXT NOT NULL,
  owner_id   TEXT NOT NULL,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS street_api_keys_hash_idx ON street_api_keys (key_hash);
`.trim();
// ── ApiKeyService ──────────────────────────────────────────────────────────────
const CACHE_TTL_MS = 60_000;
const CACHE_MAX = 10_000;
export class ApiKeyService {
    _pool;
    /** LRU cache: SHA-256 hex hash → ApiKey or null (null means "not found/expired") */
    _cache;
    constructor(pool) {
        this._pool = pool;
        this._cache = new LruCache({ maxEntries: CACHE_MAX, ttlMs: CACHE_TTL_MS });
    }
    /**
     * Generate a new API key. Returns the raw key ONCE — only the hash is stored.
     */
    async generate(opts) {
        const namespace = opts.prefix ?? 'sk_live_';
        const raw = namespace + crypto.randomBytes(32).toString('base64url');
        const keyHash = crypto.createHash('sha256').update(raw).digest('hex');
        const params = opts.expiresAt
            ? [keyHash, namespace, opts.name, opts.ownerId, opts.expiresAt.toISOString()]
            : [keyHash, namespace, opts.name, opts.ownerId, null];
        const result = await this._pool.query(`INSERT INTO street_api_keys (key_hash, prefix, name, owner_id, expires_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, key_hash, prefix, name, owner_id, expires_at, created_at`, params);
        const row = result.rows[0];
        const record = _rowToApiKey(row);
        return { key: raw, record };
    }
    /**
     * Verify a raw API key. Returns the ApiKey record or null if invalid/expired.
     * Uses constant-time comparison to prevent timing attacks.
     */
    async verify(rawKey) {
        const hash = crypto.createHash('sha256').update(rawKey).digest('hex');
        // Check LRU cache first
        const cached = this._cache.get(hash);
        if (cached !== undefined)
            return cached;
        const result = await this._pool.query(`SELECT id, key_hash, prefix, name, owner_id, expires_at, created_at
       FROM street_api_keys WHERE key_hash = $1`, [hash]);
        const row = result.rows[0];
        if (!row) {
            this._cache.set(hash, null);
            return null;
        }
        const apiKey = _rowToApiKey(row);
        // Check expiry
        if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
            this._cache.set(hash, null);
            return null;
        }
        // Constant-time hash comparison — both buffers are SHA-256 digests (always
        // 32 bytes), so no length pre-check is needed or performed.  A length
        // mismatch would indicate a programming error, not an attack, and
        // timingSafeEqual will throw in that case which is the correct behaviour.
        const storedHash = Buffer.from(row['key_hash'], 'hex');
        const computedHash = Buffer.from(hash, 'hex');
        if (!crypto.timingSafeEqual(storedHash, computedHash)) {
            this._cache.set(hash, null);
            return null;
        }
        this._cache.set(hash, apiKey);
        return apiKey;
    }
    /**
     * Revoke an API key by ID — deletes from DB and removes from cache.
     */
    async revoke(id) {
        // Get the hash before deleting so we can evict from cache
        const existing = await this._pool.query('SELECT key_hash FROM street_api_keys WHERE id = $1', [id]);
        const hash = existing.rows[0]?.['key_hash'];
        await this._pool.query('DELETE FROM street_api_keys WHERE id = $1', [id]);
        if (hash) {
            this._cache.delete(hash);
        }
    }
}
// ── apiKeyMiddleware ──────────────────────────────────────────────────────────
/**
 * Middleware that extracts `Authorization: Bearer <key>`, verifies it,
 * and sets `ctx.user` on success. Throws UnauthorizedException on failure.
 */
export function apiKeyMiddleware(service) {
    return async (ctx, next) => {
        const auth = ctx.headers['authorization'];
        if (!auth?.startsWith('Bearer ')) {
            throw new UnauthorizedException('Missing or invalid Authorization header');
        }
        const rawKey = auth.slice('Bearer '.length).trim();
        const apiKey = await service.verify(rawKey);
        if (!apiKey) {
            throw new UnauthorizedException('Invalid or expired API key');
        }
        ctx.user = { id: apiKey.ownerId, email: '', roles: [] };
        await next();
    };
}
// ── Helpers ───────────────────────────────────────────────────────────────────
function _rowToApiKey(row) {
    return {
        id: row['id'] ?? '',
        keyHash: row['key_hash'] ?? '',
        prefix: row['prefix'] ?? '',
        name: row['name'] ?? '',
        ownerId: row['owner_id'] ?? '',
        expiresAt: row['expires_at'] ? new Date(row['expires_at']) : null,
        createdAt: new Date(row['created_at'] ?? Date.now()),
    };
}
//# sourceMappingURL=api-keys.js.map
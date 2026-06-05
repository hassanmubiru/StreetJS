import type { MiddlewareFn } from '../core/types.js';
export declare const API_KEYS_MIGRATION_SQL: string;
export interface ApiKey {
    id: string;
    keyHash: string;
    prefix: string;
    name: string;
    ownerId: string;
    expiresAt: Date | null;
    createdAt: Date;
}
export interface ApiKeyGenerateOpts {
    ownerId: string;
    name: string;
    prefix?: string;
    expiresAt?: Date;
}
export interface ApiKeyPool {
    query(sql: string, params?: unknown[]): Promise<{
        rows: Record<string, string | null>[];
        rowCount: number;
        command: string;
    }>;
}
export declare class ApiKeyService {
    private readonly _pool;
    /** LRU cache: SHA-256 hex hash → ApiKey or null (null means "not found/expired") */
    private readonly _cache;
    constructor(pool: ApiKeyPool);
    /**
     * Generate a new API key. Returns the raw key ONCE — only the hash is stored.
     */
    generate(opts: ApiKeyGenerateOpts): Promise<{
        key: string;
        record: ApiKey;
    }>;
    /**
     * Verify a raw API key. Returns the ApiKey record or null if invalid/expired.
     * Uses constant-time comparison to prevent timing attacks.
     */
    verify(rawKey: string): Promise<ApiKey | null>;
    /**
     * Revoke an API key by ID — deletes from DB and removes from cache.
     */
    revoke(id: string): Promise<void>;
}
/**
 * Middleware that extracts `Authorization: Bearer <key>`, verifies it,
 * and sets `ctx.user` on success. Throws UnauthorizedException on failure.
 */
export declare function apiKeyMiddleware(service: ApiKeyService): MiddlewareFn;
//# sourceMappingURL=api-keys.d.ts.map
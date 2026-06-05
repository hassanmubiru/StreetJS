import type { JwtService } from '../security/jwt.js';
export declare const REFRESH_TOKENS_MIGRATION_SQL: string;
export declare class TokenReplayError extends Error {
    constructor();
}
export interface RefreshTokenPool {
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
export interface RefreshTokenServiceOptions {
    accessTokenTtlMs?: number;
    refreshTokenTtlMs?: number;
}
export declare class RefreshTokenService {
    private readonly _pool;
    private readonly _jwt;
    private readonly _accessTtlMs;
    private readonly _refreshTtlMs;
    constructor(pool: RefreshTokenPool, jwt: JwtService, opts?: RefreshTokenServiceOptions);
    /**
     * Issue a new access token + refresh token pair for `userId`.
     * If `familyId` is not provided, a new one is generated.
     */
    issue(userId: string, familyId?: string): Promise<{
        accessToken: string;
        refreshToken: string;
    }>;
    /**
     * Rotate a refresh token.
     * Atomically invalidates the old token and issues new tokens.
     * On replay (already revoked), revokes the entire family and throws TokenReplayError.
     */
    rotate(rawRefreshToken: string): Promise<{
        accessToken: string;
        refreshToken: string;
    }>;
    /**
     * Revoke all refresh tokens in a family (used on replay detection or explicit logout).
     */
    revokeFamily(familyId: string): Promise<void>;
    /**
     * Revoke all refresh tokens for a user.
     */
    revokeAll(userId: string): Promise<void>;
}
//# sourceMappingURL=refresh-tokens.d.ts.map
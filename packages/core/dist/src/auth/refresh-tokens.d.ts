import type { JwtService } from '../security/jwt.js';
import type { AuditWriter, AuditEventDetails } from './audit-writer.js';
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
    /**
     * When provided, a `token_refresh` audit entry is written after every
     * successful {@link RefreshTokenService.rotate} call. Omitting it leaves the
     * service's behaviour and dependencies unchanged.
     */
    auditWriter?: AuditWriter;
}
export declare class RefreshTokenService {
    private readonly _pool;
    private readonly _jwt;
    private readonly _accessTtlMs;
    private readonly _refreshTtlMs;
    private readonly _auditWriter?;
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
    rotate(rawRefreshToken: string, auditContext?: AuditEventDetails): Promise<{
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
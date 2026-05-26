import type { StreetContext } from '../core/context.js';
import type { MiddlewareFn } from '../core/types.js';
import { JwtService } from '../security/jwt.js';
/** Create a JWT auth middleware from a JwtService instance */
export declare function authMiddleware(jwt: JwtService): MiddlewareFn;
/** Require specific roles (use after authMiddleware) */
export declare function requireRoles(...roles: string[]): MiddlewareFn;
/** Security headers middleware */
export declare function securityHeaders(ctx: StreetContext, next: () => Promise<void>): Promise<void>;
/** CORS middleware */
export declare function corsMiddleware(origins?: string[]): MiddlewareFn;
//# sourceMappingURL=auth.middleware.d.ts.map
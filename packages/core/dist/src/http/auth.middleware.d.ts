import type { StreetContext } from '../core/context.js';
import type { MiddlewareFn } from '../core/types.js';
import { JwtService } from '../security/jwt.js';
/** Create a JWT auth middleware from a JwtService instance */
export declare function authMiddleware(jwt: JwtService): MiddlewareFn;
/** Require specific roles (use after authMiddleware) */
export declare function requireRoles(...roles: string[]): MiddlewareFn;
/** Security headers middleware */
export declare function securityHeaders(ctx: StreetContext, next: () => Promise<void>): Promise<void>;
/** CORS middleware.
 * Finding 8 fix: wildcard '*' is no longer the default. Callers MUST supply
 * an explicit list of allowed origins. Pass ['*'] only for fully public,
 * read-only APIs where CSRF is not a concern.
 */
export declare function corsMiddleware(origins: string[]): MiddlewareFn;
/**
 * Finding 8 fix: CSRF validation middleware.
 *
 * Validates the X-CSRF-Token request header against the csrf token stored
 * in the encrypted session cookie. Must be used AFTER session decryption
 * middleware has populated ctx.state['session'].
 *
 * Safe HTTP methods (GET, HEAD, OPTIONS) are exempt.
 *
 * Usage:
 *   app.use(csrfMiddleware());
 *
 * The session must contain a `csrf` field set when the session was created:
 *   const csrf = SessionManager.generateCsrf();
 *   const session = sessionManager.encrypt({ userId, csrf });
 */
export declare function csrfMiddleware(): MiddlewareFn;
//# sourceMappingURL=auth.middleware.d.ts.map
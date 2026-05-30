// src/http/auth.middleware.ts
// Bearer token authentication middleware using JwtService.
import { timingSafeEqual } from 'node:crypto';
import { UnauthorizedException, ForbiddenException } from './exceptions.js';
/** Create a JWT auth middleware from a JwtService instance */
export function authMiddleware(jwt) {
    return async (ctx, next) => {
        const authHeader = ctx.headers['authorization'];
        if (!authHeader?.startsWith('Bearer ')) {
            throw new UnauthorizedException('Missing Bearer token');
        }
        const token = authHeader.slice(7);
        const payload = jwt.verify(token);
        if (!payload?.sub) {
            throw new UnauthorizedException('Invalid or expired token');
        }
        ctx.user = {
            id: payload.sub,
            email: String(payload.email ?? ''),
            roles: Array.isArray(payload.roles) ? payload.roles : [],
        };
        await next();
    };
}
/** Require specific roles (use after authMiddleware) */
export function requireRoles(...roles) {
    return async (ctx, next) => {
        if (!ctx.user) {
            throw new UnauthorizedException();
        }
        const hasRole = roles.some((r) => ctx.user.roles.includes(r));
        if (!hasRole) {
            throw new ForbiddenException('Insufficient permissions');
        }
        await next();
    };
}
/** Security headers middleware */
export async function securityHeaders(ctx, next) {
    // Finding 14 fix: add CSP, HSTS, COOP, CORP; remove deprecated X-XSS-Protection
    ctx.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
    ctx.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
    ctx.setHeader('X-Content-Type-Options', 'nosniff');
    ctx.setHeader('X-Frame-Options', 'DENY');
    ctx.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    ctx.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    ctx.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    ctx.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    await next();
}
/** CORS middleware.
 * Finding 8 fix: wildcard '*' is no longer the default. Callers MUST supply
 * an explicit list of allowed origins. Pass ['*'] only for fully public,
 * read-only APIs where CSRF is not a concern.
 */
export function corsMiddleware(origins) {
    if (origins.length === 0) {
        throw new Error('corsMiddleware: origins list must not be empty');
    }
    return async (ctx, next) => {
        const origin = ctx.headers['origin'] ?? '';
        const allowedOrigin = origins.includes('*') ? '*' : (origins.includes(origin) ? origin : '');
        if (allowedOrigin) {
            ctx.setHeader('Access-Control-Allow-Origin', allowedOrigin);
            ctx.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
            ctx.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-CSRF-Token');
            ctx.setHeader('Access-Control-Max-Age', '86400');
            // Vary header required when reflecting a specific origin
            if (allowedOrigin !== '*') {
                ctx.setHeader('Vary', 'Origin');
            }
        }
        if (ctx.method === 'OPTIONS') {
            ctx.send(204);
            return;
        }
        await next();
    };
}
// ─── CSRF Protection ──────────────────────────────────────────────────────────
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
export function csrfMiddleware() {
    const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
    return async (ctx, next) => {
        if (SAFE_METHODS.has(ctx.method)) {
            await next();
            return;
        }
        // Retrieve the CSRF token stored in the session (set by session middleware)
        const session = ctx.state['session'];
        const sessionCsrf = typeof session?.['csrf'] === 'string' ? session['csrf'] : null;
        if (!sessionCsrf) {
            throw new ForbiddenException('CSRF validation failed: no session CSRF token');
        }
        const headerToken = ctx.headers['x-csrf-token'];
        if (!headerToken) {
            throw new ForbiddenException('CSRF validation failed: missing X-CSRF-Token header');
        }
        // Constant-time comparison to prevent timing attacks
        const sessionBuf = Buffer.from(sessionCsrf, 'utf8');
        const headerBuf = Buffer.from(headerToken, 'utf8');
        if (sessionBuf.length !== headerBuf.length) {
            throw new ForbiddenException('CSRF validation failed: token mismatch');
        }
        if (!timingSafeEqual(sessionBuf, headerBuf)) {
            throw new ForbiddenException('CSRF validation failed: token mismatch');
        }
        await next();
    };
}
//# sourceMappingURL=auth.middleware.js.map
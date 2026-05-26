// src/http/auth.middleware.ts
// Bearer token authentication middleware using JwtService.
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
    ctx.setHeader('X-Content-Type-Options', 'nosniff');
    ctx.setHeader('X-Frame-Options', 'DENY');
    ctx.setHeader('X-XSS-Protection', '1; mode=block');
    ctx.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    ctx.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    await next();
}
/** CORS middleware */
export function corsMiddleware(origins = ['*']) {
    return async (ctx, next) => {
        const origin = ctx.headers['origin'] ?? '';
        const allowedOrigin = origins.includes('*') ? '*' : (origins.includes(origin) ? origin : '');
        if (allowedOrigin) {
            ctx.setHeader('Access-Control-Allow-Origin', allowedOrigin);
            ctx.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
            ctx.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
            ctx.setHeader('Access-Control-Max-Age', '86400');
        }
        if (ctx.method === 'OPTIONS') {
            ctx.send(204);
            return;
        }
        await next();
    };
}
//# sourceMappingURL=auth.middleware.js.map
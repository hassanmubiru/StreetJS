// src/middleware/auth.ts
// Custom authentication and authorization middleware examples.

import type { StreetContext } from 'streetjs';
import { container, JwtService, UnauthorizedException } from 'streetjs';

/**
 * JWT-based authentication middleware.
 * Extracts Bearer token from Authorization header and sets ctx.user.
 */
export async function authenticate(ctx: StreetContext, next: () => Promise<void>): Promise<void> {
  const authHeader = ctx.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new UnauthorizedException('Missing or invalid authorization header');
  }

  const token = authHeader.slice(7);
  const jwtService = container.resolve(JwtService);

  try {
    const payload = jwtService.verify(token);
    ctx.user = payload as StreetContext['user'] ?? { id: '', email: '', roles: [] };
    await next();
  } catch {
    throw new UnauthorizedException('Invalid or expired token');
  }
}

/**
 * Role-based authorization middleware.
 * Must be used after authenticate().
 */
export function requireRole(...roles: string[]) {
  return async (ctx: StreetContext, next: () => Promise<void>): Promise<void> => {
    const user = ctx.user;
    if (!user || !user.roles || !roles.some((r) => user.roles.includes(r))) {
      throw new UnauthorizedException('Insufficient permissions');
    }
    await next();
  };
}

/**
 * Request logging middleware.
 */
export async function requestLogger(ctx: StreetContext, next: () => Promise<void>): Promise<void> {
  const start = Date.now();
  const method = ctx.req.method ?? 'UNKNOWN';
  const url = ctx.req.url ?? '/';

  console.log(`[http] --> ${method} ${url}`);

  await next();

  const duration = Date.now() - start;
  const status = ctx.res.statusCode ?? 200;
  console.log(`[http] <-- ${method} ${url} ${status} (${duration}ms)`);
}

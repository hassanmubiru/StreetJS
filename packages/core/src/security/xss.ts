// src/security/xss.ts
//
// The XSS sanitizers now live in the standalone @streetjs/xss package (single
// source of truth); this module re-exports them so the `streetjs/xss` subpath
// and all internal imports keep working unchanged — dependency inversion, not
// duplication. The framework-specific request middleware stays here because it
// depends on the core request context.

import { sanitizeDeep } from '@streetjs/xss';

export { sanitizeString, sanitizeDeep, escapeHtml } from '@streetjs/xss';

/** Middleware that recursively sanitizes the request body. */
export async function xssMiddleware(
  ctx: import('../core/context.js').StreetContext,
  next: () => Promise<void>,
): Promise<void> {
  if (ctx.body !== null && typeof ctx.body === 'object') {
    (ctx as unknown as Record<string, unknown>)['body'] = sanitizeDeep(ctx.body);
  }
  await next();
}

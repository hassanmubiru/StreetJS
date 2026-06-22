// src/middleware/apiKeyAuth.ts
// API-key authentication for the SaaS starter (overlay code — NOT framework code).
//
// Authenticates requests presenting an X-API-Key header by delegating the hash
// lookup, revocation, and expiry checks to ApiKeyService.verify (see
// src/modules/apikeys/apikey.service.ts). On success the request is scoped to
// the key's organization and limited to the key's scopes:
//
//   missing / empty / unknown / revoked / expired key -> 401 (UnauthorizedException)
//   valid key lacking a required scope                 -> 403 (ForbiddenException)
//   valid key                                          -> ctx.org + ctx.scopes set
//
// This middleware guards the /api/v1/* routes (see the route table in
// design.md); session/CSRF auth + tenantResolver guard the browser dashboard.

import {
  ForbiddenException,
  UnauthorizedException,
  type MiddlewareFn,
  type StreetContext,
} from 'streetjs';

export type Scope = string;

/**
 * Minimal contract apiKeyAuth needs from the API key module. Satisfied by
 * ApiKeyService.verify (task 3.2), which performs the hash lookup, rejects
 * revoked/expired/unknown keys by returning null, and stamps last_used_at on a
 * successful verification.
 */
export interface ApiKeyVerifier {
  verify(rawKey: string): Promise<{ orgId: string; scopes: Scope[] } | null>;
}

/** Options controlling which scopes a guarded route requires of the key. */
export interface ApiKeyAuthOptions {
  // Scopes the presented key MUST hold for the guarded route. A request whose
  // key is missing any required scope is denied with 403. Omitted/empty means
  // the route is scope-agnostic (any valid key is accepted).
  requiredScopes?: Scope[];
}

/**
 * scopeSatisfied — true when the granted scopes cover requiredScope.
 *
 * A scope is granted by an exact match, by the global wildcard '*', or by a
 * segment wildcard such as 'billing:*' covering 'billing:read'.
 */
function scopeSatisfied(granted: Scope[], requiredScope: Scope): boolean {
  for (const g of granted) {
    if (g === requiredScope || g === '*') return true;
    if (g.endsWith(':*') && requiredScope.startsWith(g.slice(0, -1))) return true;
  }
  return false;
}

/**
 * apiKeyAuth — authenticate an X-API-Key request and scope it to the key's org.
 *
 * Returns 401 when the header is missing or empty, or when the key is unknown,
 * revoked, or expired (verify returns null for those three). On success it sets
 * ctx.org to the key's organization and limits ctx.scopes to the key's scopes;
 * if the route declares requiredScopes the key must hold them all, otherwise the
 * request is denied with 403.
 */
export function apiKeyAuth(
  deps: { keys: ApiKeyVerifier },
  options: ApiKeyAuthOptions = {},
): MiddlewareFn {
  const requiredScopes = options.requiredScopes ?? [];

  return async (ctx: StreetContext, next: () => Promise<void>): Promise<void> => {
    // Missing or empty X-API-Key header -> 401.
    const rawKey = ctx.headers?.['x-api-key'];
    if (!rawKey) throw new UnauthorizedException('missing API key');

    // verify() returns null for unknown, revoked, or expired keys -> 401.
    const result = await deps.keys.verify(rawKey);
    if (!result) throw new UnauthorizedException('invalid API key');

    // Scope the request to the key's org and limit it to the key's scopes.
    ctx.org = { id: result.orgId };
    ctx.scopes = result.scopes;

    // Deny when the route requires a scope the key does not hold -> 403.
    for (const required of requiredScopes) {
      if (!scopeSatisfied(result.scopes, required)) {
        throw new ForbiddenException('insufficient scope: ' + required);
      }
    }

    await next();
  };
}

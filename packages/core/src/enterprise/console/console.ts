// src/enterprise/console/console.ts
// The Enterprise Console: a zero-dependency REST surface for tenant, policy,
// compliance, and admin operations.
//
// Every operation runs the same lifecycle, enforced here and never inside a
// route's `perform`:
//   1. authenticate  → 401 on missing/invalid Bearer token (Req 6.6)
//   2. authorize     → 403 when the principal lacks the operation's role (Req 6.7)
//   3. validate      → 400 identifying the invalid input, state unchanged (Req 6.8)
//   4. perform       → execute the state change
//
// Authentication reuses security/jwt.ts (JwtService). Authorization is a simple
// role-membership check using the roles carried in the JWT. Because authn, authz
// and validation all return before any backend mutation, a rejected request
// leaves tenant/policy/compliance/admin state unchanged.

import { JwtService } from '../../security/jwt.js';
import { ConsoleNotFoundError } from './backend.js';
import { CONSOLE_ROUTES } from './routes.js';
import type {
  ConsoleBackend,
  ConsolePrincipal,
  ConsoleRequest,
  ConsoleResponse,
  ConsoleRoute,
} from './types.js';

export interface EnterpriseConsoleOptions {
  jwt: JwtService;
  backend: ConsoleBackend;
  /** Override the route table (defaults to the full console surface). */
  routes?: ConsoleRoute[];
  /** JWT verification options (issuer/audience), forwarded to JwtService.verify. */
  jwtOptions?: { issuer?: string; audience?: string };
}

interface RouteMatch {
  route: ConsoleRoute;
  params: Record<string, string>;
}

export class EnterpriseConsole {
  private readonly jwt: JwtService;
  private readonly backend: ConsoleBackend;
  private readonly _routes: ConsoleRoute[];
  private readonly jwtOptions: { issuer?: string; audience?: string };

  constructor(opts: EnterpriseConsoleOptions) {
    this.jwt = opts.jwt;
    this.backend = opts.backend;
    this._routes = opts.routes ?? CONSOLE_ROUTES;
    this.jwtOptions = opts.jwtOptions ?? {};
  }

  /** The registered console operations (used for OpenAPI generation, Req 6.9). */
  routes(): ReadonlyArray<ConsoleRoute> {
    return this._routes;
  }

  /**
   * Handle a single normalized request through the full lifecycle. Returns a
   * normalized response; never throws for client errors (401/403/400/404).
   */
  async handle(req: ConsoleRequest): Promise<ConsoleResponse> {
    const match = this.match(req.method, req.path);
    if (!match) {
      return { status: 404, body: { error: 'not_found', message: 'no such operation' } };
    }
    const { route, params } = match;

    // 1. Authenticate (Req 6.6)
    const principal = this.authenticate(req);
    if (!principal) {
      return {
        status: 401,
        body: { error: 'unauthenticated', message: 'missing or invalid Bearer token' },
      };
    }

    // 2. Authorize (Req 6.7)
    if (!this.authorize(principal, route)) {
      return {
        status: 403,
        body: { error: 'unauthorized', message: 'insufficient permissions', required: route.requiredRoles },
      };
    }

    // 3. Validate (Req 6.8) — reject identifying the invalid input, state unchanged
    const validation = route.validate(req, params);
    if (!validation.ok) {
      return {
        status: 400,
        body: { error: 'invalid_input', field: validation.field, message: validation.message },
      };
    }

    // 4. Perform
    try {
      return await route.perform(this.backend, { principal, params, value: validation.value });
    } catch (err) {
      if (err instanceof ConsoleNotFoundError) {
        return { status: 404, body: { error: 'not_found', message: err.message } };
      }
      return {
        status: 500,
        body: { error: 'internal_error', message: err instanceof Error ? err.message : String(err) },
      };
    }
  }

  /** Verify the Bearer token and derive the principal, or null if unauthenticated. */
  private authenticate(req: ConsoleRequest): ConsolePrincipal | null {
    const header = req.headers['authorization'];
    if (typeof header !== 'string' || !header.startsWith('Bearer ')) return null;
    const token = header.slice(7);
    const payload = this.jwt.verify(token, this.jwtOptions);
    if (!payload?.sub) return null;
    return {
      id: payload.sub,
      email: typeof payload.email === 'string' ? payload.email : '',
      roles: Array.isArray(payload.roles) ? payload.roles.filter((r): r is string => typeof r === 'string') : [],
    };
  }

  /** A principal is authorized iff it holds at least one of the route's roles. */
  private authorize(principal: ConsolePrincipal, route: ConsoleRoute): boolean {
    if (route.requiredRoles.length === 0) return true;
    return route.requiredRoles.some((r) => principal.roles.includes(r));
  }

  /** Match a method + path against the route table, extracting path params. */
  private match(method: string, path: string): RouteMatch | null {
    const reqSegments = splitPath(path);
    for (const route of this._routes) {
      if (route.method !== method) continue;
      const patternSegments = splitPath(route.pattern);
      if (patternSegments.length !== reqSegments.length) continue;
      const params: Record<string, string> = {};
      let matched = true;
      for (let i = 0; i < patternSegments.length; i++) {
        const p = patternSegments[i]!;
        const r = reqSegments[i]!;
        if (p.startsWith(':')) {
          params[p.slice(1)] = decodeURIComponent(r);
        } else if (p !== r) {
          matched = false;
          break;
        }
      }
      if (matched) return { route, params };
    }
    return null;
  }
}

function splitPath(path: string): string[] {
  const clean = path.split('?')[0]!.replace(/\/+$/, '');
  return clean.split('/').filter((s) => s.length > 0);
}

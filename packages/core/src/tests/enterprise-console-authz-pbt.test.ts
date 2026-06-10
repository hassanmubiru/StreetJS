// src/tests/enterprise-console-authz-pbt.test.ts
// Property-based test for Enterprise Console authentication/authorization gating
// (Task 10.2). Kept in its own file so the universal property is exercised across
// every console operation and many generated principals without clobbering the
// example/edge-case unit tests in enterprise-console.test.ts.
//
// The console lifecycle is fixed by EnterpriseConsole.handle:
//   authenticate (401) -> authorize (403) -> validate (400) -> perform.
// Because authn and authz short-circuit BEFORE any backend mutation, a request
// that is unauthenticated or unauthorized must always leave the backend state
// byte-for-byte unchanged. This is exactly what Req 6.5/6.6/6.7 require.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import { JwtService } from '../security/jwt.js';
import {
  EnterpriseConsole,
  InMemoryConsoleBackend,
  CONSOLE_ROUTES,
} from '../enterprise/console/index.js';
import type { ConsoleRequest, ConsoleRoute } from '../enterprise/console/index.js';

const NUM_RUNS = 100;

// A 40-char secret (>= 32) for valid tokens, and a DIFFERENT one used to forge
// tokens whose HMAC signature will never validate against the real service.
const SECRET = 'enterprise-console-pbt-secret-0123456789';
const WRONG_SECRET = 'a-totally-different-secret-9876543210-xyz';

const jwt = new JwtService(SECRET);
const wrongJwt = new JwtService(WRONG_SECRET);

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Sign a valid Bearer header carrying the given roles. */
function bearer(roles: string[]): Record<string, string> {
  return { authorization: `Bearer ${jwt.sign({ sub: 'user-x', email: 'x@y.z', roles }, { expiresInSeconds: 120 })}` };
}

/** Construct a concrete path for a route, encoding a value into every :param. */
function concretePath(route: ConsoleRoute, param: string): string {
  const segs = route.pattern.split('/').filter((s) => s.length > 0);
  return '/' + segs.map((s) => (s.startsWith(':') ? encodeURIComponent(param) : s)).join('/');
}

function buildReq(route: ConsoleRoute, param: string, headers: Record<string, string | undefined>, body: unknown): ConsoleRequest {
  return { method: route.method, path: concretePath(route, param), headers, body };
}

/** Build a fresh console + backend and seed it so its snapshot is non-trivial. */
async function makeSeeded(): Promise<{ api: EnterpriseConsole; backend: InMemoryConsoleBackend; baseline: string }> {
  const backend = new InMemoryConsoleBackend();
  const api = new EnterpriseConsole({ jwt, backend });
  await api.handle(buildReq(CONSOLE_ROUTES.find((r) => r.operationId === 'createTenant')!, 'x', bearer(['admin']), { name: 'acme', plan: 'pro' }));
  await api.handle({ method: 'PUT', path: '/api/admin/policies/mfa', headers: bearer(['policy:write']), body: { required: true } });
  await api.handle({ method: 'PUT', path: '/api/admin/policies/retention', headers: bearer(['policy:write']), body: { entity: 'orders', retentionDays: 30 } });
  await api.handle({ method: 'PUT', path: '/api/admin/secrets/db-pw', headers: bearer(['secret:write']), body: { value: 's3cr3t' } });
  await api.handle({ method: 'POST', path: '/api/admin/users', headers: bearer(['user:write']), body: { action: 'create', userId: 'u1', roles: ['viewer'] } });
  return { api, backend, baseline: backend.snapshot() };
}

// ── Generators ────────────────────────────────────────────────────────────────

const routeArb: fc.Arbitrary<ConsoleRoute> = fc.constantFrom(...CONSOLE_ROUTES);

// A value for any :param segment; non-empty so it survives encode/decode + match.
const paramArb: fc.Arbitrary<string> = fc.string({ minLength: 1, maxLength: 16 });

// Arbitrary request bodies — body is never reached for 401/403, so anything goes.
const bodyArb: fc.Arbitrary<unknown> = fc.anything({ maxDepth: 2 });

/**
 * Headers that authenticate() must reject (-> 401), spanning the full failure
 * space: no header, explicit-undefined header, non-Bearer scheme, a raw string
 * with no scheme, a garbage Bearer token, a token forged with the wrong secret,
 * an expired token, and a token with no subject.
 */
const unauthHeadersArb: fc.Arbitrary<Record<string, string | undefined>> = fc.oneof(
  fc.constant<Record<string, string | undefined>>({}),
  fc.constant<Record<string, string | undefined>>({ authorization: undefined }),
  fc.string().map((s) => ({ authorization: `Basic ${s}` })),
  fc.string().map((s) => ({ authorization: s })),
  fc.string().map((s) => ({ authorization: `Bearer ${s}` })),
  fc.array(fc.string(), { maxLength: 5 }).map((roles) => ({
    authorization: `Bearer ${wrongJwt.sign({ sub: 'forged', roles }, { expiresInSeconds: 120 })}`,
  })),
  fc.array(fc.string(), { maxLength: 5 }).map((roles) => ({
    authorization: `Bearer ${jwt.sign({ sub: 'stale', roles }, { expiresInSeconds: -60 })}`,
  })),
  fc.constant<Record<string, string | undefined>>({
    authorization: `Bearer ${jwt.sign({ sub: '' }, { expiresInSeconds: 120 })}`,
  }),
);

// Feature: platform-leadership-gaps, Property 14: Every enterprise operation requires authn and authz, else state is unchanged
// Validates: Requirements 6.5, 6.6, 6.7
describe('Property 14: every enterprise operation requires authn and authz, else state is unchanged', () => {
  it('an unauthenticated request to any operation returns 401 and leaves backend state unchanged (Req 6.5, 6.6)', async () => {
    const { api, backend, baseline } = await makeSeeded();
    await fc.assert(
      fc.asyncProperty(routeArb, paramArb, bodyArb, unauthHeadersArb, async (route, param, body, headers) => {
        const res = await api.handle(buildReq(route, param, headers, body));
        assert.equal(res.status, 401, `expected 401 for unauthenticated ${route.operationId}, got ${res.status}`);
        assert.equal(backend.snapshot(), baseline, 'backend state must be unchanged on 401');
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('an authenticated-but-unauthorized request to any operation returns 403 and leaves backend state unchanged (Req 6.5, 6.7)', async () => {
    const { api, backend, baseline } = await makeSeeded();
    await fc.assert(
      fc.asyncProperty(routeArb, paramArb, bodyArb, fc.array(fc.string(), { maxLength: 6 }), async (route, param, body, baseRoles) => {
        // Strip any role the route would accept so the principal is always unauthorized.
        const roles = baseRoles.filter((r) => !route.requiredRoles.includes(r));
        const res = await api.handle(buildReq(route, param, bearer(roles), body));
        assert.equal(res.status, 403, `expected 403 for unauthorized ${route.operationId}, got ${res.status}`);
        assert.equal(backend.snapshot(), baseline, 'backend state must be unchanged on 403');
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('a properly authenticated and authorized principal is never gated with 401/403 (gate is exactly authn+authz)', async () => {
    const { api } = await makeSeeded();
    await fc.assert(
      fc.asyncProperty(routeArb, paramArb, bodyArb, async (route, param, body) => {
        // Use one of the operation's own required roles -> authn + authz both pass.
        const role = route.requiredRoles[0]!;
        const res = await api.handle(buildReq(route, param, bearer([role]), body));
        assert.notEqual(res.status, 401, `authorized ${route.operationId} must not be 401`);
        assert.notEqual(res.status, 403, `authorized ${route.operationId} must not be 403`);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

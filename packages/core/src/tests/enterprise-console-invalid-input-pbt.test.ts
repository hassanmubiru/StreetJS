// src/tests/enterprise-console-invalid-input-pbt.test.ts
// Property-based test for Enterprise Console invalid-input rejection (Task 10.3).
// Kept in its own file so the universal property is exercised across every
// console operation that accepts input, against many generated invalid payloads,
// without clobbering the example/edge-case unit tests in enterprise-console.test.ts.
//
// The console lifecycle is fixed by EnterpriseConsole.handle:
//   authenticate (401) -> authorize (403) -> validate (400) -> perform.
// To exercise the validation gate (Req 6.8) we always present a properly
// authenticated AND authorized principal so authn/authz pass, then feed an input
// that the route's validator must reject. Because validate() runs BEFORE any
// backend mutation, a rejected request must:
//   * return 400 with `error: 'invalid_input'` and a non-empty `field` that
//     identifies the offending input, and
//   * leave tenant/policy/compliance/admin state byte-for-byte unchanged.

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

// A 40-char secret (>= 32) for valid tokens.
const SECRET = 'enterprise-console-pbt-secret-0123456789';
const jwt = new JwtService(SECRET);

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Sign a valid Bearer header carrying the given roles. */
function bearer(roles: string[]): Record<string, string> {
  return {
    authorization: `Bearer ${jwt.sign({ sub: 'user-x', email: 'x@y.z', roles }, { expiresInSeconds: 120 })}`,
  };
}

/** Construct a concrete path for a route, encoding a value into every :param. */
function concretePath(route: ConsoleRoute, param: string): string {
  const segs = route.pattern.split('/').filter((s) => s.length > 0);
  return '/' + segs.map((s) => (s.startsWith(':') ? encodeURIComponent(param) : s)).join('/');
}

function buildReq(
  route: ConsoleRoute,
  param: string,
  headers: Record<string, string | undefined>,
  body: unknown,
): ConsoleRequest {
  return { method: route.method, path: concretePath(route, param), headers, body };
}

/** Build a fresh console + backend and seed it so its snapshot is non-trivial. */
async function makeSeeded(): Promise<{
  api: EnterpriseConsole;
  backend: InMemoryConsoleBackend;
  baseline: string;
}> {
  const backend = new InMemoryConsoleBackend();
  const api = new EnterpriseConsole({ jwt, backend });
  await api.handle({ method: 'POST', path: '/api/admin/tenants', headers: bearer(['admin']), body: { name: 'acme', plan: 'pro' } });
  await api.handle({ method: 'PUT', path: '/api/admin/policies/mfa', headers: bearer(['policy:write']), body: { required: true } });
  await api.handle({ method: 'PUT', path: '/api/admin/policies/retention', headers: bearer(['policy:write']), body: { entity: 'orders', retentionDays: 30 } });
  await api.handle({ method: 'PUT', path: '/api/admin/policies/classification', headers: bearer(['policy:write']), body: { field: 'ssn', level: 'restricted' } });
  await api.handle({ method: 'PUT', path: '/api/admin/secrets/db-pw', headers: bearer(['secret:write']), body: { value: 's3cr3t' } });
  await api.handle({ method: 'POST', path: '/api/admin/users', headers: bearer(['user:write']), body: { action: 'create', userId: 'u1', roles: ['viewer'] } });
  await api.handle({ method: 'POST', path: '/api/admin/keys/rotate', headers: bearer(['key:rotate']), body: { keyId: 'k1' } });
  return { api, backend, baseline: backend.snapshot() };
}

// ── Generators ────────────────────────────────────────────────────────────────

// A non-empty value for any :param segment so the path matches and any path-param
// validation passes — forcing rejection to come from the *body*, not the param.
const paramArb: fc.Arbitrary<string> = fc.string({ minLength: 1, maxLength: 16 });

/**
 * A body that is never a plain JSON object. Every route that validates input
 * first requires an object body (`asObject`), so any of these is invalid input
 * for every included operation and yields `field: 'body'`.
 */
const notAnObjectArb: fc.Arbitrary<unknown> = fc.oneof(
  fc.constant(undefined),
  fc.constant(null),
  fc.boolean(),
  fc.integer(),
  fc.double(),
  fc.string(),
  fc.array(fc.anything(), { maxLength: 3 }),
);

/**
 * Route-specific invalid object bodies. Each entry is intelligently constrained
 * to the *invalid* input space for that operation's validator, so the validator
 * is guaranteed to reject it. Operations whose validator accepts no input
 * (`validateNoInput`) and `suspendTenant` (body-less; only path validation) have
 * no invalid-input space and are intentionally excluded below.
 */
const invalidByOp: Record<string, fc.Arbitrary<unknown>> = {
  createTenant: fc.constantFrom<unknown>(
    {},
    { name: '' },
    { name: '   ' },
    { name: 123 },
    { name: 'ok', plan: 123 },
    { name: 'ok', connectionString: 5 },
  ),
  updateTenant: fc.constantFrom<unknown>(
    {},
    { name: '' },
    { name: 5 },
    { plan: 5 },
    { status: 'bogus' },
  ),
  setRbacPolicy: fc.constantFrom<unknown>(
    {},
    { roles: 'x' },
    { roles: [{}] },
    { roles: [{ role: 'r' }] },
    { roles: [{ role: '', permissions: [] }] },
    { roles: [{ role: 'r', permissions: [1] }] },
  ),
  setMfaPolicy: fc.constantFrom<unknown>(
    {},
    { required: 'yes' },
    { required: 1 },
    { required: true, methods: 'sms' },
    { required: true, methods: [1] },
  ),
  setRetentionPolicy: fc.constantFrom<unknown>(
    {},
    { entity: '', retentionDays: 5 },
    { entity: 'e' },
    { entity: 'e', retentionDays: 0 },
    { entity: 'e', retentionDays: -3 },
    { entity: 'e', retentionDays: 1.5 },
    { entity: 'e', retentionDays: 'x' },
  ),
  setClassificationPolicy: fc.constantFrom<unknown>(
    {},
    { field: '', level: 'public' },
    { field: 'f' },
    { field: 'f', level: 'bogus' },
    { field: 5, level: 'public' },
  ),
  exportAudit: fc.constantFrom<unknown>(
    {},
    { from: 'not-a-date', to: '2020-01-01', format: 'csv' },
    { from: '2020-01-01', to: 'bad', format: 'csv' },
    { from: '2020-01-01', to: '2020-02-01', format: 'xml' },
    { from: '2020-02-01', to: '2020-01-01', format: 'csv' },
  ),
  manageUser: fc.constantFrom<unknown>(
    {},
    { action: 'bogus', userId: 'u' },
    { action: 'create' },
    { action: 'create', userId: '' },
    { action: 'create', userId: 'u', roles: 'admin' },
    { action: 'create', userId: 'u', roles: [1] },
  ),
  rotateKey: fc.constantFrom<unknown>(
    {},
    { keyId: '' },
    { keyId: 5 },
  ),
  manageSecret: fc.constantFrom<unknown>(
    {},
    { value: '' },
    { value: 5 },
  ),
};

// Only routes that actually validate input can have an invalid-input space.
const VALIDATING_ROUTES = CONSOLE_ROUTES.filter((r) => r.operationId in invalidByOp);

/** Generator over (route, invalid body) pairs covering both invalid kinds. */
const routeAndInvalidBody: fc.Arbitrary<{ route: ConsoleRoute; body: unknown }> = fc
  .constantFrom(...VALIDATING_ROUTES)
  .chain((route) =>
    fc
      .oneof(notAnObjectArb, invalidByOp[route.operationId]!)
      .map((body) => ({ route, body })),
  );

// Feature: platform-leadership-gaps, Property 15: Invalid input is rejected without state change
// Validates: Requirements 6.8
describe('Property 15: invalid input is rejected without state change', () => {
  it('rejects any invalid input with 400 identifying the field, leaving state unchanged (Req 6.8)', async () => {
    const { api, backend, baseline } = await makeSeeded();
    await fc.assert(
      fc.asyncProperty(routeAndInvalidBody, paramArb, async ({ route, body }, param) => {
        // Authenticated AND authorized: authn/authz pass so rejection is from validation.
        const headers = bearer([route.requiredRoles[0]!]);
        const res = await api.handle(buildReq(route, param, headers, body));

        // Rejected with a client error that identifies the invalid input.
        assert.equal(
          res.status,
          400,
          `expected 400 invalid_input for ${route.operationId}, got ${res.status} (body=${JSON.stringify(body)})`,
        );
        const resBody = res.body as { error?: string; field?: unknown; message?: unknown };
        assert.equal(resBody.error, 'invalid_input', `${route.operationId} must report invalid_input`);
        assert.ok(
          typeof resBody.field === 'string' && resBody.field.length > 0,
          `${route.operationId} must name the offending field`,
        );
        assert.ok(
          typeof resBody.message === 'string' && (resBody.message as string).length > 0,
          `${route.operationId} must include a human-readable message`,
        );

        // tenant/policy/compliance/admin state is byte-for-byte unchanged.
        assert.equal(backend.snapshot(), baseline, 'backend state must be unchanged on invalid input');
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('every console operation that accepts input is covered by the invalid-input property', () => {
    // Sanity: each validating route is included, and excluded routes genuinely
    // have no invalid-input space (validateNoInput or body-less suspendTenant).
    assert.ok(VALIDATING_ROUTES.length >= 10, 'expected the full validating-route surface');
    const excluded = CONSOLE_ROUTES.filter((r) => !(r.operationId in invalidByOp)).map((r) => r.operationId);
    assert.deepEqual(
      excluded.sort(),
      ['generateComplianceReport', 'securityPosture', 'suspendTenant'].sort(),
    );
  });
});

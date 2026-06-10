// src/tests/enterprise-console.test.ts
// Unit tests for the Enterprise Console REST handlers (Task 10.1).
// Covers the authn → authz → validate → perform lifecycle and the
// state-unchanged guarantee on rejected requests (Req 6.5–6.8).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { JwtService } from '../security/jwt.js';
import {
  EnterpriseConsole,
  InMemoryConsoleBackend,
} from '../enterprise/console/index.js';
import type { ConsoleRequest } from '../enterprise/console/index.js';

const SECRET = 'test-secret-which-is-long-enough-1234567890';

function makeConsole(): { console: EnterpriseConsole; backend: InMemoryConsoleBackend; jwt: JwtService } {
  const jwt = new JwtService(SECRET);
  const backend = new InMemoryConsoleBackend();
  const console = new EnterpriseConsole({ jwt, backend });
  return { console, backend, jwt };
}

function bearer(jwt: JwtService, roles: string[]): Record<string, string> {
  const token = jwt.sign({ sub: 'user-1', email: 'a@b.co', roles }, { expiresInSeconds: 60 });
  return { authorization: `Bearer ${token}` };
}

function req(method: ConsoleRequest['method'], path: string, headers: Record<string, string | undefined>, body?: unknown): ConsoleRequest {
  return { method, path, headers, body };
}

describe('EnterpriseConsole — lifecycle', () => {
  it('returns 404 for an unknown operation', async () => {
    const { console, jwt } = makeConsole();
    const res = await console.handle(req('GET', '/api/admin/nope', bearer(jwt, ['admin'])));
    assert.equal(res.status, 404);
  });

  it('returns 401 when no Bearer token is present (Req 6.6)', async () => {
    const { console, backend } = makeConsole();
    const before = backend.snapshot();
    const res = await console.handle(req('POST', '/api/admin/tenants', {}, { name: 'acme' }));
    assert.equal(res.status, 401);
    assert.equal(backend.snapshot(), before);
  });

  it('returns 401 when the token is invalid (Req 6.6)', async () => {
    const { console, backend } = makeConsole();
    const before = backend.snapshot();
    const res = await console.handle(
      req('POST', '/api/admin/tenants', { authorization: 'Bearer not.a.jwt' }, { name: 'acme' }),
    );
    assert.equal(res.status, 401);
    assert.equal(backend.snapshot(), before);
  });

  it('returns 403 when authenticated but unauthorized (Req 6.7)', async () => {
    const { console, backend, jwt } = makeConsole();
    const before = backend.snapshot();
    const res = await console.handle(
      req('POST', '/api/admin/tenants', bearer(jwt, ['viewer']), { name: 'acme' }),
    );
    assert.equal(res.status, 403);
    assert.deepEqual((res.body as { required: string[] }).required, ['admin', 'tenant:write']);
    assert.equal(backend.snapshot(), before);
  });

  it('returns 400 identifying the invalid field, state unchanged (Req 6.8)', async () => {
    const { console, backend, jwt } = makeConsole();
    const before = backend.snapshot();
    const res = await console.handle(
      req('POST', '/api/admin/tenants', bearer(jwt, ['admin']), { name: '' }),
    );
    assert.equal(res.status, 400);
    assert.equal((res.body as { field: string }).field, 'name');
    assert.equal(backend.snapshot(), before);
  });

  it('creates a tenant on a fully valid, authorized request (Req 6.1)', async () => {
    const { console, jwt } = makeConsole();
    const res = await console.handle(
      req('POST', '/api/admin/tenants', bearer(jwt, ['tenant:write']), { name: 'acme', plan: 'pro' }),
    );
    assert.equal(res.status, 201);
    assert.match((res.body as { id: string }).id, /[0-9a-f-]{36}/);
  });
});

describe('EnterpriseConsole — per-area operations', () => {
  it('sets each policy type (Req 6.2)', async () => {
    const { console, jwt } = makeConsole();
    const h = bearer(jwt, ['policy:write']);
    assert.equal((await console.handle(req('PUT', '/api/admin/policies/rbac', h, { roles: [{ role: 'admin', permissions: ['*'] }] }))).status, 200);
    assert.equal((await console.handle(req('PUT', '/api/admin/policies/mfa', h, { required: true }))).status, 200);
    assert.equal((await console.handle(req('PUT', '/api/admin/policies/retention', h, { entity: 'orders', retentionDays: 30 }))).status, 200);
    assert.equal((await console.handle(req('PUT', '/api/admin/policies/classification', h, { field: 'ssn', level: 'restricted' }))).status, 200);
  });

  it('rejects an invalid retention value without mutating state (Req 6.8)', async () => {
    const { console, backend, jwt } = makeConsole();
    const before = backend.snapshot();
    const res = await console.handle(
      req('PUT', '/api/admin/policies/retention', bearer(jwt, ['policy:write']), { entity: 'orders', retentionDays: -5 }),
    );
    assert.equal(res.status, 400);
    assert.equal((res.body as { field: string }).field, 'retentionDays');
    assert.equal(backend.snapshot(), before);
  });

  it('serves compliance read operations (Req 6.3)', async () => {
    const { console, jwt } = makeConsole();
    const h = bearer(jwt, ['compliance:read']);
    assert.equal((await console.handle(req('GET', '/api/admin/compliance/report', h))).status, 200);
    assert.equal((await console.handle(req('GET', '/api/admin/compliance/posture', h))).status, 200);
    const exp = await console.handle(req('GET', '/api/admin/compliance/audit-export', h, { from: '2024-01-01', to: '2024-02-01', format: 'jsonl' }));
    assert.equal(exp.status, 200);
  });

  it('rejects an audit export with from after to (Req 6.8)', async () => {
    const { console, jwt } = makeConsole();
    const res = await console.handle(
      req('GET', '/api/admin/compliance/audit-export', bearer(jwt, ['compliance:read']), { from: '2024-03-01', to: '2024-01-01', format: 'csv' }),
    );
    assert.equal(res.status, 400);
    assert.equal((res.body as { field: string }).field, 'from');
  });

  it('runs admin operations: users, key rotation, secrets (Req 6.4)', async () => {
    const { console, jwt } = makeConsole();
    assert.equal((await console.handle(req('POST', '/api/admin/users', bearer(jwt, ['user:write']), { action: 'create', userId: 'u9', roles: ['viewer'] }))).status, 200);
    assert.equal((await console.handle(req('POST', '/api/admin/keys/rotate', bearer(jwt, ['key:rotate']), { keyId: 'signing-1' }))).status, 200);
    assert.equal((await console.handle(req('PUT', '/api/admin/secrets/db-pw', bearer(jwt, ['secret:write']), { value: 's3cr3t' }))).status, 200);
  });

  it('updates and suspends a tenant via path params (Req 6.1)', async () => {
    const { console, jwt } = makeConsole();
    const created = await console.handle(req('POST', '/api/admin/tenants', bearer(jwt, ['admin']), { name: 'acme' }));
    const id = (created.body as { id: string }).id;
    assert.equal((await console.handle(req('PATCH', `/api/admin/tenants/${id}`, bearer(jwt, ['admin']), { plan: 'enterprise' }))).status, 200);
    const suspended = await console.handle(req('POST', `/api/admin/tenants/${id}/suspend`, bearer(jwt, ['admin']), {}));
    assert.equal(suspended.status, 200);
    assert.equal((suspended.body as { status: string }).status, 'suspended');
  });

  it('returns 404 when updating a non-existent tenant', async () => {
    const { console, jwt } = makeConsole();
    const res = await console.handle(req('PATCH', '/api/admin/tenants/missing', bearer(jwt, ['admin']), { plan: 'pro' }));
    assert.equal(res.status, 404);
  });

  it('exposes every operation through routes() (Req 6.9 surface)', () => {
    const { console } = makeConsole();
    const ids = console.routes().map((r) => r.operationId);
    assert.equal(ids.length, 13);
    assert.ok(ids.includes('createTenant'));
    assert.ok(ids.includes('manageSecret'));
  });
});

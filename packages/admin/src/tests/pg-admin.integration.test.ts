// pg-admin.integration.test.ts
// Integration tests for the Postgres AdminStore against a live database.
// Gated on PG env vars (skips DB-free).

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { PgPool } from 'streetjs';
import { AdminService, PgAdminStore, ADMIN_MIGRATION_SQL } from '../index.js';

const HAS_PG = Boolean(process.env['PG_HOST'] && process.env['PG_DATABASE']);

describe('PgAdminStore (live Postgres)', { skip: !HAS_PG ? 'PG_* env not set' : false }, () => {
  let pool: PgPool;
  let a: AdminService;
  let n = 0;

  before(async () => {
    pool = new PgPool({
      host: process.env['PG_HOST']!,
      port: Number(process.env['PG_PORT'] ?? 5432),
      user: process.env['PG_USER'] ?? 'street',
      password: process.env['PG_PASSWORD'] ?? '',
      database: process.env['PG_DATABASE']!,
      maxConnections: 4,
      acquireTimeoutMs: 5_000,
    });
    await pool.query(ADMIN_MIGRATION_SQL);
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE street_admin_audit RESTART IDENTITY');
    await pool.query('TRUNCATE street_admin_users');
    await pool.query('TRUNCATE street_admin_roles');
    a = new AdminService({ store: new PgAdminStore(pool), now: () => ++n, idGen: () => `id${++n}` });
  });

  after(async () => {
    await pool.query('DROP TABLE IF EXISTS street_admin_audit');
    await pool.query('DROP TABLE IF EXISTS street_admin_users');
    await pool.query('DROP TABLE IF EXISTS street_admin_roles');
    await pool.close();
  });

  it('persists users, roles, and role assignment', async () => {
    await a.createRole('root', { name: 'editor', permissions: ['posts:write'] });
    const u = await a.createUser('root', { email: 'jane@acme.com', roles: ['editor'] });
    const fetched = await a.getUser(u.id);
    assert.equal(fetched!.email, 'jane@acme.com');
    assert.deepEqual(fetched!.roles, ['editor']);
    assert.deepEqual((await a.getRole('editor'))!.permissions, ['posts:write']);
  });

  it('enforces authorization through the DB with wildcards & suspension', async () => {
    await a.createRole('root', { name: 'support', permissions: ['users:read', 'tickets:*'] });
    const u = await a.createUser('root', { email: 'u@e.com', roles: ['support'] });
    assert.equal(await a.can(u.id, 'tickets:close'), true);
    assert.equal(await a.can(u.id, 'users:delete'), false);
    await a.suspendUser('root', u.id);
    assert.equal(await a.can(u.id, 'tickets:close'), false);
  });

  it('records and queries the audit log with monotonic seq', async () => {
    await a.createRole('root', { name: 'r' });
    const u = await a.createUser('root', { email: 'u@e.com' });
    await a.assignRole('root', u.id, 'r');
    await a.suspendUser('root', u.id);

    const log = await a.auditLog();
    assert.deepEqual(log.map((e) => e.action), ['user.suspend', 'user.assignRole', 'user.create', 'role.create']);
    assert.equal(await a.auditCount(), 4);
    assert.equal((await a.auditLog({ action: 'user.suspend' }))[0]!.target, u.id);

    // Pagination via the seq cursor.
    const page1 = await a.auditLog({ limit: 2 });
    const page2 = await a.auditLog({ limit: 2, before: page1[1]!.seq });
    assert.ok(page2.every((e) => e.seq < page1[1]!.seq));
  });

  it('rejects duplicate emails at the DB and detaches roles on delete', async () => {
    await a.createUser('root', { email: 'dup@e.com' });
    await assert.rejects(() => a.createUser('root', { email: 'dup@e.com' }), /already exists/);
    await a.createRole('root', { name: 'temp', permissions: ['x:y'] });
    const u = await a.createUser('root', { email: 'u2@e.com', roles: ['temp'] });
    assert.equal(await a.deleteRole('root', 'temp'), true);
    assert.deepEqual((await a.getUser(u.id))!.roles, []);
  });
});

// admin.test.ts
// Unit tests for user/role management, authorization, and the audit log
// (async, store-backed; uses the default in-memory store).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { AdminService, permissionMatches } from '../index.js';

function svc() {
  let n = 0;
  return new AdminService({ now: () => ++n, idGen: () => `id${n}_${Math.random().toString(36).slice(2, 6)}` });
}

describe('permissionMatches', () => {
  it('handles exact, segment, and global wildcards', () => {
    assert.equal(permissionMatches('users:read', 'users:read'), true);
    assert.equal(permissionMatches('users:*', 'users:read'), true);
    assert.equal(permissionMatches('*', 'anything:here'), true);
    assert.equal(permissionMatches('*:read', 'users:read'), true);
    assert.equal(permissionMatches('users:read', 'users:write'), false);
    assert.equal(permissionMatches('users:*', 'orders:read'), false);
    assert.equal(permissionMatches('users', 'users:read'), false);
  });
});

describe('User & role management', () => {
  it('creates roles and users and assigns roles', async () => {
    const a = svc();
    await a.createRole('admin', { name: 'editor', permissions: ['posts:write', 'posts:read'] });
    const u = await a.createUser('admin', { email: 'Jane@Example.com', roles: ['editor'] });
    assert.equal(u.email, 'jane@example.com');
    assert.deepEqual(u.roles, ['editor']);
    assert.equal((await a.getUser(u.id))!.status, 'active');
  });

  it('rejects duplicate emails, invalid emails, and unknown roles', async () => {
    const a = svc();
    await a.createUser('admin', { email: 'x@y.com' });
    await assert.rejects(() => a.createUser('admin', { email: 'x@y.com' }), /already exists/);
    await assert.rejects(() => a.createUser('admin', { email: 'not-an-email' }), /valid email/);
    await assert.rejects(() => a.createUser('admin', { email: 'z@y.com', roles: ['ghost'] }), /Role "ghost" not found/);
  });

  it('validates email shape without ReDoS (linear, backtracking-free)', async () => {
    const a = svc();
    for (const bad of ['', '@y.com', 'a@', 'a@b', 'a@.com', 'a@b.', 'a b@c.com', 'a@b c.com', 'a@@b.com', '!@!.' + '!.'.repeat(50_000)]) {
      await assert.rejects(() => a.createUser('admin', { email: bad }), /valid email/, `should reject "${bad.slice(0, 12)}…"`);
    }
    // The pathological input above also asserts the check returns promptly
    // (a polynomial regex would hang on it).
    const ok = await a.createUser('admin', { email: 'Good.Name@sub.example.com' });
    assert.equal(ok.email, 'good.name@sub.example.com');
  });

  it('assign/revoke roles and suspend/activate', async () => {
    const a = svc();
    await a.createRole('admin', { name: 'mod' });
    const u = await a.createUser('admin', { email: 'u@e.com' });
    await a.assignRole('admin', u.id, 'mod');
    assert.deepEqual((await a.getUser(u.id))!.roles, ['mod']);
    await a.revokeRole('admin', u.id, 'mod');
    assert.deepEqual((await a.getUser(u.id))!.roles, []);
    await a.suspendUser('admin', u.id);
    assert.equal((await a.getUser(u.id))!.status, 'suspended');
    await a.activateUser('admin', u.id);
    assert.equal((await a.getUser(u.id))!.status, 'active');
  });

  it('deleting a role detaches it from users', async () => {
    const a = svc();
    await a.createRole('admin', { name: 'temp', permissions: ['x:y'] });
    const u = await a.createUser('admin', { email: 'u@e.com', roles: ['temp'] });
    assert.equal(await a.deleteRole('admin', 'temp'), true);
    assert.deepEqual((await a.getUser(u.id))!.roles, []);
  });
});

describe('Authorization', () => {
  it('resolves permissions through roles with wildcards', async () => {
    const a = svc();
    await a.createRole('admin', { name: 'support', permissions: ['users:read', 'tickets:*'] });
    const u = await a.createUser('admin', { email: 'u@e.com', roles: ['support'] });
    assert.equal(await a.can(u.id, 'users:read'), true);
    assert.equal(await a.can(u.id, 'tickets:close'), true);
    assert.equal(await a.can(u.id, 'users:delete'), false);
  });

  it('denies suspended and unknown users everything', async () => {
    const a = svc();
    await a.createRole('admin', { name: 'god', permissions: ['*'] });
    const u = await a.createUser('admin', { email: 'u@e.com', roles: ['god'] });
    assert.equal(await a.can(u.id, 'anything:goes'), true);
    await a.suspendUser('admin', u.id);
    assert.equal(await a.can(u.id, 'anything:goes'), false);
    assert.equal(await a.can('no-such-user', 'x:y'), false);
  });

  it('grant/revoke permission changes effective access', async () => {
    const a = svc();
    await a.createRole('admin', { name: 'r', permissions: [] });
    const u = await a.createUser('admin', { email: 'u@e.com', roles: ['r'] });
    assert.equal(await a.can(u.id, 'reports:view'), false);
    await a.grantPermission('admin', 'r', 'reports:view');
    assert.equal(await a.can(u.id, 'reports:view'), true);
    await a.revokePermission('admin', 'r', 'reports:view');
    assert.equal(await a.can(u.id, 'reports:view'), false);
  });
});

describe('Audit log', () => {
  it('records every mutation and queries with filters newest-first', async () => {
    const a = svc();
    await a.createRole('root', { name: 'editor', permissions: ['p:q'] });
    const u = await a.createUser('root', { email: 'u@e.com' });
    await a.assignRole('root', u.id, 'editor');
    await a.suspendUser('root', u.id);

    const all = await a.auditLog();
    assert.deepEqual(all.map((e) => e.action), ['user.suspend', 'user.assignRole', 'user.create', 'role.create']);
    assert.equal(await a.auditCount(), 4);

    const suspends = await a.auditLog({ action: 'user.suspend' });
    assert.equal(suspends.length, 1);
    assert.equal(suspends[0]!.target, u.id);

    assert.equal((await a.auditLog({ actorId: 'root' })).length, 4);
    assert.equal((await a.auditLog({ actorId: 'someone-else' })).length, 0);
  });

  it('paginates with limit and before cursor', async () => {
    const a = svc();
    await a.createRole('root', { name: 'r1' });
    await a.createRole('root', { name: 'r2' });
    await a.createRole('root', { name: 'r3' });
    const page1 = await a.auditLog({ limit: 2 });
    assert.equal(page1.length, 2);
    const page2 = await a.auditLog({ limit: 2, before: page1[page1.length - 1]!.seq });
    assert.ok(page2.every((e) => e.seq < page1[1]!.seq));
  });

  it('no-op mutations do not record audit events', async () => {
    const a = svc();
    await a.createRole('root', { name: 'r' });
    const u = await a.createUser('root', { email: 'u@e.com', roles: ['r'] });
    const before = await a.auditCount();
    await a.assignRole('root', u.id, 'r'); // already has it → no-op
    assert.equal(await a.auditCount(), before);
  });
});

// admin.test.ts
// Unit tests for user/role management, authorization, and the audit log.

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
    assert.equal(permissionMatches('users', 'users:read'), false); // arity mismatch
  });
});

describe('User & role management', () => {
  it('creates roles and users and assigns roles', () => {
    const a = svc();
    a.createRole('admin', { name: 'editor', permissions: ['posts:write', 'posts:read'] });
    const u = a.createUser('admin', { email: 'Jane@Example.com', roles: ['editor'] });
    assert.equal(u.email, 'jane@example.com'); // normalized
    assert.deepEqual(u.roles, ['editor']);
    assert.equal(a.getUser(u.id)!.status, 'active');
  });

  it('rejects duplicate emails, invalid emails, and unknown roles', () => {
    const a = svc();
    a.createUser('admin', { email: 'x@y.com' });
    assert.throws(() => a.createUser('admin', { email: 'x@y.com' }), /already exists/);
    assert.throws(() => a.createUser('admin', { email: 'not-an-email' }), /valid email/);
    assert.throws(() => a.createUser('admin', { email: 'z@y.com', roles: ['ghost'] }), /Role "ghost" not found/);
  });

  it('assign/revoke roles and suspend/activate', () => {
    const a = svc();
    a.createRole('admin', { name: 'mod' });
    const u = a.createUser('admin', { email: 'u@e.com' });
    a.assignRole('admin', u.id, 'mod');
    assert.deepEqual(a.getUser(u.id)!.roles, ['mod']);
    a.revokeRole('admin', u.id, 'mod');
    assert.deepEqual(a.getUser(u.id)!.roles, []);
    a.suspendUser('admin', u.id);
    assert.equal(a.getUser(u.id)!.status, 'suspended');
    a.activateUser('admin', u.id);
    assert.equal(a.getUser(u.id)!.status, 'active');
  });

  it('deleting a role detaches it from users', () => {
    const a = svc();
    a.createRole('admin', { name: 'temp', permissions: ['x:y'] });
    const u = a.createUser('admin', { email: 'u@e.com', roles: ['temp'] });
    assert.equal(a.deleteRole('admin', 'temp'), true);
    assert.deepEqual(a.getUser(u.id)!.roles, []);
  });
});

describe('Authorization', () => {
  it('resolves permissions through roles with wildcards', () => {
    const a = svc();
    a.createRole('admin', { name: 'support', permissions: ['users:read', 'tickets:*'] });
    const u = a.createUser('admin', { email: 'u@e.com', roles: ['support'] });
    assert.equal(a.can(u.id, 'users:read'), true);
    assert.equal(a.can(u.id, 'tickets:close'), true);
    assert.equal(a.can(u.id, 'users:delete'), false);
  });

  it('denies suspended and unknown users everything', () => {
    const a = svc();
    a.createRole('admin', { name: 'god', permissions: ['*'] });
    const u = a.createUser('admin', { email: 'u@e.com', roles: ['god'] });
    assert.equal(a.can(u.id, 'anything:goes'), true);
    a.suspendUser('admin', u.id);
    assert.equal(a.can(u.id, 'anything:goes'), false);
    assert.equal(a.can('no-such-user', 'x:y'), false);
  });

  it('grant/revoke permission changes effective access', () => {
    const a = svc();
    a.createRole('admin', { name: 'r', permissions: [] });
    const u = a.createUser('admin', { email: 'u@e.com', roles: ['r'] });
    assert.equal(a.can(u.id, 'reports:view'), false);
    a.grantPermission('admin', 'r', 'reports:view');
    assert.equal(a.can(u.id, 'reports:view'), true);
    a.revokePermission('admin', 'r', 'reports:view');
    assert.equal(a.can(u.id, 'reports:view'), false);
  });
});

describe('Audit log', () => {
  it('records every mutation and queries with filters newest-first', () => {
    const a = svc();
    a.createRole('root', { name: 'editor', permissions: ['p:q'] });
    const u = a.createUser('root', { email: 'u@e.com' });
    a.assignRole('root', u.id, 'editor');
    a.suspendUser('root', u.id);

    const all = a.auditLog();
    assert.deepEqual(all.map((e) => e.action), ['user.suspend', 'user.assignRole', 'user.create', 'role.create']);
    assert.equal(a.auditCount(), 4);

    // Filter by action and target.
    const suspends = a.auditLog({ action: 'user.suspend' });
    assert.equal(suspends.length, 1);
    assert.equal(suspends[0]!.target, u.id);

    const byActor = a.auditLog({ actorId: 'root' });
    assert.equal(byActor.length, 4);
    assert.equal(a.auditLog({ actorId: 'someone-else' }).length, 0);
  });

  it('paginates with limit and before cursor', () => {
    const a = svc();
    a.createRole('root', { name: 'r1' });
    a.createRole('root', { name: 'r2' });
    a.createRole('root', { name: 'r3' });
    const page1 = a.auditLog({ limit: 2 });
    assert.equal(page1.length, 2);
    const page2 = a.auditLog({ limit: 2, before: page1[page1.length - 1]!.seq });
    assert.ok(page2.every((e) => e.seq < page1[1]!.seq));
  });

  it('no-op mutations do not record audit events', () => {
    const a = svc();
    a.createRole('root', { name: 'r' });
    const u = a.createUser('root', { email: 'u@e.com', roles: ['r'] });
    const before = a.auditCount();
    a.assignRole('root', u.id, 'r'); // already has it → no-op
    assert.equal(a.auditCount(), before);
  });
});

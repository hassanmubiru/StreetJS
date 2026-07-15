import { test, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { PgHaClient } from '../ha.js';
import { PgConnection, type PgResult } from '../wire.js';

/**
 * A controllable fake topology. `roles[host]` decides how the fake connection
 * answers `pg_is_in_recovery()`; `failHosts` makes an app query throw for a host
 * (to drive failover). Mutable between discoveries so we can simulate promotion.
 */
interface Topology {
  roles: Record<string, 'primary' | 'replica'>;
  failHosts: Set<string>;
}

function installMockConnect(topo: Topology): void {
  mock.method(PgConnection, 'connect', async (opts: { host: string }): Promise<PgConnection> => {
    const host = opts.host;
    const conn = {
      async query(sql: string): Promise<PgResult> {
        if (/pg_is_in_recovery/i.test(sql)) {
          const inRecovery = topo.roles[host] === 'replica';
          return { rows: [{ pg_is_in_recovery: inRecovery ? 't' : 'f' }], rowCount: 1, command: 'SELECT' };
        }
        if (topo.failHosts.has(host)) {
          throw new Error(`connection lost to ${host}`);
        }
        return { rows: [{ handled_by: host }], rowCount: 1, command: 'SELECT' };
      },
      async close(): Promise<void> {},
    };
    return conn as unknown as PgConnection;
  });
}

afterEach(() => mock.restoreAll());

const hosts = [
  { host: 'a', port: 5432 },
  { host: 'b', port: 5432 },
];

test('constructor requires at least one host', () => {
  assert.throws(() => new PgHaClient({ hosts: [], user: 'u', password: 'p', database: 'd' }), /at least one host/);
});

test('discovery classifies primary and replica endpoints', async () => {
  installMockConnect({ roles: { a: 'primary', b: 'replica' }, failHosts: new Set() });
  const c = new PgHaClient({ hosts, user: 'u', password: 'p', database: 'd' });
  await c.connect();
  assert.deepEqual(c.primaryEndpoint(), { host: 'a', port: 5432 });
  assert.deepEqual(c.replicaEndpoints(), [{ host: 'b', port: 5432 }]);
  await c.close();
});

test('query with target=primary routes to the primary', async () => {
  installMockConnect({ roles: { a: 'primary', b: 'replica' }, failHosts: new Set() });
  const c = new PgHaClient({ hosts, user: 'u', password: 'p', database: 'd' });
  const r = await c.query('SELECT 1', [], { target: 'primary' });
  assert.equal(r.rows[0].handled_by, 'a');
  await c.close();
});

test('query with target=prefer-replica routes to the replica', async () => {
  installMockConnect({ roles: { a: 'primary', b: 'replica' }, failHosts: new Set() });
  const c = new PgHaClient({ hosts, user: 'u', password: 'p', database: 'd' });
  const r = await c.query('SELECT 1', [], { target: 'prefer-replica' });
  assert.equal(r.rows[0].handled_by, 'b');
  await c.close();
});

test('failover: a lost primary triggers rediscovery and retry against the promoted host', async () => {
  const topo: Topology = { roles: { a: 'primary', b: 'replica' }, failHosts: new Set(['a']) };
  installMockConnect(topo);
  const c = new PgHaClient({ hosts, user: 'u', password: 'p', database: 'd', target: 'primary' });
  await c.connect();
  // Simulate a promotion at the moment failover re-discovers: b becomes primary,
  // a is gone.
  const originalQuery = c.query.bind(c);
  // First query: primary 'a' fails → client drops it, rediscovers. Flip topology
  // so rediscovery promotes 'b'.
  topo.roles = { a: 'replica', b: 'primary' };
  topo.failHosts = new Set(['a']); // 'a' still refuses app queries; 'b' works
  const r = await originalQuery('SELECT 1', [], { target: 'primary' });
  assert.equal(r.rows[0].handled_by, 'b');
  await c.close();
});

test('discovery throws when no host is reachable', async () => {
  mock.method(PgConnection, 'connect', async (): Promise<PgConnection> => {
    throw new Error('ECONNREFUSED');
  });
  const c = new PgHaClient({ hosts, user: 'u', password: 'p', database: 'd' });
  await assert.rejects(c.connect(), /no reachable PostgreSQL host/);
});

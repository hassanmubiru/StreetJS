// src/tests/pg-ha.it.test.ts
// Live PostgreSQL HA integration test (RFC 0003). Self-skips (honest BLOCKED)
// unless a primary+replica topology is reachable via PG_HA_PRIMARY and
// PG_HA_REPLICA (host:port), so it never produces a false red without infra.
//
// Covers discovery + role-targeted routing (non-destructive). Failover
// (promotion + primary loss) is destructive and is validated out-of-band against
// a real promotion, not in the standard suite.
//
// To run locally:
//   primary  = postgres:16 -c wal_level=replica -c max_wal_senders=10 -c hot_standby=on
//   replica  = pg_basebackup -R from the primary, then `postgres`
//   PG_HA_PRIMARY=127.0.0.1:5442 PG_HA_REPLICA=127.0.0.1:5443 node --test ...

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PgHaClient, type PgHaHost } from '../database/ha.js';

function parseHost(v: string | undefined): PgHaHost | null {
  if (!v) return null;
  const [h, p] = v.split(':');
  if (!h || !p) return null;
  return { host: h, port: Number(p) };
}

const primary = parseHost(process.env['PG_HA_PRIMARY']);
const replica = parseHost(process.env['PG_HA_REPLICA']);
const creds = {
  user: process.env['PG_HA_USER'] ?? 'street',
  password: process.env['PG_HA_PASSWORD'] ?? 'streetpass',
  database: process.env['PG_HA_DB'] ?? 'street_ha',
};

async function reachable(): Promise<boolean> {
  if (!primary || !replica) return false;
  const c = new PgHaClient({ hosts: [primary, replica], ...creds, connectTimeoutMs: 4000 });
  try {
    await c.connect();
    const ok = !!c.primaryEndpoint() && c.replicaEndpoints().length > 0;
    await c.close();
    return ok;
  } catch {
    await c.close();
    return false;
  }
}

test('PostgreSQL HA (integration)', async (t) => {
  if (!(await reachable())) {
    t.skip('no PG primary+replica topology — set PG_HA_PRIMARY and PG_HA_REPLICA to run');
    return;
  }

  await t.test('discovers primary and replica roles', async () => {
    const c = new PgHaClient({ hosts: [primary!, replica!], ...creds });
    await c.connect();
    assert.equal(c.primaryEndpoint()?.port, primary!.port, 'primary discovered');
    assert.ok(c.replicaEndpoints().some((r) => r.port === replica!.port), 'replica discovered');
    await c.close();
  });

  await t.test("target 'primary' runs read-write; 'prefer-replica' lands on the standby", async () => {
    const c = new PgHaClient({ hosts: [primary!, replica!], ...creds, target: 'primary' });
    await c.connect();
    const onPrimary = await c.query('SELECT pg_is_in_recovery() AS r', [], { target: 'primary' });
    assert.equal(onPrimary.rows[0]!['r'], 'f', 'primary is not in recovery');
    const onReplica = await c.query('SELECT pg_is_in_recovery() AS r', [], { target: 'prefer-replica' });
    assert.equal(onReplica.rows[0]!['r'], 't', 'prefer-replica routes to a standby (in recovery)');
    await c.close();
  });
});

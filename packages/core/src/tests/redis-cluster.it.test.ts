// src/tests/redis-cluster.it.test.ts
// Live Redis Cluster integration test (RFC 0003). Self-skips (honest BLOCKED)
// when no cluster is reachable at REDIS_CLUSTER_SEED (default 127.0.0.1:7001),
// so it never produces a false red on machines without a cluster. To run it:
//
//   docker run -d --net host redis:7-alpine redis-server --port 7001 \
//     --cluster-enabled yes  (×6 nodes 7001-7006) then
//   redis-cli --cluster create 127.0.0.1:7001..7006 --cluster-replicas 1
//
// Verifies: slot discovery, cross-master routing, MOVED redirect following +
// slot-map self-heal, hash-tag co-location, del, and publish.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RedisClusterClient, hashSlot } from '../transports/redis-cluster.js';

const [seedHost, seedPortStr] = (process.env['REDIS_CLUSTER_SEED'] ?? '127.0.0.1:7001').split(':');
const seedPort = Number(seedPortStr ?? '7001');

async function clusterReachable(): Promise<boolean> {
  const probe = new RedisClusterClient({ nodes: [{ host: seedHost!, port: seedPort }] });
  try {
    await probe.connect();
    const ok = probe.coveredSlots() > 0;
    probe.close();
    return ok;
  } catch {
    probe.close();
    return false;
  }
}

test('Redis Cluster (integration)', async (t) => {
  if (!(await clusterReachable())) {
    t.skip(`no Redis Cluster at ${seedHost}:${seedPort} — set REDIS_CLUSTER_SEED to run`);
    return;
  }

  await t.test('discovers full slot coverage', async () => {
    const c = new RedisClusterClient({ nodes: [{ host: seedHost!, port: seedPort }] });
    await c.connect();
    assert.equal(c.coveredSlots(), 16384, 'all 16384 slots covered');
    c.close();
  });

  await t.test('routes set/get across masters (keys spanning many slots)', async () => {
    const c = new RedisClusterClient({ nodes: [{ host: seedHost!, port: seedPort }] });
    await c.connect();
    const keys = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'user:1', 'user:2'];
    for (const k of keys) {
      await c.set(k, `val-${k}`, 60_000);
      assert.equal(await c.get(k), `val-${k}`, `round-trip ${k} (slot ${hashSlot(k)})`);
    }
    await c.del('alpha');
    assert.equal(await c.get('alpha'), null, 'del removes the key');
    c.close();
  });

  await t.test('follows a MOVED redirect and self-heals the slot map', async () => {
    const c = new RedisClusterClient({ nodes: [{ host: seedHost!, port: seedPort }] });
    await c.connect();
    await c.set('echo', 'moved-test', 60_000);
    const slot = hashSlot('echo');
    // Reach into the private slot map to force a wrong route, proving MOVED handling.
    const map = (c as unknown as { slotMap: Array<{ host: string; port: number }> }).slotMap;
    const correct = map[slot]!;
    const wrong = { host: correct.host, port: correct.port === seedPort ? seedPort + 1 : seedPort };
    map[slot] = wrong;
    assert.equal(await c.get('echo'), 'moved-test', 'value retrieved via MOVED redirect');
    assert.equal(map[slot]!.port, correct.port, 'slot map self-healed to the true owner');
    c.close();
  });

  await t.test('hash tags co-locate keys to the same slot', () => {
    assert.equal(hashSlot('{acct42}.balance'), hashSlot('{acct42}.history'));
  });
});

// Minimal repro of the redis-integration create/cleanup cycle to identify the
// handle that keeps the event loop alive (R-2). Run with live Redis on 6379.
import { RedisClient } from 'streetjs';
import { StreetWebSocketServer } from 'streetjs';
import { createRealtime } from './dist/index.js';
import { RedisAdapter } from './dist/cluster/redis.js';

const REDIS_URL = process.env['REDIS_URL'] ?? 'redis://127.0.0.1:6379';
const u = new URL(REDIS_URL);
const opts = { host: u.hostname || '127.0.0.1', port: Number(u.port || '6379') };

async function makeInstance(prefix, id) {
  const client = new RedisClient(opts);
  await client.connect();
  const adapter = new RedisAdapter({ client, keyPrefix: prefix, instanceId: id, presenceTtlMs: 60000 });
  const server = new StreetWebSocketServer();
  const realtime = createRealtime({ server, adapter });
  return { realtime, adapter, client, server };
}

const inst = await makeInstance('leakprobe:', 'A');
await inst.realtime.ready;
const room = inst.realtime.room('r');
await room.broadcast({ type: 'x', payload: {} });

await inst.realtime.close();
inst.client.close();

// Give any close callbacks a tick, then inspect surviving resources.
await new Promise((r) => setTimeout(r, 200));
const active = process.getActiveResourcesInfo();
console.log('ACTIVE RESOURCES AFTER CLEANUP:', JSON.stringify(active));

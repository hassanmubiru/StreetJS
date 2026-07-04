// Mirror the drop/reconnect redis-integration scenario to find the surviving
// handle (R-2). Run with live Redis on 6379.
import { RedisClient } from 'streetjs';
import { StreetWebSocketServer } from 'streetjs';
import { createRealtime } from './dist/index.js';
import { RedisAdapter } from './dist/cluster/redis.js';

const REDIS_URL = process.env['REDIS_URL'] ?? 'redis://127.0.0.1:6379';
const u = new URL(REDIS_URL);
const opts = { host: u.hostname || '127.0.0.1', port: Number(u.port || '6379') };
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function makeInstance(prefix, id) {
  const client = new RedisClient(opts);
  await client.connect();
  const adapter = new RedisAdapter({ client, keyPrefix: prefix, instanceId: id, presenceTtlMs: 60000 });
  const server = new StreetWebSocketServer();
  const realtime = createRealtime({ server, adapter });
  return { realtime, adapter, client };
}

const prefix = 'leakprobe:' + Date.now() + ':';
const a = await makeInstance(prefix, 'A');
const b = await makeInstance(prefix, 'B');
await a.realtime.ready;
await b.realtime.ready;

// Drop A's underlying connection, broadcast while down, then reconnect.
a.client.close();
await a.realtime.room('r').broadcast({ type: 'x', payload: { t: 'while-down' } });
await delay(100);
await a.client.connect();
await a.realtime.room('r').broadcast({ type: 'x', payload: { t: 'after-reconnect' } });
await delay(100);

// Cleanup exactly like the test.
await a.realtime.close();
a.client.close();
await b.realtime.close();
b.client.close();

await delay(300);
const active = process.getActiveResourcesInfo();
console.log('ACTIVE RESOURCES AFTER CLEANUP:', JSON.stringify(active));

// Reproduce test 1 (join FakeConnection + cross-instance broadcast) + cleanup,
// then report surviving handles (R-2). Run with live Redis on 6379.
import { RedisClient, StreetWebSocketServer } from 'streetjs';
import { createRealtime, FakeConnection } from './dist/index.js';
import { RedisAdapter } from './dist/cluster/redis.js';

const opts = { host: '127.0.0.1', port: 6379 };
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function makeInstance(prefix, id) {
  const client = new RedisClient(opts);
  await client.connect();
  const adapter = new RedisAdapter({ client, keyPrefix: prefix, instanceId: id, presenceTtlMs: 60000 });
  const realtime = createRealtime({ server: new StreetWebSocketServer(), adapter });
  await realtime.room(`${prefix}__ready__`).presence();
  return { realtime, adapter, client };
}

const prefix = 'leak:' + Date.now() + ':';
const a = await makeInstance(prefix, 'A');
const b = await makeInstance(prefix, 'B');

const connB = new FakeConnection({ id: 'b-conn' });
await b.realtime.room('chat').join({ id: 'bob' }, connB);
await a.realtime.room('chat').broadcast({ type: 'message', payload: { text: 'hi' } });
await delay(200);

await a.realtime.close(); a.client.close();
await b.realtime.close(); b.client.close();

await delay(300);
console.log('ACTIVE RESOURCES AFTER CLEANUP:', JSON.stringify(process.getActiveResourcesInfo()));

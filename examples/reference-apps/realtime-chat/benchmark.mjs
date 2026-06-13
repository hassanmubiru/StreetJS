// Throughput benchmark for the Realtime Chat reference app.
//   node examples/reference-apps/realtime-chat/benchmark.mjs
// Connects N subscribers to one room and measures end-to-end fan-out:
// messages published vs. total messages delivered across all clients.

import { WebSocket } from 'ws';
import { performance } from 'node:perf_hooks';
import { createChatServer } from './server.mjs';

const SUBSCRIBERS = Number(process.env.SUBS || 10);
const MESSAGES = Number(process.env.MSGS || 2000);

const app = createChatServer();
const port = await app.listen(0);
const base = `ws://127.0.0.1:${port}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function client(id) {
  const ws = new WebSocket(base, { headers: { authorization: `Bearer user:${id}` } });
  let received = 0;
  ws.on('message', (raw) => { if (JSON.parse(raw.toString('utf8')).type === 'message') received++; });
  const send = (type, payload) => ws.send(JSON.stringify({ type, payload }));
  const opened = new Promise((res) => ws.on('open', res));
  return { ws, get received() { return received; }, send, opened };
}

const subs = Array.from({ length: SUBSCRIBERS }, (_, i) => client(`sub${i}`));
await Promise.all(subs.map((s) => s.opened));
subs.forEach((s) => s.send('join', { room: 'bench' }));
await sleep(100);

const sender = subs[0];
const start = performance.now();
for (let i = 0; i < MESSAGES; i++) sender.send('message', { room: 'bench', text: `m${i}` });

// Wait until deliveries settle (each message fans out to all SUBSCRIBERS).
const expected = MESSAGES * SUBSCRIBERS;
let waited = 0;
while (subs.reduce((a, s) => a + s.received, 0) < expected && waited < 10_000) { await sleep(20); waited += 20; }
const elapsed = (performance.now() - start) / 1000;

const delivered = subs.reduce((a, s) => a + s.received, 0);
console.log(`Realtime Chat throughput benchmark`);
console.log(`  subscribers:        ${SUBSCRIBERS}`);
console.log(`  messages published: ${MESSAGES}`);
console.log(`  deliveries:         ${delivered} / ${expected}`);
console.log(`  elapsed:            ${elapsed.toFixed(3)} s`);
console.log(`  publish rate:       ${Math.round(MESSAGES / elapsed)} msg/s`);
console.log(`  delivery rate:      ${Math.round(delivered / elapsed)} deliveries/s`);

subs.forEach((s) => s.ws.close());
await app.close();
process.exit(delivered === expected ? 0 : 1);

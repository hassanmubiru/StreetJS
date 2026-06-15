// WebSocket scale certification: open N concurrent connections to a live
// StreetWebSocketServer, measure connection stability + connect latency, perform
// a server broadcast and measure delivery + throughput, then close and verify
// the server released every client. Uses the `ws` client (already a dependency).
//
//   WS_CONNECTIONS=1000 node scripts/audit/ws-scale.mjs
//
import { createServer } from 'node:http';
import { StreetWebSocketServer } from 'streetjs';
import { WebSocket } from 'ws';
import { writeFileSync, mkdirSync } from 'node:fs';

const N = Number(process.env.WS_CONNECTIONS ?? 200);   // CI runs 1000/5000/10000
const PORT = 34020, URL = `ws://127.0.0.1:${PORT}`;
const mb = (b) => +(b / 1048576).toFixed(2);

const httpServer = createServer();
const wss = new StreetWebSocketServer({ heartbeatIntervalMs: 30_000, maxConnections: N + 100 });
wss.attach(httpServer, () => { /* connections are tracked by the server */ });
await new Promise((r) => httpServer.listen(PORT, '127.0.0.1', r));

const rssStart = process.memoryUsage().rss;
const sockets = [];
const connectLatencies = [];
let connected = 0, connErrors = 0, received = 0;

await Promise.all(Array.from({ length: N }, () => new Promise((resolve) => {
  const t = Date.now();
  const ws = new WebSocket(URL);
  ws.on('open', () => { connected++; connectLatencies.push(Date.now() - t); sockets.push(ws); resolve(); });
  ws.on('message', () => { received++; });
  ws.on('error', () => { connErrors++; resolve(); });
})));

const rssConnected = process.memoryUsage().rss;
// Allow the server to register all clients, then broadcast once.
await new Promise((r) => setTimeout(r, 200));
const tB = Date.now();
wss.broadcast('certping', { n: 1 });
await new Promise((r) => setTimeout(r, 1000));
const broadcastMs = Date.now() - tB;

const p = connectLatencies.slice().sort((a, b) => a - b);
const pct = (q) => p.length ? p[Math.min(p.length - 1, Math.floor(q * p.length))] : 0;
const deliveryRate = connected ? +((received / connected) * 100).toFixed(1) : 0;
const throughput = broadcastMs ? Math.round((received / broadcastMs) * 1000) : 0;

for (const ws of sockets) ws.close();
await new Promise((r) => setTimeout(r, 500));
const remainingServerClients = wss.clients?.size ?? -1;
await wss.close();
await new Promise((r) => httpServer.close(r));

mkdirSync('artifacts', { recursive: true });
const report = {
  target: N, connected, connErrors,
  connectLatencyMs: { p50: pct(0.5), p95: pct(0.95), max: p[p.length - 1] ?? 0 },
  broadcast: { delivered: received, deliveryRatePct: deliveryRate, broadcastMs, msgsPerSec: throughput },
  memoryMb: { start: mb(rssStart), atPeak: mb(rssConnected), perConn: connected ? +(((rssConnected - rssStart) / connected) / 1024).toFixed(2) + 'KB' : 'n/a' },
  serverClientsAfterClose: remainingServerClients,
};
writeFileSync('artifacts/ws-scale.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

const fail = [];
if (connected < N) fail.push(`only ${connected}/${N} connected (${connErrors} errors)`);
if (deliveryRate < 99) fail.push(`broadcast delivery ${deliveryRate}% < 99%`);
if (remainingServerClients > 0) fail.push(`server leaked ${remainingServerClients} clients after close`);
console.log(fail.length === 0 ? `RESULT: WS scale ${N} ✅` : `RESULT: WS scale ${N} ❌ — ${fail.join('; ')}`);
process.exit(fail.length === 0 ? 0 : 1);

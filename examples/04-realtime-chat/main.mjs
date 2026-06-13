// Realtime chat example — channels, presence, typing, and broadcasting.
//
// Run from the repo root (resolves the local `streetjs` workspace build):
//   npm run build:app -w packages/core
//   node examples/04-realtime-chat/main.mjs
//
// Boots a real WebSocket server, wires each connection into a ChannelHub, and
// drives two real ws clients through join → presence → chat → typing → leave.
// Exits 0 on success so it doubles as an executable smoke test.

import { createServer } from 'node:http';
import { WebSocket } from 'ws';
import { StreetWebSocketServer, StreetSocket, ChannelHub, ChannelEvents } from 'streetjs';

const ROOM = 'general';
const hub = new ChannelHub({ typingTtlMs: 5_000 });

// ── Server ────────────────────────────────────────────────────────────────────
const http = createServer();
const wss = new StreetWebSocketServer({ path: '/ws' });

wss.attach(http, (socket /* StreetSocket */, req) => {
  // The member id comes from the query string (in production, derive it from an
  // authenticated session via the server's authFn).
  const memberId = new URL(req.url, 'http://x').searchParams.get('user') ?? 'anon';

  // Clean up channel membership automatically when the socket closes.
  hub.bind(socket);

  // Join the room and send the joiner the current presence snapshot.
  hub.join(ROOM, memberId, socket);
  socket.emit('presence:snapshot', { channel: ROOM, members: hub.presence(ROOM) });

  // Relay chat messages to everyone else in the room.
  socket.on('chat', (payload) => {
    hub.publish(ROOM, 'chat', { from: memberId, text: payload?.text }, { exceptConnId: socket.id });
  });

  // Relay typing indicators.
  socket.on('typing', (payload) => {
    hub.setTyping(ROOM, memberId, payload?.typing === true, socket);
  });
});

await new Promise((resolve) => http.listen(0, resolve));
const port = http.address().port;
const url = (user) => `ws://127.0.0.1:${port}/ws?user=${user}`;

// ── Tiny promise-based client helper ────────────────────────────────────────────
function connect(user) {
  const ws = new WebSocket(url(user));
  const events = [];
  ws.on('message', (raw) => events.push(JSON.parse(raw.toString('utf8'))));
  const send = (type, payload) => ws.send(JSON.stringify({ type, payload, ts: Date.now() }));
  const ready = new Promise((res) => ws.on('open', res));
  return { ws, events, send, ready, user };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Scenario ────────────────────────────────────────────────────────────────────
const ada = connect('ada');
await ada.ready;
await sleep(30);
console.log('ada joined. presence snapshot:', ada.events.find((e) => e.type === 'presence:snapshot')?.payload);

const bob = connect('bob');
await bob.ready;
await sleep(30);
console.log('server presence after bob joins:', hub.presence(ROOM));
console.log('ada saw presence:join ->', ada.events.find((e) => e.type === ChannelEvents.PresenceJoin)?.payload);

// ada types, then sends a message.
ada.send('typing', { typing: true });
await sleep(20);
console.log('bob saw typing ->', bob.events.find((e) => e.type === ChannelEvents.Typing)?.payload);

ada.send('chat', { text: 'hey bob 👋' });
await sleep(20);
console.log('bob received chat ->', bob.events.find((e) => e.type === 'chat')?.payload);

// bob leaves; ada should see presence:leave.
bob.ws.close();
await sleep(50);
console.log('server presence after bob leaves:', hub.presence(ROOM));
console.log('ada saw presence:leave ->', ada.events.find((e) => e.type === ChannelEvents.PresenceLeave)?.payload);

// ── Assertions (so the example fails loudly if the contract breaks) ──────────────
import assert from 'node:assert/strict';
assert.deepEqual(hub.presence(ROOM), ['ada'], 'only ada should remain present');
assert.ok(bob.events.some((e) => e.type === 'chat'), 'bob must receive the chat message');
assert.ok(bob.events.some((e) => e.type === ChannelEvents.Typing), 'bob must receive the typing indicator');
assert.ok(ada.events.some((e) => e.type === ChannelEvents.PresenceLeave), 'ada must see bob leave');

ada.ws.close();
await wss.close();
await new Promise((resolve) => http.close(resolve));
console.log('\n✅ realtime chat example completed successfully');

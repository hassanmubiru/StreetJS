// Multiplayer updates example — players broadcast position updates to a room,
// excluding the sender, with presence tracking.
//
//   npm run build:app -w packages/core
//   node examples/06-multiplayer/main.mjs
//
// Three players join a room; each move is relayed to the OTHER players only.
// Asserts senders don't receive their own moves and peers do, then exits 0.

import { createServer } from 'node:http';
import { WebSocket } from 'ws';
import { StreetWebSocketServer, ChannelHub, ChannelEvents } from 'streetjs';

const ROOM = 'arena-1';
const hub = new ChannelHub();

const http = createServer();
const wss = new StreetWebSocketServer();
wss.attach(http, (socket, req) => {
  const player = req.headers['x-user'];
  hub.bind(socket);
  hub.join(ROOM, player, socket);

  // Relay moves to everyone else in the room (authoritative server would
  // validate here); exclude the sender so clients don't echo their own input.
  socket.on('move', (payload) => {
    hub.publish(ROOM, 'move', { player, ...payload }, { exceptMemberId: player });
  });
});

await new Promise((r) => http.listen(0, r));
const port = http.address().port;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function player(name) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`, { headers: { 'x-user': name } });
  const moves = [];
  const joins = [];
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString('utf8'));
    if (m.type === 'move') moves.push(m.payload);
    if (m.type === ChannelEvents.PresenceJoin) joins.push(m.payload.memberId);
  });
  const send = (type, payload) => ws.send(JSON.stringify({ type, payload, ts: Date.now() }));
  return { ws, moves, joins, send, ready: new Promise((res) => ws.on('open', res)) };
}

const p1 = player('p1');
await p1.ready; await sleep(20);
const p2 = player('p2');
await p2.ready; await sleep(20);
const p3 = player('p3');
await p3.ready; await sleep(30);

console.log('players in arena:', hub.presence(ROOM));
console.log('p1 saw joins:', p1.joins); // p2, p3 joined after p1

// p1 moves; p2 and p3 should see it, p1 should not.
p1.send('move', { x: 10, y: 5 });
await sleep(40);
console.log('p1 own moves (should be empty):', p1.moves);
console.log('p2 saw moves:', p2.moves);
console.log('p3 saw moves:', p3.moves);

import assert from 'node:assert/strict';
assert.equal(p1.moves.length, 0, 'sender must not receive its own move');
assert.deepEqual(p2.moves, [{ player: 'p1', x: 10, y: 5 }]);
assert.deepEqual(p3.moves, [{ player: 'p1', x: 10, y: 5 }]);
assert.deepEqual(p1.joins, ['p2', 'p3']);

// p2 leaves; presence updates.
p2.ws.close();
await sleep(50);
console.log('arena after p2 leaves:', hub.presence(ROOM));
assert.deepEqual(hub.presence(ROOM).sort(), ['p1', 'p3']);

p1.ws.close();
p3.ws.close();
await wss.close();
await new Promise((r) => http.close(r));
console.log('\n✅ multiplayer example completed successfully');

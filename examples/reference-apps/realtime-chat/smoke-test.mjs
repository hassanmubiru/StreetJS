// End-to-end smoke test for the Realtime Chat reference app.
//   node examples/reference-apps/realtime-chat/smoke-test.mjs
// Boots the real server, drives real ws clients, asserts the flows, exits 0.

import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { createChatServer } from './server.mjs';

const app = createChatServer();
const port = await app.listen(0);
const base = `ws://127.0.0.1:${port}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function client(token) {
  const ws = new WebSocket(base, { headers: { authorization: `Bearer ${token}` } });
  const events = [];
  ws.on('message', (raw) => events.push(JSON.parse(raw.toString('utf8'))));
  const send = (type, payload) => ws.send(JSON.stringify({ type, payload, ts: Date.now() }));
  const opened = new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  const closed = new Promise((res) => ws.on('close', (code) => res(code)));
  return { ws, events, send, opened, closed };
}

let failures = 0;
function check(name, fn) { try { fn(); console.log('  ok  ' + name); } catch (e) { failures++; console.log('  FAIL ' + name + ': ' + e.message); } }

// 1) Unauthorized connection is rejected at upgrade.
const bad = client('not-a-valid-token');
let rejected = false;
try { await bad.opened; } catch { rejected = true; }
check('unauthorized upgrade rejected', () => assert.ok(rejected));

// 2) Two authenticated users.
const ada = client('user:ada');
const bob = client('user:bob');
await Promise.all([ada.opened, bob.opened]);

ada.send('join', { room: 'general' });
await sleep(30);
bob.send('join', { room: 'general' });
await sleep(40);

check('ada got presence snapshot', () => {
  const snap = ada.events.find((e) => e.type === 'presence:snapshot');
  assert.ok(snap && snap.payload.members.includes('ada'));
});
check('ada saw bob join (presence:join)', () =>
  assert.ok(ada.events.some((e) => e.type === app.ChannelEvents.PresenceJoin && e.payload.memberId === 'bob')));

// 3) Messaging with history.
ada.send('message', { room: 'general', text: 'hello bob' });
await sleep(40);
check('bob received the message', () =>
  assert.ok(bob.events.some((e) => e.type === 'message' && e.payload.text === 'hello bob' && e.payload.from === 'ada')));
check('sender also received its message', () =>
  assert.ok(ada.events.some((e) => e.type === 'message' && e.payload.text === 'hello bob')));

// 4) Late joiner gets history.
const cat = client('user:cat');
await cat.opened;
cat.send('join', { room: 'general' });
await sleep(40);
check('late joiner receives history', () => {
  const h = cat.events.find((e) => e.type === 'history');
  assert.ok(h && h.payload.messages.some((m) => m.text === 'hello bob'));
});

// 5) Typing indicator.
ada.send('typing', { room: 'general', typing: true });
await sleep(30);
check('peers see typing', () =>
  assert.ok(bob.events.some((e) => e.type === app.ChannelEvents.Typing && e.payload.memberId === 'ada' && e.payload.typing === true)));

// 6) Presence leave on disconnect.
bob.ws.close();
await sleep(60);
check('presence updates after leave', () => assert.deepEqual(app.hub.presence('general').sort(), ['ada', 'cat']));

ada.ws.close(); cat.ws.close();
await app.close();

console.log(failures === 0 ? '\n✅ realtime-chat reference app: all checks passed' : `\n❌ ${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);

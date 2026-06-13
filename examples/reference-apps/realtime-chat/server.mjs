// Realtime Chat — StreetJS reference application.
//
// A production-shaped realtime chat backend built on the verified StreetJS
// primitives: StreetWebSocketServer (auth on upgrade, heartbeat) + ChannelHub
// (rooms, reference-counted presence, typing, scoped broadcast). Adds a bounded
// in-memory message history per room and HTTP health endpoints.
//
// Exported as createChatServer() so it can be embedded and tested; run directly
// (`node server.mjs`) to start a standalone instance.

import { createServer as createHttp } from 'node:http';
import { StreetWebSocketServer, ChannelHub, ChannelEvents } from 'streetjs';

const MAX_HISTORY = 50;

/**
 * Create the chat server. Returns handles for embedding/testing.
 * @param {object} [opts]
 * @param {(token: string) => string|null} [opts.authenticate] token -> userId, or null to reject
 */
export function createChatServer(opts = {}) {
  const authenticate = opts.authenticate ?? defaultAuth;
  const hub = new ChannelHub({ typingTtlMs: 5000 });
  /** room -> array of {from, text, ts} (bounded) */
  const history = new Map();

  const http = createHttp((req, res) => {
    // Health endpoints (liveness has no deps; readiness is trivially ok here).
    if (req.url === '/health/live') return json(res, 200, { status: 'ok' });
    if (req.url === '/health/ready') return json(res, 200, { status: 'ok', checks: { hub: 'up' } });
    if (req.url === '/rooms') {
      return json(res, 200, { rooms: hub.channelNames().map((r) => ({ room: r, members: hub.presence(r) })) });
    }
    json(res, 404, { error: 'not found' });
  });

  const wss = new StreetWebSocketServer({
    heartbeatIntervalMs: 30_000,
    // Security: authenticate the upgrade. Reject (401) when the token is invalid.
    authFn: (req) => authenticate(tokenFrom(req)) !== null,
  });

  wss.attach(http, (socket, req) => {
    const userId = authenticate(tokenFrom(req));
    if (!userId) { socket.close(1008, 'unauthorized'); return; }

    hub.bind(socket); // auto-cleanup on disconnect

    socket.on('join', (p) => {
      const room = requireStr(p?.room);
      if (!room) return;
      hub.join(room, userId, socket);
      // Send the joiner presence + recent history.
      socket.emit('presence:snapshot', { room, members: hub.presence(room) });
      socket.emit('history', { room, messages: history.get(room) ?? [] });
    });

    socket.on('leave', (p) => {
      const room = requireStr(p?.room);
      if (room) hub.leave(room, userId, socket);
    });

    socket.on('message', (p) => {
      const room = requireStr(p?.room);
      const text = requireStr(p?.text);
      if (!room || !text) return;
      const msg = { from: userId, text: text.slice(0, 4000), ts: Date.now() };
      appendHistory(history, room, msg);
      hub.publish(room, 'message', msg); // includes sender (so their UI confirms)
    });

    socket.on('typing', (p) => {
      const room = requireStr(p?.room);
      if (room) hub.setTyping(room, userId, p?.typing === true, socket);
    });
  });

  return {
    http,
    hub,
    /** Start listening; resolves with the bound port. */
    listen(port = 0) {
      return new Promise((resolve) => http.listen(port, () => resolve(http.address().port)));
    },
    async close() {
      await wss.close();
      await new Promise((resolve) => http.close(resolve));
    },
    ChannelEvents,
  };
}

function appendHistory(history, room, msg) {
  let arr = history.get(room);
  if (!arr) { arr = []; history.set(room, arr); }
  arr.push(msg);
  if (arr.length > MAX_HISTORY) arr.shift();
}

function tokenFrom(req) {
  const auth = req.headers['authorization'];
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) return auth.slice(7);
  return req.headers['x-token'] ?? '';
}

// Demo auth: token "user:<id>" -> <id>. Replace with JWT verification (streetjs
// JwtService) in production.
function defaultAuth(token) {
  if (typeof token === 'string' && token.startsWith('user:') && token.length > 5) return token.slice(5);
  return null;
}

function requireStr(v) { return typeof v === 'string' && v.length > 0 ? v : ''; }
function json(res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

// Standalone run.
if (import.meta.url === `file://${process.argv[1]}`) {
  const app = createChatServer();
  const port = await app.listen(Number(process.env.PORT) || 3000);
  console.log(`[chat] listening on http://0.0.0.0:${port}`);
}

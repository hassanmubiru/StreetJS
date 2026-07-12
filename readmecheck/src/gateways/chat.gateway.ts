// src/gateways/chat.gateway.ts
// Example WebSocket gateway for real-time chat.
// Attached to the HTTP server via StreetWebSocketServer.attach().

import { StreetSocket } from 'streetjs';
import type { IncomingMessage } from 'node:http';

interface ChatMessage {
  type: 'message' | 'join' | 'leave';
  user: string;
  text: string;
  timestamp: number;
}

// Unique client ID generator
let nextClientId = 1;

const connections = new Map<number, { socket: StreetSocket; user: string; clientId: number }>();

// This handler is already wired in src/main.ts:
//   wsServer.attach(app.server, chatConnectionHandler);
// (`app.server` is the app's underlying http.Server; attach adds the upgrade
// handler on the same port that serves HTTP.) Edit the logic below to taste.
//   httpServer.listen(port, host);

// Clients speak the StreetSocket envelope protocol: each frame is JSON
// `{ "type": "<name>", "payload": <data> }`, and a handler registered with
// `socket.on('<name>', fn)` receives the **payload**. Broadcasts arrive back as
// `{ "type": "chat", "payload": <ChatMessage> }`. Example client frames:
//   { "type": "join",    "payload": { "user": "alice" } }
//   { "type": "message", "payload": { "text": "hello" } }

/** WebSocket connection handler — called for each new connection. */
export function chatConnectionHandler(socket: StreetSocket, _req: IncomingMessage): void {
  const clientId = nextClientId++;
  let userName = `Anonymous-${clientId}`;

  socket.on('join', (payload: unknown) => {
    const user = (payload as { user?: string } | undefined)?.user;
    userName = (typeof user === 'string' && user.trim()) || userName;
    connections.set(clientId, { socket, user: userName, clientId });
    broadcast({ type: 'join', user: userName, text: `${userName} joined the chat`, timestamp: Date.now() });
  });

  socket.on('message', (payload: unknown) => {
    if (!connections.has(clientId)) connections.set(clientId, { socket, user: userName, clientId });
    const text = (payload as { text?: string } | undefined)?.text ?? '';
    broadcast({ type: 'message', user: userName, text: String(text), timestamp: Date.now() });
  });

  // StreetSocket teardown is via onClose(), not on('close').
  socket.onClose(() => {
    connections.delete(clientId);
    broadcast({ type: 'leave', user: userName, text: `${userName} left the chat`, timestamp: Date.now() });
  });
}

/** Fan a ChatMessage out to every connected client as a `chat` event. */
function broadcast(message: ChatMessage): void {
  for (const [, conn] of connections) {
    try {
      conn.socket.emit('chat', message);
    } catch {
      // Socket may have closed — remove it
      connections.delete(conn.clientId);
    }
  }
}

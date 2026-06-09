---
layout:    default
title:     "WebSockets"
parent:    "Realtime"
nav_order: 1
permalink: /realtime/websocket/
description: "WebSocket server in Street Framework — bounded connections, heartbeat, typed events, gateways."
---

# WebSockets

Street includes a bounded WebSocket server built on the `ws` library. It enforces a maximum connection count, sends periodic heartbeats to detect dead connections, and exposes a typed event emitter API.

---

## Setup

```typescript
import 'reflect-metadata';
import {
  streetApp, StreetWebSocketServer, StreetSocket,
  container, TelemetryTracker,
} from 'streetjs';

const app = streetApp({ port: 3000 });

const wss = new StreetWebSocketServer({
  heartbeatIntervalMs: 30_000,   // ping every 30s
  maxConnections:      10_000,   // reject with 1013 when exceeded
});
container.register(StreetWebSocketServer, wss);

// Handle new connections
wss.on('connection', (socket: StreetSocket) => {
  console.log('Client connected');

  socket.on('message', (data: unknown) => {
    console.log('Received:', data);
    socket.emit('echo', data);
  });

  socket.on('close', () => {
    console.log('Client disconnected');
  });
});

await app.listen();
```

---

## StreetSocket API

Each connected client is represented by a `StreetSocket` instance:

```typescript
// Send a typed event to this client
socket.emit('eventName', payload);

// Listen for events from this client
socket.on('eventName', (data: unknown) => { /* ... */ });

// Remove a listener
socket.off('eventName', handler);

// Check if socket is still open
if (!socket.closed) {
  socket.emit('update', { ts: Date.now() });
}

// Close the connection
socket.close(1000, 'Normal closure');
```

---

## Broadcasting

Send a message to all connected clients:

```typescript
// Broadcast to all clients
wss.broadcast('announcement', { text: 'Server restarting in 60s' });

// Broadcast to a subset (manual filter)
for (const socket of wss.clients) {
  if (socket.userId === targetUserId) {
    socket.emit('notification', { message: 'You have a new message' });
  }
}
```

---

## Chat gateway example

A complete real-time chat implementation:

```typescript
// src/gateways/chat.gateway.ts
import { StreetSocket } from 'streetjs';
import type { IncomingMessage } from 'node:http';

interface ChatMessage {
  type: 'join' | 'message' | 'leave';
  user: string;
  text: string;
  timestamp: number;
}

const connections = new Map<string, { socket: StreetSocket; user: string }>();

export function chatConnectionHandler(
  socket: StreetSocket,
  _req: IncomingMessage
): void {
  const clientId = crypto.randomUUID();
  let userName = `Anonymous-${clientId.slice(0, 6)}`;

  socket.on('message', (data: unknown) => {
    const msg = data as ChatMessage;

    switch (msg.type) {
      case 'join':
        userName = msg.user || userName;
        connections.set(clientId, { socket, user: userName });
        broadcast({ type: 'join', user: userName, text: `${userName} joined`, timestamp: Date.now() });
        break;

      case 'message':
        broadcast({ type: 'message', user: userName, text: msg.text, timestamp: Date.now() });
        break;
    }
  });

  socket.on('close', () => {
    connections.delete(clientId);
    broadcast({ type: 'leave', user: userName, text: `${userName} left`, timestamp: Date.now() });
  });
}

function broadcast(msg: ChatMessage): void {
  const data = JSON.stringify(msg);
  for (const [id, conn] of connections) {
    try {
      conn.socket.emit('chat', data);
    } catch {
      connections.delete(id);
    }
  }
}
```

Register in `main.ts`:

```typescript
import { chatConnectionHandler } from './gateways/chat.gateway.js';

wss.on('connection', chatConnectionHandler);
```

---

## Authenticated WebSocket connections

Validate a JWT token from the query string on connection:

```typescript
import { JwtService, container } from 'streetjs';
import type { IncomingMessage } from 'node:http';

wss.on('connection', (socket: StreetSocket, req: IncomingMessage) => {
  const url = new URL(req.url ?? '/', `http://localhost`);
  const token = url.searchParams.get('token');

  if (!token) {
    socket.close(4001, 'Unauthorized');
    return;
  }

  const jwt = container.resolve(JwtService);
  try {
    const payload = jwt.verify(token) as { userId: string };
    (socket as StreetSocket & { userId: string }).userId = payload.userId;
  } catch {
    socket.close(4001, 'Invalid token');
    return;
  }

  // Connection is authenticated — proceed
  socket.emit('connected', { userId: (socket as any).userId });
});
```

---

## Connection stats

```typescript
// Current connection count
console.log(wss.connectionCount);

// All active sockets
for (const socket of wss.clients) {
  console.log(socket.closed ? 'dead' : 'alive');
}
```

---

## Graceful shutdown

```typescript
process.once('SIGTERM', async () => {
  await wss.close();   // closes all connections, stops accepting new ones
  await pool.close();
  process.exit(0);
});
```

---

## Server-Sent Events (SSE)

For one-way server-to-client streaming, use SSE instead of WebSockets:

```typescript
import { createSse } from 'streetjs';
import type { StreetContext } from 'streetjs';

@Controller('/api/events')
class EventController {
  @Get('/stream')
  async stream(ctx: StreetContext): Promise<void> {
    const sse = createSse(ctx.res, 15_000);  // 15s heartbeat

    const interval = setInterval(() => {
      if (sse.closed) { clearInterval(interval); return; }
      sse.send({ time: new Date().toISOString() }, 'tick');
    }, 1000);

    ctx.req.once('close', () => {
      clearInterval(interval);
      sse.close();
    });
  }
}
```

Client-side:

```javascript
const es = new EventSource('/api/events/stream');
es.addEventListener('tick', (e) => {
  console.log(JSON.parse(e.data));
});
```

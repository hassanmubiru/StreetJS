---
layout:    default
title:     "WebSockets & Realtime"
parent:    "Tutorials"
nav_order: 5
permalink: /tutorials/realtime/
description: "Build realtime features in StreetJS — WebSocket server, channels, presence, typing indicators, and live notifications, plus the client hooks that consume them."
---

# WebSockets & Realtime

**Level:** Intermediate · **Time:** ~25 minutes · **Prerequisites:** [Your First API](/tutorials/first-api/)

StreetJS includes a WebSocket server (`StreetWebSocketServer`) with heartbeats and
connection limits, plus a `ChannelHub` for pub/sub, presence, and typing. This
tutorial builds a chat backend and connects a browser client.

---

## 1. Attach a WebSocket server

The WS server attaches to a Node HTTP server. Create a connection handler and
broadcast to all peers:

```typescript
// src/gateways/chat.gateway.ts
import type { StreetSocket } from 'streetjs';
import type { IncomingMessage } from 'node:http';

interface ChatMessage { type: 'join' | 'message'; user: string; text: string; ts: number; }

const peers = new Map<number, StreetSocket>();
let nextId = 1;

export function chatHandler(socket: StreetSocket, _req: IncomingMessage): void {
  const id = nextId++;
  peers.set(id, socket);

  socket.on('message', (data: unknown) => {
    const msg = data as ChatMessage;
    broadcast({ type: 'message', user: msg.user, text: msg.text, ts: Date.now() });
  });

  socket.on('close', () => { peers.delete(id); });
}

function broadcast(msg: ChatMessage): void {
  const payload = JSON.stringify(msg);
  for (const [id, s] of peers) {
    try { s.emit('chat', payload); }
    catch { peers.delete(id); }
  }
}
```

Wire it in `main.ts`:

```typescript
import { createServer } from 'node:http';
import { StreetWebSocketServer } from 'streetjs';
import { chatHandler } from './gateways/chat.gateway.js';

const wss = new StreetWebSocketServer({ heartbeatIntervalMs: 30_000, maxConnections: 10_000 });
const httpServer = createServer(/* your street app handler */);
wss.attach(httpServer, chatHandler);
httpServer.listen(3000);
```

The heartbeat detects dead connections; `maxConnections` bounds memory under load.

---

## 2. Channels, presence & typing

For multi-room chat, presence, and typing indicators, use `ChannelHub` instead of
a single peer map:

```typescript
import { ChannelHub } from 'streetjs';

const hub = new ChannelHub({ typingTtlMs: 5000 });
// Subscribe sockets to named channels, publish messages to a channel, and track
// who is present / typing — without you re-implementing fan-out and TTL logic.
```

Use channels to scope broadcasts (e.g. `room:42`) so a message only reaches
subscribers of that room. See [Realtime Channels](/realtime-channels/) for the
full channel/presence API.

---

## 3. Live notifications

Two common patterns:

- **Push over a channel** — publish a `notification` message to a per-user
  channel (`user:<id>`) the client subscribes to on login.
- **Server-Sent Events (SSE)** — for one-way streams (feeds, progress), stream
  from a normal controller. See [Examples](/examples/) for an SSE walkthrough.

---

## 4. Consume realtime from the client

With [`@streetjs/client`](https://www.npmjs.com/package/@streetjs/client) and the
framework hooks you subscribe in a few lines. React:

```tsx
import { useChannel, useRealtime } from '@streetjs/react';

function ChatRoom() {
  const rt = useRealtime();                 // connects on mount, closes on unmount
  useChannel<{ user: string; text: string }>('chat', (msg) => {
    console.log(msg.data.user, msg.data.text);
  });
  return <button onClick={() => rt.send('chat', { user: 'me', text: 'hi' })}>Send</button>;
}
```

The same composables exist for Vue (`useRealtime`, `useChannel`) via
[`@streetjs/vue`](https://www.npmjs.com/package/@streetjs/vue). See
[Full-Stack with React](/tutorials/fullstack-react/) for the full wiring.

---

## Production considerations

- **Scaling out:** a `ChannelHub` is per-process. To broadcast across multiple
  instances, back channels with a pub/sub transport (e.g. the Redis or NATS
  plugin) so messages fan out between nodes.
- **Auth:** validate a JWT on connection (read it from the first message or a
  query param) before subscribing the socket to user-scoped channels.
- **Backpressure:** cap `maxConnections` and drop/disconnect slow consumers.

## Troubleshooting

| Symptom | Cause / fix |
|---------|-------------|
| Connections drop after ~30s | Client isn't responding to heartbeats — ensure you use a compliant WS client (`@streetjs/client` handles this). |
| Messages not received in other tabs | You broadcast to a single peer map across processes — use `ChannelHub` + a pub/sub plugin to scale out. |
| Memory grows under churn | Remove sockets on `close` (as shown) and set `maxConnections`. |

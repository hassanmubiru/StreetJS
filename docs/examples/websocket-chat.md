---
layout:    default
title:     "WebSocket Chat"
parent:    "Examples"
nav_order: 2
permalink: /examples/websocket-chat/
description: "Real-time WebSocket chat example with Street Framework — rooms, authentication, broadcast."
---

# Example: WebSocket Chat

A real-time chat server with rooms, JWT authentication, and broadcast messaging.

---

## Gateway

```typescript
// src/gateways/chat.gateway.ts
import { StreetSocket, container, JwtService } from '@streetjs/core';
import type { IncomingMessage } from 'node:http';

interface ChatUser { id: string; name: string; }
interface ChatMessage { type: 'join'|'message'|'leave'|'error'; room: string; user: string; text: string; ts: number; }

// room → Map<clientId, { socket, user }>
const rooms = new Map<string, Map<string, { socket: StreetSocket; user: ChatUser }>>();

export function chatHandler(socket: StreetSocket, req: IncomingMessage): void {
  // Authenticate via ?token=<jwt>
  const url   = new URL(req.url ?? '/', 'http://localhost');
  const token = url.searchParams.get('token');
  const room  = url.searchParams.get('room') ?? 'general';

  let user: ChatUser;
  try {
    const jwt = container.resolve(JwtService);
    user = jwt.verify(token ?? '') as ChatUser;
  } catch {
    socket.close(4001, 'Unauthorized');
    return;
  }

  const clientId = crypto.randomUUID();

  // Join room
  if (!rooms.has(room)) rooms.set(room, new Map());
  rooms.get(room)!.set(clientId, { socket, user });

  broadcastToRoom(room, { type: 'join', room, user: user.name, text: `${user.name} joined`, ts: Date.now() });
  socket.emit('joined', { room, users: getRoomUsers(room) });

  // Handle messages
  socket.on('message', (data: unknown) => {
    const msg = data as { text: string };
    if (!msg?.text?.trim()) return;
    broadcastToRoom(room, { type: 'message', room, user: user.name, text: msg.text.trim(), ts: Date.now() });
  });

  // Handle disconnect
  socket.on('close', () => {
    rooms.get(room)?.delete(clientId);
    if (rooms.get(room)?.size === 0) rooms.delete(room);
    broadcastToRoom(room, { type: 'leave', room, user: user.name, text: `${user.name} left`, ts: Date.now() });
  });
}

function broadcastToRoom(room: string, msg: ChatMessage): void {
  const members = rooms.get(room);
  if (!members) return;
  const data = JSON.stringify(msg);
  for (const [id, conn] of members) {
    try { conn.socket.emit('chat', data); }
    catch { members.delete(id); }
  }
}

function getRoomUsers(room: string): string[] {
  return [...(rooms.get(room)?.values() ?? [])].map(c => c.user.name);
}
```

---

## Register in main.ts

```typescript
import { StreetWebSocketServer, JwtService, container } from '@streetjs/core';
import { chatHandler } from './gateways/chat.gateway.js';

const wss = new StreetWebSocketServer({ heartbeatIntervalMs: 30_000, maxConnections: 5_000 });
container.register(StreetWebSocketServer, wss);
container.register(JwtService, new JwtService(process.env['JWT_SECRET']!));

wss.on('connection', chatHandler);
```

---

## Browser client

```html
<!DOCTYPE html>
<html>
<head><title>Street Chat</title></head>
<body>
  <div id="messages"></div>
  <input id="text" placeholder="Message..." />
  <button onclick="send()">Send</button>

  <script>
    const token = 'your-jwt-token';
    const room  = 'general';
    const ws    = new WebSocket(`ws://localhost:3000?token=${token}&room=${room}`);

    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === 'chat') {
        const div = document.createElement('div');
        div.textContent = `[${msg.user}] ${msg.text}`;
        document.getElementById('messages').appendChild(div);
      }
    };

    function send() {
      const text = document.getElementById('text').value.trim();
      if (text) ws.send(JSON.stringify({ text }));
      document.getElementById('text').value = '';
    }
  </script>
</body>
</html>
```

---

## Test with wscat

```bash
npm install -g wscat

# Connect to the chat room
wscat -c 'ws://localhost:3000?token=<jwt>&room=general'

# Send a message
> {"text":"Hello everyone!"}

# Receive
< {"type":"message","room":"general","user":"Alice","text":"Hello everyone!","ts":1234567890}
```

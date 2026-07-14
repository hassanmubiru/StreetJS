/**
 * Runnable example: `node dist/examples/integration.js`
 *
 * Starts a real WebSocket server, connects a client, exchanges a chat message
 * routed through a ChannelHub (presence + broadcast), then shuts down.
 */

import { createServer } from 'node:http';
import { WebSocket } from 'ws';
import { StreetWebSocketServer, ChannelHub } from '../index.js';

async function main(): Promise<void> {
  const server = createServer();
  const wss = new StreetWebSocketServer({ path: '/ws' });
  const hub = new ChannelHub();

  wss.attach(server, (socket) => {
    hub.bind(socket);
    hub.join('lobby', socket.id, socket);
    socket.on('chat', (text) => hub.publish('lobby', 'chat', { from: socket.id, text }));
    socket.emit('welcome', { members: hub.memberCount('lobby') });
  });

  const port = await new Promise<number>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve(typeof addr === 'object' && addr ? addr.port : 0);
    });
  });

  const client = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  await new Promise((r) => client.once('open', r));

  client.on('message', (raw: Buffer) => {
    const msg = JSON.parse(raw.toString());
    process.stdout.write(`client received: ${msg.type} ${JSON.stringify(msg.payload)}\n`);
  });

  client.send(JSON.stringify({ type: 'chat', payload: 'hello room', ts: Date.now() }));
  await new Promise((r) => setTimeout(r, 50));

  process.stdout.write(`server connections: ${wss.connectionCount}, lobby members: ${hub.memberCount('lobby')}\n`);

  client.close();
  await wss.close();
  await new Promise<void>((r) => server.close(() => r()));
}

void main();

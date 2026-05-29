// src/websocket/server.ts
// WebSocket server with heartbeat, bounded listeners, and proper cleanup.

import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage, Server } from 'node:http';

export type WsHandler = (socket: StreetSocket, req: IncomingMessage) => void;

export interface WsEvent {
  type: string;
  payload: unknown;
  ts: number;
}

export class StreetSocket {
  private readonly listeners = new Map<string, Set<(data: unknown) => void>>();
  private readonly MAX_LISTENERS = 64;
  private _closed = false;

  constructor(private readonly ws: WebSocket) {
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString('utf8')) as WsEvent;
        const handlers = this.listeners.get(msg.type);
        if (handlers) {
          for (const h of handlers) h(msg.payload);
        }
        // Also fire wildcard
        const wild = this.listeners.get('*');
        if (wild) {
          for (const h of wild) h(msg);
        }
      } catch {
        // Ignore malformed frames
      }
    });

    ws.on('close', () => {
      this._closed = true;
      this.listeners.clear();
    });

    ws.on('error', () => {
      this._closed = true;
      this.listeners.clear();
    });
  }

  on(event: string, handler: (data: unknown) => void): this {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    if (set.size >= this.MAX_LISTENERS) {
      throw new Error(`Too many listeners for event "${event}"`);
    }
    set.add(handler);
    return this;
  }

  off(event: string, handler: (data: unknown) => void): this {
    this.listeners.get(event)?.delete(handler);
    return this;
  }

  emit(type: string, payload: unknown): void {
    if (this._closed || this.ws.readyState !== WebSocket.OPEN) return;
    const msg: WsEvent = { type, payload, ts: Date.now() };
    this.ws.send(JSON.stringify(msg));
  }

  close(code = 1000, reason = ''): void {
    if (!this._closed) {
      this.ws.close(code, reason);
    }
  }

  get closed(): boolean { return this._closed; }
  get readyState(): number { return this.ws.readyState; }
}

export interface WsServerOptions {
  path?: string;
  heartbeatIntervalMs?: number;
  maxConnections?: number;
}

export class StreetWebSocketServer {
  private readonly wss: WebSocketServer;
  private readonly clients = new Set<WebSocket>();
  private readonly MAX_CLIENTS: number;
  private heartbeatTimer: NodeJS.Timeout | null = null;

  constructor(options: WsServerOptions = {}) {
    this.MAX_CLIENTS = options.maxConnections ?? 10_000;
    this.wss = new WebSocketServer({
      noServer: true,
      path: options.path,
      maxPayload: 512 * 1024, // 512 KB max message
    });

    this.wss.on('connection', (ws, req) => {
      if (this.clients.size >= this.MAX_CLIENTS) {
        ws.close(1013, 'Server at capacity');
        return;
      }

      ws.isAlive = true;
      this.clients.add(ws);

      ws.on('pong', () => { ws.isAlive = true; });
      ws.on('close', () => this.clients.delete(ws));
      ws.on('error', () => {
        this.clients.delete(ws);
        ws.terminate();
      });
    });

    if (options.heartbeatIntervalMs) {
      this.heartbeatTimer = setInterval(
        () => this._heartbeat(),
        options.heartbeatIntervalMs
      );
      this.heartbeatTimer.unref();
    }
  }

  private _heartbeat(): void {
    for (const ws of this.clients) {
      if (!ws.isAlive) {
        this.clients.delete(ws);
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }

  /** Attach to an existing HTTP server (upgrade handling) */
  attach(server: Server, handler: WsHandler): void {
    server.on('upgrade', (req, socket, head) => {
      if (this.wss.options.path && req.url !== this.wss.options.path) {
        socket.destroy();
        return;
      }
      this.wss.handleUpgrade(req, socket, head, (ws) => {
        this.wss.emit('connection', ws, req);
        handler(new StreetSocket(ws), req);
      });
    });
  }

  /** Broadcast a message to all connected clients */
  broadcast(type: string, payload: unknown): void {
    const msg = JSON.stringify({ type, payload, ts: Date.now() });
    for (const ws of this.clients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(msg);
      }
    }
  }

  close(): Promise<void> {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    for (const ws of this.clients) ws.terminate();
    this.clients.clear();
    return new Promise((resolve) => this.wss.close(() => resolve()));
  }

  get connectionCount(): number { return this.clients.size; }
}

// Extend WebSocket type with isAlive property
declare module 'ws' {
  interface WebSocket {
    isAlive: boolean;
  }
}

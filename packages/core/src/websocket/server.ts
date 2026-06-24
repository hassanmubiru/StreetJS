// src/websocket/server.ts
// WebSocket server with heartbeat, bounded listeners, and proper cleanup.

import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage, Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { URL } from 'node:url';

export type WsHandler = (socket: StreetSocket, req: IncomingMessage) => void;

/**
 * Raw connection handler used by {@link StreetWebSocketServer.attachProtocol}
 * for custom subprotocol integrations (e.g. graphql-ws). Unlike {@link WsHandler}
 * it receives the underlying {@link WebSocket} so the integration owns the full
 * message framing.
 */
export type RawWsHandler = (ws: WebSocket, req: IncomingMessage) => void;

export interface WsEvent {
  type: string;
  payload: unknown;
  ts: number;
}

export class StreetSocket {
  private readonly listeners = new Map<string, Set<(data: unknown) => void>>();
  private readonly MAX_LISTENERS = 64;
  private readonly closeHandlers = new Set<() => void>();
  private _closed = false;
  /** Stable, unique id for this connection (used by the channel hub). */
  readonly id: string = randomUUID();

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

    ws.on('close', () => this._onClose());
    ws.on('error', () => this._onClose());
  }

  private _onClose(): void {
    if (this._closed) return;
    this._closed = true;
    for (const cb of this.closeHandlers) {
      try { cb(); } catch { /* isolate handler errors */ }
    }
    this.closeHandlers.clear();
    this.listeners.clear();
  }

  /** Register a callback fired once when this connection closes (or errors). */
  onClose(handler: () => void): this {
    if (this._closed) {
      handler();
    } else {
      this.closeHandlers.add(handler);
    }
    return this;
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
  /**
   * Finding 11 fix: optional authentication hook called before the HTTP
   * upgrade is accepted. Return true to allow the connection, false or
   * throw to reject it with 401. Receives the raw IncomingMessage so
   * callers can inspect cookies, Authorization headers, query params, etc.
   *
   * Example:
   *   authFn: async (req) => {
   *     const token = new URL(req.url!, 'http://x').searchParams.get('token');
   *     return token !== null && jwt.verify(token) !== null;
   *   }
   */
  authFn?: (req: IncomingMessage) => boolean | Promise<boolean>;
  /**
   * F-R2: origins permitted to complete a WebSocket upgrade. When omitted,
   * the server defaults to same-origin (the request's Origin must match the
   * server's own scheme/host/port). Matching is exact on the normalized origin.
   */
  allowedOrigins?: string[];
}

/**
 * Normalize an origin string to `scheme://host[:port]` using `node:url`.
 * Returns `null` when the value cannot be parsed as a URL.
 *
 * Module-internal helper exported for property testing (Property 3); not part
 * of the public package surface.
 */
export function normalizeOrigin(value: string): string | null {
  try { return new URL(value).origin; } catch { return null; }
}

/**
 * Derive the server's own origin from the upgrade request: the scheme is taken
 * from whether the socket is TLS-encrypted, and the host from the `Host` header.
 * Returns `null` when no `Host` header is present or the derived URL is invalid.
 *
 * Module-internal helper exported for property testing (Property 3); not part
 * of the public package surface.
 */
export function deriveSelfOrigin(req: IncomingMessage): string | null {
  const host = req.headers.host;
  if (!host) return null;
  const scheme = (req.socket as { encrypted?: boolean }).encrypted ? 'https' : 'http';
  return normalizeOrigin(`${scheme}://${host}`);
}

/**
 * Decide whether an upgrade may proceed past the Origin gate (F-R2).
 * - No `Origin` header  => allowed (non-browser clients are not subject to CSWSH).
 * - Malformed `Origin`  => rejected.
 * - `allowedOrigins` set => the normalized Origin must be a member.
 * - `allowedOrigins` unset => the normalized Origin must equal the derived self-origin.
 *
 * Module-internal helper exported for property testing (Property 3); not part
 * of the public package surface.
 */
export function isOriginAllowed(req: IncomingMessage, allowedOrigins: string[] | undefined): boolean {
  const raw = req.headers.origin;
  if (raw === undefined) return true;                 // documented escape hatch
  const origin = normalizeOrigin(raw);
  if (origin === null) return false;                  // malformed Origin => reject
  if (allowedOrigins && allowedOrigins.length > 0) {
    const set = new Set(allowedOrigins.map(normalizeOrigin).filter((o): o is string => o !== null));
    return set.has(origin);
  }
  const self = deriveSelfOrigin(req);
  return self !== null && origin === self;
}

export class StreetWebSocketServer {
  private readonly wss: WebSocketServer;
  private readonly clients = new Set<WebSocket>();
  private readonly MAX_CLIENTS: number;
  private readonly authFn: ((req: IncomingMessage) => boolean | Promise<boolean>) | undefined;
  private readonly allowedOrigins: string[] | undefined;
  private heartbeatTimer: NodeJS.Timeout | null = null;

  constructor(options: WsServerOptions = {}) {
    this.MAX_CLIENTS = options.maxConnections ?? 10_000;
    this.authFn = options.authFn;
    this.allowedOrigins = options.allowedOrigins;
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
    server.on('upgrade', async (req, socket, head) => {
      if (this.wss.options.path && req.url !== this.wss.options.path) {
        socket.destroy();
        return;
      }

      // F-R2: reject disallowed origins before the auth hook / handshake so a
      // cross-origin upgrade never produces a `connection` event (Req 3.4/3.5).
      if (!isOriginAllowed(req, this.allowedOrigins)) {
        socket.write('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }

      // Finding 11 fix: run the auth hook before accepting the upgrade.
      // If authFn is provided and returns false (or throws), reject with 401.
      if (this.authFn) {
        try {
          const allowed = await this.authFn(req);
          if (!allowed) {
            socket.write('HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
            socket.destroy();
            return;
          }
        } catch {
          socket.write('HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
          socket.destroy();
          return;
        }
      }

      this.wss.handleUpgrade(req, socket, head, (ws) => {
        this.wss.emit('connection', ws, req);
        handler(new StreetSocket(ws), req);
      });
    });
  }

  /**
   * Attach a custom subprotocol handler to an existing HTTP server. Negotiates
   * the given WebSocket subprotocol (e.g. `graphql-transport-ws`) during the
   * upgrade and hands the raw {@link WebSocket} to `handler` so the caller owns
   * the message framing. Capacity, auth, path, and heartbeat tracking are
   * shared with the rest of the server.
   */
  attachProtocol(server: Server, subprotocol: string, handler: RawWsHandler): void {
    const protoWss = new WebSocketServer({
      noServer: true,
      maxPayload: 512 * 1024,
      handleProtocols: (protocols: Set<string>) => (protocols.has(subprotocol) ? subprotocol : false),
    });

    server.on('upgrade', async (req, socket, head) => {
      // Only handle the configured path; leave other upgrades to their handlers.
      if (this.wss.options.path && req.url !== this.wss.options.path) {
        return;
      }

      // F-R2: reject disallowed origins before the auth hook / handshake so a
      // cross-origin upgrade never produces a `connection` event (Req 3.4/3.5).
      if (!isOriginAllowed(req, this.allowedOrigins)) {
        socket.write('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }

      if (this.authFn) {
        try {
          const allowed = await this.authFn(req);
          if (!allowed) {
            socket.write('HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
            socket.destroy();
            return;
          }
        } catch {
          socket.write('HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
          socket.destroy();
          return;
        }
      }

      protoWss.handleUpgrade(req, socket, head, (ws) => {
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
        handler(ws, req);
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

  /**
   * The origins permitted to complete a WebSocket upgrade (F-R2), or `undefined`
   * when same-origin is the effective policy. Read-only view of the configured
   * `allowedOrigins` option; the upgrade-path gate (and tests) consume this.
   */
  get originPolicy(): readonly string[] | undefined { return this.allowedOrigins; }
}

// Extend WebSocket type with isAlive property
declare module 'ws' {
  interface WebSocket {
    isAlive: boolean;
  }
}

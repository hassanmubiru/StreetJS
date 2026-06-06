// src/websocket/server.ts
// WebSocket server with heartbeat, bounded listeners, and proper cleanup.
import { WebSocketServer, WebSocket } from 'ws';
export class StreetSocket {
    ws;
    listeners = new Map();
    MAX_LISTENERS = 64;
    _closed = false;
    constructor(ws) {
        this.ws = ws;
        ws.on('message', (raw) => {
            try {
                const msg = JSON.parse(raw.toString('utf8'));
                const handlers = this.listeners.get(msg.type);
                if (handlers) {
                    for (const h of handlers)
                        h(msg.payload);
                }
                // Also fire wildcard
                const wild = this.listeners.get('*');
                if (wild) {
                    for (const h of wild)
                        h(msg);
                }
            }
            catch {
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
    on(event, handler) {
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
    off(event, handler) {
        this.listeners.get(event)?.delete(handler);
        return this;
    }
    emit(type, payload) {
        if (this._closed || this.ws.readyState !== WebSocket.OPEN)
            return;
        const msg = { type, payload, ts: Date.now() };
        this.ws.send(JSON.stringify(msg));
    }
    close(code = 1000, reason = '') {
        if (!this._closed) {
            this.ws.close(code, reason);
        }
    }
    get closed() { return this._closed; }
    get readyState() { return this.ws.readyState; }
}
export class StreetWebSocketServer {
    wss;
    clients = new Set();
    MAX_CLIENTS;
    authFn;
    heartbeatTimer = null;
    constructor(options = {}) {
        this.MAX_CLIENTS = options.maxConnections ?? 10_000;
        this.authFn = options.authFn;
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
            this.heartbeatTimer = setInterval(() => this._heartbeat(), options.heartbeatIntervalMs);
            this.heartbeatTimer.unref();
        }
    }
    _heartbeat() {
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
    attach(server, handler) {
        server.on('upgrade', async (req, socket, head) => {
            if (this.wss.options.path && req.url !== this.wss.options.path) {
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
                }
                catch {
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
    attachProtocol(server, subprotocol, handler) {
        const protoWss = new WebSocketServer({
            noServer: true,
            maxPayload: 512 * 1024,
            handleProtocols: (protocols) => (protocols.has(subprotocol) ? subprotocol : false),
        });
        server.on('upgrade', async (req, socket, head) => {
            // Only handle the configured path; leave other upgrades to their handlers.
            if (this.wss.options.path && req.url !== this.wss.options.path) {
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
                }
                catch {
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
    broadcast(type, payload) {
        const msg = JSON.stringify({ type, payload, ts: Date.now() });
        for (const ws of this.clients) {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(msg);
            }
        }
    }
    close() {
        if (this.heartbeatTimer)
            clearInterval(this.heartbeatTimer);
        for (const ws of this.clients)
            ws.terminate();
        this.clients.clear();
        return new Promise((resolve) => this.wss.close(() => resolve()));
    }
    get connectionCount() { return this.clients.size; }
}
//# sourceMappingURL=server.js.map
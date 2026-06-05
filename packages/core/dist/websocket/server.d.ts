import { WebSocket } from 'ws';
import type { IncomingMessage, Server } from 'node:http';
export type WsHandler = (socket: StreetSocket, req: IncomingMessage) => void;
export interface WsEvent {
    type: string;
    payload: unknown;
    ts: number;
}
export declare class StreetSocket {
    private readonly ws;
    private readonly listeners;
    private readonly MAX_LISTENERS;
    private _closed;
    constructor(ws: WebSocket);
    on(event: string, handler: (data: unknown) => void): this;
    off(event: string, handler: (data: unknown) => void): this;
    emit(type: string, payload: unknown): void;
    close(code?: number, reason?: string): void;
    get closed(): boolean;
    get readyState(): number;
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
}
export declare class StreetWebSocketServer {
    private readonly wss;
    private readonly clients;
    private readonly MAX_CLIENTS;
    private readonly authFn;
    private heartbeatTimer;
    constructor(options?: WsServerOptions);
    private _heartbeat;
    /** Attach to an existing HTTP server (upgrade handling) */
    attach(server: Server, handler: WsHandler): void;
    /** Broadcast a message to all connected clients */
    broadcast(type: string, payload: unknown): void;
    close(): Promise<void>;
    get connectionCount(): number;
}
declare module 'ws' {
    interface WebSocket {
        isAlive: boolean;
    }
}
//# sourceMappingURL=server.d.ts.map
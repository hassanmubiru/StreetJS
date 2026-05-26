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
}
export declare class StreetWebSocketServer {
    private readonly wss;
    private readonly clients;
    private readonly MAX_CLIENTS;
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
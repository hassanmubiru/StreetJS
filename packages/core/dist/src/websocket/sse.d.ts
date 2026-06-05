import type { ServerResponse } from 'node:http';
export interface SseEvent {
    event?: string;
    data: unknown;
    id?: string;
    retry?: number;
}
export declare class SseConnection {
    private readonly res;
    private heartbeatTimer;
    private _closed;
    private eventId;
    constructor(res: ServerResponse, heartbeatIntervalMs?: number);
    /** Send an SSE event */
    send(event: SseEvent): boolean;
    /** Send raw comment (keep-alive) */
    comment(text: string): boolean;
    private _write;
    private _cleanup;
    close(): void;
    get closed(): boolean;
}
/** Factory: create an SSE connection from a StreetContext response */
export declare function createSse(res: ServerResponse, heartbeatIntervalMs?: number): SseConnection;
//# sourceMappingURL=sse.d.ts.map
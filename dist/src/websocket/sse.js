// src/websocket/sse.ts
// Server-Sent Events wrapper with heartbeat and cleanup.
export class SseConnection {
    res;
    heartbeatTimer = null;
    _closed = false;
    eventId = 0;
    constructor(res, heartbeatIntervalMs = 30_000) {
        this.res = res;
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no', // Nginx: disable proxy buffering
        });
        // Keep connection alive
        this.heartbeatTimer = setInterval(() => {
            if (!this._closed)
                this._write(':ping\n\n');
        }, heartbeatIntervalMs);
        this.heartbeatTimer.unref();
        res.once('close', () => this._cleanup());
        res.once('error', () => this._cleanup());
        res.socket?.once('end', () => this._cleanup());
    }
    /** Send an SSE event */
    send(event) {
        if (this._closed)
            return false;
        this.eventId++;
        let frame = '';
        if (event.id !== undefined)
            frame += `id: ${event.id}\n`;
        else
            frame += `id: ${this.eventId}\n`;
        if (event.event)
            frame += `event: ${event.event}\n`;
        if (event.retry !== undefined)
            frame += `retry: ${event.retry}\n`;
        // undefined → empty string, null/falsy → JSON.stringify handles it
        const data = typeof event.data === 'string'
            ? event.data
            : event.data === undefined
                ? ''
                : JSON.stringify(event.data);
        // Split multi-line data correctly
        for (const line of data.split('\n')) {
            frame += `data: ${line}\n`;
        }
        frame += '\n';
        return this._write(frame);
    }
    /** Send raw comment (keep-alive) */
    comment(text) {
        return this._write(`: ${text}\n\n`);
    }
    _write(text) {
        if (this._closed || this.res.writableEnded)
            return false;
        try {
            return this.res.write(text);
        }
        catch {
            this._cleanup();
            return false;
        }
    }
    _cleanup() {
        if (this._closed)
            return;
        this._closed = true;
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
        if (!this.res.writableEnded) {
            this.res.end();
        }
    }
    close() {
        this._cleanup();
    }
    get closed() { return this._closed; }
}
/** Factory: create an SSE connection from a StreetContext response */
export function createSse(res, heartbeatIntervalMs) {
    return new SseConnection(res, heartbeatIntervalMs);
}
//# sourceMappingURL=sse.js.map
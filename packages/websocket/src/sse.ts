// src/websocket/sse.ts
// Server-Sent Events wrapper with heartbeat and cleanup.

import type { ServerResponse } from 'node:http';

export interface SseEvent {
  event?: string;
  data: unknown;
  id?: string;
  retry?: number;
}

export class SseConnection {
  private readonly res: ServerResponse;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private _closed = false;
  private eventId = 0;

  constructor(res: ServerResponse, heartbeatIntervalMs = 30_000) {
    this.res = res;

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // Nginx: disable proxy buffering
    });

    // Keep connection alive
    this.heartbeatTimer = setInterval(() => {
      if (!this._closed) this._write(':ping\n\n');
    }, heartbeatIntervalMs);
    this.heartbeatTimer.unref();

    res.once('close', () => this._cleanup());
    res.once('error', () => this._cleanup());
    res.socket?.once('end', () => this._cleanup());
  }

  /** Send an SSE event */
  send(event: SseEvent): boolean {
    if (this._closed) return false;

    this.eventId++;
    let frame = '';

    // Finding 12 fix: strip CR/LF from all SSE field values to prevent
    // frame injection. An attacker who controls event.event or event.id
    // could otherwise inject arbitrary SSE frames.
    const sanitizeSseField = (v: string): string => v.replace(/[\r\n]/g, '');

    if (event.id !== undefined) frame += `id: ${sanitizeSseField(String(event.id))}\n`;
    else frame += `id: ${this.eventId}\n`;

    if (event.event) frame += `event: ${sanitizeSseField(event.event)}\n`;
    if (event.retry !== undefined) frame += `retry: ${Math.floor(Math.abs(event.retry))}\n`;

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
  comment(text: string): boolean {
    return this._write(`: ${text}\n\n`);
  }

  private _write(text: string): boolean {
    if (this._closed || this.res.writableEnded) return false;
    try {
      return this.res.write(text);
    } catch {
      this._cleanup();
      return false;
    }
  }

  private _cleanup(): void {
    if (this._closed) return;
    this._closed = true;
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (!this.res.writableEnded) {
      this.res.end();
    }
  }

  close(): void {
    this._cleanup();
  }

  get closed(): boolean { return this._closed; }
}

/** Factory: create an SSE connection from a StreetContext response */
export function createSse(
  res: ServerResponse,
  heartbeatIntervalMs?: number
): SseConnection {
  return new SseConnection(res, heartbeatIntervalMs);
}

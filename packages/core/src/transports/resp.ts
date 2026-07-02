// src/transports/resp.ts
// Minimal RESP (REdis Serialization Protocol) codec + client over node:net.
// Zero dependencies. Supports the command subset used by the event bus and
// distributed cache transports: GET, SET (EX), DEL, SUBSCRIBE, PUBLISH.

import { createConnection, type Socket } from 'node:net';

/** Encode a command as a RESP2 array of bulk strings. */
export function encodeCommand(args: (string | number)[]): Buffer {
  const parts: Buffer[] = [Buffer.from(`*${args.length}\r\n`, 'utf8')];
  for (const arg of args) {
    const s = String(arg);
    parts.push(Buffer.from(`$${Buffer.byteLength(s)}\r\n${s}\r\n`, 'utf8'));
  }
  return Buffer.concat(parts);
}

export type RespValue = string | number | null | RespValue[];

/**
 * Incremental RESP2 reply parser. Feed bytes via `push()`; call `parse()` to
 * pull complete replies. Returns `undefined` when more data is needed.
 */
export class RespParser {
  private buf: Buffer = Buffer.alloc(0);

  push(chunk: Buffer): void {
    this.buf = this.buf.length === 0 ? chunk : Buffer.concat([this.buf, chunk]);
  }

  parse(): RespValue | undefined {
    const result = this._parseAt(0);
    if (result === undefined) return undefined;
    this.buf = this.buf.subarray(result.next);
    return result.value;
  }

  private _lineEnd(start: number): number {
    const idx = this.buf.indexOf('\r\n', start, 'utf8');
    return idx;
  }

  private _parseAt(pos: number): { value: RespValue; next: number } | undefined {
    if (pos >= this.buf.length) return undefined;
    const type = String.fromCharCode(this.buf[pos]!);
    const lineEnd = this._lineEnd(pos + 1);
    if (lineEnd === -1) return undefined;
    const line = this.buf.toString('utf8', pos + 1, lineEnd);
    const after = lineEnd + 2;

    switch (type) {
      case '+': return { value: line, next: after };
      case '-': return { value: `ERR:${line}`, next: after };
      case ':': return { value: Number(line), next: after };
      case '$': {
        const len = Number(line);
        if (len === -1) return { value: null, next: after };
        if (after + len + 2 > this.buf.length) return undefined;
        return { value: this.buf.toString('utf8', after, after + len), next: after + len + 2 };
      }
      case '*': {
        const count = Number(line);
        if (count === -1) return { value: null, next: after };
        const arr: RespValue[] = [];
        let cursor = after;
        for (let i = 0; i < count; i++) {
          const el = this._parseAt(cursor);
          if (el === undefined) return undefined;
          arr.push(el.value);
          cursor = el.next;
        }
        return { value: arr, next: cursor };
      }
      default:
        return { value: line, next: after };
    }
  }
}

/**
 * Classify a reply received on a subscription connection. In RESP2 subscribe
 * mode a connection receives two kinds of arrays: pushed messages
 * (`["message", channel, payload]` / `["pmessage", pattern, channel, payload]`)
 * that must be delivered to the subscriber, and command confirmations
 * (`["subscribe", channel, count]`, `["unsubscribe", ...]`, an AUTH `+OK`, a
 * `PONG`, …) that must resolve the corresponding pending command promise.
 *
 * Exported for direct unit testing of the pub/sub routing without a live broker.
 */
export function classifyPubSubReply(
  reply: RespValue,
): { kind: 'message'; payload: string } | { kind: 'command' } {
  if (Array.isArray(reply) && (reply[0] === 'message' || reply[0] === 'pmessage')) {
    // `message` → payload at index 2; `pmessage` → payload at index 3.
    const payload = reply[0] === 'pmessage' ? reply[3] : reply[2];
    if (typeof payload === 'string') {
      return { kind: 'message', payload };
    }
  }
  return { kind: 'command' };
}

// ── RedisClient ───────────────────────────────────────────────────────────────

export interface RedisClientOptions {
  host?: string;
  port?: number;
  password?: string;
}

/**
 * A minimal Redis client. A single connection multiplexes command replies in
 * FIFO order; a separate connection is used per subscription (Redis requires a
 * dedicated connection in subscribe mode).
 */
export class RedisClient {
  private readonly host: string;
  private readonly port: number;
  private readonly password: string | undefined;
  private socket: Socket | null = null;
  private readonly parser = new RespParser();
  private readonly pending: Array<(v: RespValue) => void> = [];
  private connected = false;

  constructor(opts: RedisClientOptions = {}) {
    this.host = opts.host ?? '127.0.0.1';
    this.port = opts.port ?? 6379;
    this.password = opts.password;
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    await new Promise<void>((resolve, reject) => {
      const sock = createConnection({ host: this.host, port: this.port }, () => resolve());
      sock.on('error', reject);
      sock.on('data', (chunk: Buffer) => {
        this.parser.push(chunk);
        let reply = this.parser.parse();
        while (reply !== undefined) {
          const cb = this.pending.shift();
          if (cb) cb(reply);
          reply = this.parser.parse();
        }
      });
      this.socket = sock;
    });
    this.connected = true;
    if (this.password) await this.command(['AUTH', this.password]);
  }

  command(args: (string | number)[]): Promise<RespValue> {
    if (!this.socket) throw new Error('RedisClient not connected');
    return new Promise<RespValue>((resolve) => {
      this.pending.push(resolve);
      this.socket!.write(encodeCommand(args));
    });
  }

  async get(key: string): Promise<string | null> {
    const r = await this.command(['GET', key]);
    return typeof r === 'string' ? r : null;
  }

  async set(key: string, value: string, ttlMs?: number): Promise<void> {
    if (ttlMs && ttlMs > 0) await this.command(['SET', key, value, 'PX', Math.floor(ttlMs)]);
    else await this.command(['SET', key, value]);
  }

  async del(key: string): Promise<void> {
    await this.command(['DEL', key]);
  }

  async publish(channel: string, message: string): Promise<void> {
    await this.command(['PUBLISH', channel, message]);
  }

  /** Open a dedicated subscription connection and invoke handler per message. */
  async subscribe(channel: string, handler: (message: string) => void): Promise<() => void> {
    const sub = new RedisClient({ host: this.host, port: this.port, password: this.password });
    const parser = new RespParser();
    await new Promise<void>((resolve, reject) => {
      const sock = createConnection({ host: this.host, port: this.port }, () => resolve());
      sock.on('error', reject);
      sock.on('data', (chunk: Buffer) => {
        parser.push(chunk);
        let reply = parser.parse();
        while (reply !== undefined) {
          if (Array.isArray(reply) && reply[0] === 'message' && typeof reply[2] === 'string') {
            handler(reply[2]);
          }
          reply = parser.parse();
        }
      });
      (sub as unknown as { socket: Socket }).socket = sock;
      sub.connected = true;
    });
    await sub.command(['SUBSCRIBE', channel]);
    return () => sub.close();
  }

  close(): void {
    this.socket?.destroy();
    this.socket = null;
    this.connected = false;
  }
}

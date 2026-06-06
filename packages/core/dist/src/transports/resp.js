// src/transports/resp.ts
// Minimal RESP (REdis Serialization Protocol) codec + client over node:net.
// Zero dependencies. Supports the command subset used by the event bus and
// distributed cache transports: GET, SET (EX), DEL, SUBSCRIBE, PUBLISH.
import { createConnection } from 'node:net';
/** Encode a command as a RESP2 array of bulk strings. */
export function encodeCommand(args) {
    const parts = [Buffer.from(`*${args.length}\r\n`, 'utf8')];
    for (const arg of args) {
        const s = String(arg);
        parts.push(Buffer.from(`$${Buffer.byteLength(s)}\r\n${s}\r\n`, 'utf8'));
    }
    return Buffer.concat(parts);
}
/**
 * Incremental RESP2 reply parser. Feed bytes via `push()`; call `parse()` to
 * pull complete replies. Returns `undefined` when more data is needed.
 */
export class RespParser {
    buf = Buffer.alloc(0);
    push(chunk) {
        this.buf = this.buf.length === 0 ? chunk : Buffer.concat([this.buf, chunk]);
    }
    parse() {
        const result = this._parseAt(0);
        if (result === undefined)
            return undefined;
        this.buf = this.buf.subarray(result.next);
        return result.value;
    }
    _lineEnd(start) {
        const idx = this.buf.indexOf('\r\n', start, 'utf8');
        return idx;
    }
    _parseAt(pos) {
        if (pos >= this.buf.length)
            return undefined;
        const type = String.fromCharCode(this.buf[pos]);
        const lineEnd = this._lineEnd(pos + 1);
        if (lineEnd === -1)
            return undefined;
        const line = this.buf.toString('utf8', pos + 1, lineEnd);
        const after = lineEnd + 2;
        switch (type) {
            case '+': return { value: line, next: after };
            case '-': return { value: `ERR:${line}`, next: after };
            case ':': return { value: Number(line), next: after };
            case '$': {
                const len = Number(line);
                if (len === -1)
                    return { value: null, next: after };
                if (after + len + 2 > this.buf.length)
                    return undefined;
                return { value: this.buf.toString('utf8', after, after + len), next: after + len + 2 };
            }
            case '*': {
                const count = Number(line);
                if (count === -1)
                    return { value: null, next: after };
                const arr = [];
                let cursor = after;
                for (let i = 0; i < count; i++) {
                    const el = this._parseAt(cursor);
                    if (el === undefined)
                        return undefined;
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
 * A minimal Redis client. A single connection multiplexes command replies in
 * FIFO order; a separate connection is used per subscription (Redis requires a
 * dedicated connection in subscribe mode).
 */
export class RedisClient {
    host;
    port;
    password;
    socket = null;
    parser = new RespParser();
    pending = [];
    connected = false;
    constructor(opts = {}) {
        this.host = opts.host ?? '127.0.0.1';
        this.port = opts.port ?? 6379;
        this.password = opts.password;
    }
    async connect() {
        if (this.connected)
            return;
        await new Promise((resolve, reject) => {
            const sock = createConnection({ host: this.host, port: this.port }, () => resolve());
            sock.on('error', reject);
            sock.on('data', (chunk) => {
                this.parser.push(chunk);
                let reply = this.parser.parse();
                while (reply !== undefined) {
                    const cb = this.pending.shift();
                    if (cb)
                        cb(reply);
                    reply = this.parser.parse();
                }
            });
            this.socket = sock;
        });
        this.connected = true;
        if (this.password)
            await this.command(['AUTH', this.password]);
    }
    command(args) {
        if (!this.socket)
            throw new Error('RedisClient not connected');
        return new Promise((resolve) => {
            this.pending.push(resolve);
            this.socket.write(encodeCommand(args));
        });
    }
    async get(key) {
        const r = await this.command(['GET', key]);
        return typeof r === 'string' ? r : null;
    }
    async set(key, value, ttlMs) {
        if (ttlMs && ttlMs > 0)
            await this.command(['SET', key, value, 'PX', Math.floor(ttlMs)]);
        else
            await this.command(['SET', key, value]);
    }
    async del(key) {
        await this.command(['DEL', key]);
    }
    async publish(channel, message) {
        await this.command(['PUBLISH', channel, message]);
    }
    /** Open a dedicated subscription connection and invoke handler per message. */
    async subscribe(channel, handler) {
        const sub = new RedisClient({ host: this.host, port: this.port, password: this.password });
        const parser = new RespParser();
        await new Promise((resolve, reject) => {
            const sock = createConnection({ host: this.host, port: this.port }, () => resolve());
            sock.on('error', reject);
            sock.on('data', (chunk) => {
                parser.push(chunk);
                let reply = parser.parse();
                while (reply !== undefined) {
                    if (Array.isArray(reply) && reply[0] === 'message' && typeof reply[2] === 'string') {
                        handler(reply[2]);
                    }
                    reply = parser.parse();
                }
            });
            sub.socket = sock;
            sub.connected = true;
        });
        await sub.command(['SUBSCRIBE', channel]);
        return () => sub.close();
    }
    close() {
        this.socket?.destroy();
        this.socket = null;
        this.connected = false;
    }
}
//# sourceMappingURL=resp.js.map
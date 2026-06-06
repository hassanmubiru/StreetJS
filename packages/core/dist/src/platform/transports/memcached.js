// src/platform/transports/memcached.ts
// Memcached text-protocol CacheTransport over node:net. Zero dependencies.
// Memcached has no pub/sub, so invalidation channels are emulated in-process;
// `set`/`delete`/`get` use the real Memcached text protocol.
import { createConnection } from 'node:net';
export class MemcachedTransport {
    host;
    port;
    socket = null;
    buffer = '';
    waiters = [];
    subs = new Map();
    constructor(opts = {}) {
        this.host = opts.host ?? '127.0.0.1';
        this.port = opts.port ?? 11211;
    }
    async _ensure() {
        if (this.socket)
            return;
        await new Promise((resolve, reject) => {
            const sock = createConnection({ host: this.host, port: this.port }, () => resolve());
            sock.on('error', reject);
            sock.on('data', (chunk) => {
                this.buffer += chunk.toString('utf8');
                let idx = this.buffer.indexOf('\r\n');
                while (idx !== -1) {
                    // Deliver the full response up to and including END/STORED/etc lines.
                    const line = this.buffer.slice(0, idx);
                    this.buffer = this.buffer.slice(idx + 2);
                    const w = this.waiters.shift();
                    if (w)
                        w(line);
                    idx = this.buffer.indexOf('\r\n');
                }
            });
            this.socket = sock;
        });
    }
    _command(cmd) {
        return new Promise((resolve) => {
            this.waiters.push(resolve);
            this.socket.write(cmd);
        });
    }
    async get(key) {
        await this._ensure();
        // Response: VALUE <key> <flags> <bytes>\r\n<data>\r\nEND  — read value line then data line.
        return new Promise((resolve) => {
            let header = '';
            this.waiters.push((line) => {
                header = line;
                if (header.startsWith('END')) {
                    resolve(null);
                    return;
                }
                // next line is the data payload
                this.waiters.unshift((data) => {
                    // consume trailing END
                    this.waiters.unshift(() => undefined);
                    resolve(data);
                });
            });
            this.socket.write(`get ${key}\r\n`);
        });
    }
    async set(key, value, ttlMs) {
        await this._ensure();
        const exp = ttlMs && ttlMs > 0 ? Math.ceil(ttlMs / 1000) : 0;
        const bytes = Buffer.byteLength(value);
        await this._command(`set ${key} 0 ${exp} ${bytes}\r\n${value}\r\n`);
    }
    async delete(key) {
        await this._ensure();
        await this._command(`delete ${key}\r\n`);
    }
    subscribe(channel, handler) {
        if (!this.subs.has(channel))
            this.subs.set(channel, new Set());
        this.subs.get(channel).add(handler);
        return () => { this.subs.get(channel)?.delete(handler); };
    }
    async publish(channel, message) {
        const handlers = this.subs.get(channel);
        if (handlers)
            for (const h of handlers)
                setImmediate(() => h(message));
    }
    close() {
        this.socket?.destroy();
        this.socket = null;
    }
}
//# sourceMappingURL=memcached.js.map
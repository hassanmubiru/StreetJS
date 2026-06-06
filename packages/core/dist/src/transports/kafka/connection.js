// src/transports/kafka/connection.ts
// Kafka broker connection: size-prefixed request/response framing with
// correlation-id matching over node:net. Implements the (non-flexible) API
// versions this client needs.
import { createConnection } from 'node:net';
import { KafkaWriter, KafkaReader } from './primitives.js';
// API keys
export const API = {
    PRODUCE: 0, FETCH: 1, LIST_OFFSETS: 2, METADATA: 3,
    OFFSET_COMMIT: 8, OFFSET_FETCH: 9, FIND_COORDINATOR: 10, API_VERSIONS: 18,
};
export class KafkaConnection {
    socket = null;
    opts;
    corr = 0;
    buf = Buffer.alloc(0);
    pending = new Map();
    constructor(opts = {}) {
        this.opts = {
            host: opts.host ?? '127.0.0.1',
            port: opts.port ?? 9092,
            clientId: opts.clientId ?? 'street-kafka',
            connectTimeoutMs: opts.connectTimeoutMs ?? 10_000,
        };
    }
    async connect() {
        await new Promise((resolve, reject) => {
            const sock = createConnection({ host: this.opts.host, port: this.opts.port }, () => resolve());
            const to = setTimeout(() => { sock.destroy(); reject(new Error('Kafka connect timeout')); }, this.opts.connectTimeoutMs);
            to.unref();
            sock.on('connect', () => clearTimeout(to));
            sock.on('error', reject);
            sock.on('data', (chunk) => this._onData(chunk));
            this.socket = sock;
        });
    }
    _onData(chunk) {
        this.buf = this.buf.length === 0 ? chunk : Buffer.concat([this.buf, chunk]);
        for (;;) {
            if (this.buf.length < 4)
                return;
            const size = this.buf.readInt32BE(0);
            if (this.buf.length < 4 + size)
                return;
            const frame = this.buf.subarray(4, 4 + size);
            this.buf = this.buf.subarray(4 + size);
            const correlationId = frame.readInt32BE(0);
            const body = frame.subarray(4);
            const cb = this.pending.get(correlationId);
            if (cb) {
                this.pending.delete(correlationId);
                cb(body);
            }
        }
    }
    /**
     * Send a request and resolve with the response body (after the correlation
     * id). `buildBody(w)` writes the request-specific fields.
     */
    request(apiKey, apiVersion, buildBody) {
        if (!this.socket || this.socket.destroyed)
            throw new Error('Kafka socket not connected');
        const correlationId = this.corr++;
        const header = new KafkaWriter()
            .int16(apiKey)
            .int16(apiVersion)
            .int32(correlationId)
            .string(this.opts.clientId);
        buildBody(header);
        const body = header.build();
        const framed = new KafkaWriter().int32(body.length).raw(body).build();
        return new Promise((resolve) => {
            this.pending.set(correlationId, (respBody) => resolve(new KafkaReader(respBody)));
            this.socket.write(framed);
        });
    }
    close() {
        this.socket?.destroy();
        this.socket = null;
    }
    get connected() { return this.socket !== null && !this.socket.destroyed; }
}
//# sourceMappingURL=connection.js.map
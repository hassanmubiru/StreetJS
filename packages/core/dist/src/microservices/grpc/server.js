// src/microservices/grpc/server.ts
// gRPC server over node:http2 (h2c). Supports unary, server-streaming,
// client-streaming, and bidirectional-streaming RPCs with a pluggable codec
// (default JSON), grpc-timeout deadlines (AbortSignal), and a max message size.
import { createServer, constants } from 'node:http2';
import { encodeFrame, decodeFrames, GrpcError, GRPC_MAX_MESSAGE_BYTES, jsonCodec, parseGrpcTimeout, } from './framing.js';
export class GrpcServer {
    host;
    port;
    maxBytes;
    codec;
    methods = new Map();
    server = null;
    constructor(opts = {}) {
        this.host = opts.host ?? '0.0.0.0';
        this.port = opts.port ?? 50051;
        this.maxBytes = opts.maxMessageBytes ?? GRPC_MAX_MESSAGE_BYTES;
        this.codec = opts.codec ?? jsonCodec;
    }
    /** Register a service implementation. Path is `/package.Service/Method`. */
    registerService(serviceName, methods) {
        for (const [methodName, reg] of Object.entries(methods)) {
            this.methods.set(`/${serviceName}/${methodName}`, reg);
        }
    }
    async start() {
        this.server = createServer();
        this.server.on('stream', (stream, headers) => {
            void this._handleStream(stream, headers);
        });
        await new Promise((resolve) => this.server.listen(this.port, this.host, resolve));
    }
    async stop() {
        if (!this.server)
            return;
        await new Promise((resolve) => this.server.close(() => resolve()));
        this.server = null;
    }
    async _handleStream(stream, headers) {
        const path = headers[constants.HTTP2_HEADER_PATH] ?? '';
        const reg = this.methods.get(path);
        // Deferred trailer state: respond once with waitForTrailers, then send the
        // grpc-status trailer when the DATA stream ends.
        let finalCode = 0;
        let finalMessage;
        let responded = false;
        const begin = () => {
            if (responded)
                return;
            responded = true;
            stream.respond({ [constants.HTTP2_HEADER_STATUS]: 200, 'content-type': 'application/grpc+json' }, { waitForTrailers: true });
            stream.once('wantTrailers', () => {
                try {
                    stream.sendTrailers({ 'grpc-status': String(finalCode), ...(finalMessage ? { 'grpc-message': finalMessage } : {}) });
                }
                catch { /* already closed */ }
            });
        };
        const finish = (code, message) => {
            finalCode = code;
            finalMessage = message;
            begin();
            stream.end();
        };
        if (!reg) {
            finish(5, `method not found: ${path}`); // NOT_FOUND
            return;
        }
        const controller = new AbortController();
        const timeoutMs = parseGrpcTimeout(headers['grpc-timeout']);
        let timer = null;
        if (timeoutMs !== null) {
            timer = setTimeout(() => controller.abort(), timeoutMs);
            timer.unref();
        }
        stream.on('close', () => { if (!controller.signal.aborted)
            controller.abort(); });
        const ctx = { signal: controller.signal, metadata: headers };
        const incoming = this._readFrames(stream);
        const writeMsg = (msg) => {
            begin();
            stream.write(encodeFrame(this.codec.encode(msg)));
        };
        try {
            if (reg.type === 'unary' || reg.type === 'server-stream') {
                const first = await firstOf(incoming);
                const request = first === undefined ? null : this.codec.decode(first);
                if (reg.type === 'unary') {
                    const response = await reg.handler(request, ctx);
                    writeMsg(response);
                }
                else {
                    await reg.handler(request, writeMsg, ctx);
                }
            }
            else {
                const requests = mapAsync(incoming, (b) => this.codec.decode(b));
                if (reg.type === 'client-stream') {
                    const response = await reg.handler(requests, ctx);
                    writeMsg(response);
                }
                else {
                    await reg.handler(requests, writeMsg, ctx);
                }
            }
            if (timer)
                clearTimeout(timer);
            finish(controller.signal.aborted ? 4 : 0, controller.signal.aborted ? 'deadline exceeded' : undefined);
        }
        catch (err) {
            if (timer)
                clearTimeout(timer);
            const code = err instanceof GrpcError ? err.code : 13; // INTERNAL
            finish(code, err instanceof Error ? err.message : String(err));
        }
    }
    _readFrames(stream) {
        const queue = [];
        let leftover = Buffer.alloc(0);
        let ended = false;
        let errored = null;
        let notify = null;
        const wake = () => { if (notify) {
            const n = notify;
            notify = null;
            n();
        } };
        const maxBytes = this.maxBytes;
        stream.on('data', (chunk) => {
            leftover = Buffer.concat([leftover, chunk]);
            try {
                const { frames, rest } = decodeFrames(leftover, maxBytes);
                leftover = rest;
                for (const f of frames)
                    queue.push(f);
            }
            catch (e) {
                errored = e instanceof Error ? e : new Error(String(e));
            }
            wake();
        });
        stream.on('end', () => { ended = true; wake(); });
        stream.on('error', (e) => { errored = e; ended = true; wake(); });
        // Event-listener based reader: stopping iteration early does NOT destroy
        // the stream (unlike `for await (const c of stream)`), so the writable side
        // stays open for the response.
        async function* gen() {
            for (;;) {
                if (errored)
                    throw errored;
                const next = queue.shift();
                if (next !== undefined) {
                    yield next;
                    continue;
                }
                if (ended)
                    return;
                await new Promise((resolve) => { notify = resolve; });
            }
        }
        return gen();
    }
}
async function firstOf(it) {
    for await (const v of it)
        return v;
    return undefined;
}
async function* mapAsync(it, fn) {
    for await (const v of it)
        yield fn(v);
}
//# sourceMappingURL=server.js.map
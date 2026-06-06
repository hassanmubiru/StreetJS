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
    _respondTrailers(stream, code, message) {
        if (!stream.headersSent) {
            stream.respond({ [constants.HTTP2_HEADER_STATUS]: 200, 'content-type': 'application/grpc+json' });
        }
        stream.close(); // end DATA
        try {
            stream.sendTrailers({ 'grpc-status': String(code), ...(message ? { 'grpc-message': message } : {}) });
        }
        catch { /* stream may already be closed */ }
    }
    async _handleStream(stream, headers) {
        const path = headers[constants.HTTP2_HEADER_PATH] ?? '';
        const reg = this.methods.get(path);
        if (!reg) {
            this._respondTrailers(stream, 5, `method not found: ${path}`); // NOT_FOUND
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
            stream.write(encodeFrame(this.codec.encode(msg)));
        };
        try {
            if (reg.type === 'unary' || reg.type === 'server-stream') {
                const first = await firstOf(incoming);
                const request = first === undefined ? null : this.codec.decode(first);
                if (reg.type === 'unary') {
                    const response = await reg.handler(request, ctx);
                    stream.respond({ [constants.HTTP2_HEADER_STATUS]: 200, 'content-type': 'application/grpc+json' });
                    writeMsg(response);
                }
                else {
                    stream.respond({ [constants.HTTP2_HEADER_STATUS]: 200, 'content-type': 'application/grpc+json' });
                    await reg.handler(request, writeMsg, ctx);
                }
            }
            else {
                const requests = mapAsync(incoming, (b) => this.codec.decode(b));
                stream.respond({ [constants.HTTP2_HEADER_STATUS]: 200, 'content-type': 'application/grpc+json' });
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
            this._respondTrailers(stream, controller.signal.aborted ? 4 : 0, controller.signal.aborted ? 'deadline exceeded' : undefined);
        }
        catch (err) {
            if (timer)
                clearTimeout(timer);
            const code = err instanceof GrpcError ? err.code : 13; // INTERNAL
            this._respondTrailers(stream, code, err instanceof Error ? err.message : String(err));
        }
    }
    async *_readFrames(stream) {
        let buffer = Buffer.alloc(0);
        for await (const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk]);
            const { frames, rest } = decodeFrames(buffer, this.maxBytes);
            buffer = rest;
            for (const f of frames)
                yield f;
        }
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
// src/microservices/grpc/server.ts
// gRPC server over node:http2 (h2c). Supports unary, server-streaming,
// client-streaming, and bidirectional-streaming RPCs with a pluggable codec
// (default JSON), grpc-timeout deadlines (AbortSignal), and a max message size.

import { createServer, type Http2Server, type ServerHttp2Stream, constants } from 'node:http2';
import {
  encodeFrame, decodeFrames, GrpcError, GRPC_MAX_MESSAGE_BYTES, jsonCodec, parseGrpcTimeout,
} from './framing.js';

export interface GrpcCallContext {
  signal: AbortSignal;
  metadata: Record<string, string>;
}

export type UnaryHandler = (request: unknown, ctx: GrpcCallContext) => Promise<unknown>;
export type ServerStreamHandler = (request: unknown, push: (msg: unknown) => void, ctx: GrpcCallContext) => Promise<void>;
export type ClientStreamHandler = (requests: AsyncIterable<unknown>, ctx: GrpcCallContext) => Promise<unknown>;
export type BidiStreamHandler = (requests: AsyncIterable<unknown>, push: (msg: unknown) => void, ctx: GrpcCallContext) => Promise<void>;

export interface MethodRegistration {
  type: 'unary' | 'server-stream' | 'client-stream' | 'bidi';
  handler: UnaryHandler | ServerStreamHandler | ClientStreamHandler | BidiStreamHandler;
}

export interface GrpcServerOptions {
  host?: string;
  port?: number;
  maxMessageBytes?: number;
  codec?: { encode(v: unknown): Buffer; decode<T>(b: Buffer): T };
}

export class GrpcServer {
  private readonly host: string;
  private readonly port: number;
  private readonly maxBytes: number;
  private readonly codec: { encode(v: unknown): Buffer; decode<T>(b: Buffer): T };
  private readonly methods = new Map<string, MethodRegistration>();
  private server: Http2Server | null = null;

  constructor(opts: GrpcServerOptions = {}) {
    this.host = opts.host ?? '0.0.0.0';
    this.port = opts.port ?? 50051;
    this.maxBytes = opts.maxMessageBytes ?? GRPC_MAX_MESSAGE_BYTES;
    this.codec = opts.codec ?? (jsonCodec as never);
  }

  /** Register a service implementation. Path is `/package.Service/Method`. */
  registerService(serviceName: string, methods: Record<string, MethodRegistration>): void {
    for (const [methodName, reg] of Object.entries(methods)) {
      this.methods.set(`/${serviceName}/${methodName}`, reg);
    }
  }

  async start(): Promise<void> {
    this.server = createServer();
    this.server.on('stream', (stream, headers) => {
      void this._handleStream(stream as ServerHttp2Stream, headers as Record<string, string>);
    });
    await new Promise<void>((resolve) => this.server!.listen(this.port, this.host, resolve));
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve) => this.server!.close(() => resolve()));
    this.server = null;
  }

  private async _handleStream(stream: ServerHttp2Stream, headers: Record<string, string>): Promise<void> {
    const path = headers[constants.HTTP2_HEADER_PATH] ?? '';
    const reg = this.methods.get(path);

    // Deferred trailer state: respond once with waitForTrailers, then send the
    // grpc-status trailer when the DATA stream ends.
    let finalCode = 0;
    let finalMessage: string | undefined;
    let responded = false;
    const begin = (): void => {
      if (responded) return;
      responded = true;
      stream.respond(
        { [constants.HTTP2_HEADER_STATUS]: 200, 'content-type': 'application/grpc+json' },
        { waitForTrailers: true },
      );
      stream.once('wantTrailers', () => {
        try {
          stream.sendTrailers({ 'grpc-status': String(finalCode), ...(finalMessage ? { 'grpc-message': finalMessage } : {}) });
        } catch { /* already closed */ }
      });
    };
    const finish = (code: number, message?: string): void => {
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
    let timer: NodeJS.Timeout | null = null;
    if (timeoutMs !== null) {
      timer = setTimeout(() => controller.abort(), timeoutMs);
      timer.unref();
    }
    stream.on('close', () => { if (!controller.signal.aborted) controller.abort(); });
    const ctx: GrpcCallContext = { signal: controller.signal, metadata: headers };

    const incoming = this._readFrames(stream);
    const writeMsg = (msg: unknown): void => {
      begin();
      stream.write(encodeFrame(this.codec.encode(msg)));
    };

    try {
      if (reg.type === 'unary' || reg.type === 'server-stream') {
        const first = await firstOf(incoming);
        const request = first === undefined ? null : this.codec.decode(first);
        if (reg.type === 'unary') {
          const response = await (reg.handler as UnaryHandler)(request, ctx);
          writeMsg(response);
        } else {
          await (reg.handler as ServerStreamHandler)(request, writeMsg, ctx);
        }
      } else {
        const requests = mapAsync(incoming, (b) => this.codec.decode(b));
        if (reg.type === 'client-stream') {
          const response = await (reg.handler as ClientStreamHandler)(requests, ctx);
          writeMsg(response);
        } else {
          await (reg.handler as BidiStreamHandler)(requests, writeMsg, ctx);
        }
      }
      if (timer) clearTimeout(timer);
      finish(controller.signal.aborted ? 4 : 0, controller.signal.aborted ? 'deadline exceeded' : undefined);
    } catch (err) {
      if (timer) clearTimeout(timer);
      const code = err instanceof GrpcError ? err.code : 13; // INTERNAL
      finish(code, err instanceof Error ? err.message : String(err));
    }
  }

  private _readFrames(stream: ServerHttp2Stream): AsyncGenerator<Buffer> {
    const queue: Buffer[] = [];
    let leftover: Buffer = Buffer.alloc(0);
    let ended = false;
    let errored: Error | null = null;
    let notify: (() => void) | null = null;
    const wake = (): void => { if (notify) { const n = notify; notify = null; n(); } };
    const maxBytes = this.maxBytes;

    stream.on('data', (chunk: Buffer) => {
      leftover = Buffer.concat([leftover, chunk]);
      try {
        const { frames, rest } = decodeFrames(leftover, maxBytes);
        leftover = rest;
        for (const f of frames) queue.push(f);
      } catch (e) {
        errored = e instanceof Error ? e : new Error(String(e));
      }
      wake();
    });
    stream.on('end', () => { ended = true; wake(); });
    stream.on('error', (e: Error) => { errored = e; ended = true; wake(); });

    // Event-listener based reader: stopping iteration early does NOT destroy
    // the stream (unlike `for await (const c of stream)`), so the writable side
    // stays open for the response.
    async function* gen(): AsyncGenerator<Buffer> {
      for (;;) {
        if (errored) throw errored;
        const next = queue.shift();
        if (next !== undefined) { yield next; continue; }
        if (ended) return;
        await new Promise<void>((resolve) => { notify = resolve; });
      }
    }
    return gen();
  }
}

async function firstOf<T>(it: AsyncIterable<T>): Promise<T | undefined> {
  for await (const v of it) return v;
  return undefined;
}

async function* mapAsync<T, U>(it: AsyncIterable<T>, fn: (v: T) => U): AsyncGenerator<U> {
  for await (const v of it) yield fn(v);
}

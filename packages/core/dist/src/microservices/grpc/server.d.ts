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
    codec?: {
        encode(v: unknown): Buffer;
        decode<T>(b: Buffer): T;
    };
}
export declare class GrpcServer {
    private readonly host;
    private readonly port;
    private readonly maxBytes;
    private readonly codec;
    private readonly methods;
    private server;
    constructor(opts?: GrpcServerOptions);
    /** Register a service implementation. Path is `/package.Service/Method`. */
    registerService(serviceName: string, methods: Record<string, MethodRegistration>): void;
    start(): Promise<void>;
    stop(): Promise<void>;
    private _respondTrailers;
    private _handleStream;
    private _readFrames;
}
//# sourceMappingURL=server.d.ts.map
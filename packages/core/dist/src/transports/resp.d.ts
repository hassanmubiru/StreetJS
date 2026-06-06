/** Encode a command as a RESP2 array of bulk strings. */
export declare function encodeCommand(args: (string | number)[]): Buffer;
export type RespValue = string | number | null | RespValue[];
/**
 * Incremental RESP2 reply parser. Feed bytes via `push()`; call `parse()` to
 * pull complete replies. Returns `undefined` when more data is needed.
 */
export declare class RespParser {
    private buf;
    push(chunk: Buffer): void;
    parse(): RespValue | undefined;
    private _lineEnd;
    private _parseAt;
}
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
export declare class RedisClient {
    private readonly host;
    private readonly port;
    private readonly password;
    private socket;
    private readonly parser;
    private readonly pending;
    private connected;
    constructor(opts?: RedisClientOptions);
    connect(): Promise<void>;
    command(args: (string | number)[]): Promise<RespValue>;
    get(key: string): Promise<string | null>;
    set(key: string, value: string, ttlMs?: number): Promise<void>;
    del(key: string): Promise<void>;
    publish(channel: string, message: string): Promise<void>;
    /** Open a dedicated subscription connection and invoke handler per message. */
    subscribe(channel: string, handler: (message: string) => void): Promise<() => void>;
    close(): void;
}
//# sourceMappingURL=resp.d.ts.map
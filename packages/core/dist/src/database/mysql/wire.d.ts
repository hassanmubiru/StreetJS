import { type Socket } from 'node:net';
import { Readable } from 'node:stream';
import type { DbResult } from '../types.js';
/**
 * Compute mysql_native_password response:
 *   SHA1(password) XOR SHA1(seed + SHA1(SHA1(password)))
 * @internal
 */
export declare function nativePasswordHash(password: string, seed: Buffer): Buffer;
/**
 * Compute caching_sha2_password challenge response:
 *   XOR(SHA256(password), SHA256(SHA256(SHA256(password)) + seed))
 *
 * An empty password yields an empty (zero-length) response, matching the
 * MySQL client protocol — the server treats an empty scramble as "no password".
 * @internal
 */
export declare function sha2PasswordHash(password: string, seed: Buffer): Buffer;
interface ServerGreeting {
    protocolVersion: number;
    serverVersion: string;
    connectionId: number;
    authPluginData: Buffer;
    capabilityFlags: number;
    charset: number;
    statusFlags: number;
    authPluginName: string;
}
export declare class MysqlResultStream extends Readable {
    private _done;
    private readonly _onResume;
    /**
     * @param onResume Invoked when the consumer is ready for more data (Node calls
     *   `_read()` once the internal buffer drops below the highWaterMark). The
     *   connection layer uses this to release socket backpressure via `resume()`.
     */
    constructor(onResume?: () => void);
    pushRow(row: Record<string, string | null>): boolean;
    finalize(error?: Error): void;
    _read(_size: number): void;
}
export interface MysqlConnectOptions {
    host: string;
    port?: number;
    user: string;
    password: string;
    database: string;
    connectTimeoutMs?: number;
}
type ConnState = 'connecting' | 'authenticating' | 'ready' | 'query' | 'closed';
export declare class MysqlConnection {
    protected socket: Socket | null;
    protected state: ConnState;
    private buffer;
    protected greeting: ServerGreeting | null;
    private opts;
    private authResolve;
    private authReject;
    private pendingQuery;
    private streamTarget;
    private columns;
    private colCount;
    private colsReceived;
    private expectEof;
    private pendingPrepare;
    private sha2State;
    private sha2Seed;
    private _inExec;
    private seq;
    get isReady(): boolean;
    get isClosed(): boolean;
    /** The server version string from the greeting packet. */
    get serverVersion(): string;
    /**
     * Static factory: connects to MySQL/MariaDB and returns the appropriate
     * subclass based on the server greeting (task 6.7).
     */
    static connect(opts: MysqlConnectOptions): Promise<MysqlConnection>;
    /** @internal Used by MariaDbConnection to take over a connected MysqlConnection. */
    _transferFrom(other: MysqlConnection): void;
    protected _connect(opts: MysqlConnectOptions): Promise<void>;
    private _onData;
    /** Socket error handler — rejects any in-flight auth/query and closes state. */
    private _onSocketError;
    /** Socket close handler — rejects any in-flight query and closes state. */
    private _onSocketClose;
    private _processBuffer;
    private _handlePacket;
    private _handleAuthPacket;
    private _handleQueryPacket;
    private _handlePreparePacket;
    private _completePrepare;
    private execColumns;
    private execColCount;
    private execColsReceived;
    private execExpectRows;
    private execPendingQuery;
    private execStreamTarget;
    private _handleExecPacket;
    private _resetExecState;
    /** Parse a binary protocol result row. */
    private _parseBinaryRow;
    /**
     * Execute a SQL query.
     * - With params: uses COM_STMT_PREPARE + COM_STMT_EXECUTE (binary protocol).
     * - Without params: uses COM_QUERY (text protocol).
     */
    query(sql: string, params?: unknown[]): Promise<DbResult>;
    private _queryText;
    private _execPrepared;
    private _prepare;
    private _execute;
    private _stmtClose;
    /**
     * Execute a SELECT query and return a Readable stream of rows.
     * Uses text protocol (COM_QUERY) with socket.pause()/resume() for backpressure.
     */
    queryStream(sql: string): MysqlResultStream;
    close(): Promise<void>;
}
export {};
//# sourceMappingURL=wire.d.ts.map
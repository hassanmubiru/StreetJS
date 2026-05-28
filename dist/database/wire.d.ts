import { Readable } from 'node:stream';
export interface PgRow {
    [column: string]: string | null;
}
export interface PgResult {
    rows: PgRow[];
    command: string;
    rowCount: number;
}
export declare class StreetPostgresWireStream extends Readable {
    private _done;
    constructor();
    /** Called internally when a DataRow is parsed */
    pushRow(row: PgRow): boolean;
    finalize(error?: Error): void;
    _read(_size: number): void;
}
export interface PgConnectOptions {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
    connectTimeoutMs?: number;
}
export declare class PgConnection {
    private socket;
    private state;
    private buffer;
    private fields;
    private scramState;
    private queryResolve;
    private queryReject;
    private queryRows;
    private queryCommand;
    private streamTarget;
    private authResolve;
    private authReject;
    static connect(opts: PgConnectOptions): Promise<PgConnection>;
    private _connect;
    private _processBuffer;
    private _handleMessage;
    private _handleAuth;
    private _parseRowDescription;
    private _parseDataRow;
    private _parseError;
    /** Execute a query with optional parameters, return all rows buffered */
    query(sql: string, params?: unknown[]): Promise<PgResult>;
    /** Execute a parameterized query using Parse/Describe/Bind/Execute/Sync protocol */
    private _queryParams;
    /** Execute a query, return a Readable stream of PgRow objects */
    queryStream(sql: string): StreetPostgresWireStream;
    /** Close the connection gracefully */
    close(): Promise<void>;
    get isReady(): boolean;
    get isClosed(): boolean;
    /** Sign a payload with HMAC-SHA256 (utility method) */
    static hmacSign(key: string, data: string): string;
}
//# sourceMappingURL=wire.d.ts.map
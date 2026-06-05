import { Readable } from 'node:stream';
import type { DbResult } from './types.js';
/** @internal Exported for testing. Builds a PostgreSQL Parse ('P') message. */
export declare function buildParseMessage(query: string): Buffer;
/** @internal Exported for testing. Builds a PostgreSQL Bind ('B') message. */
export declare function buildBindMessage(params: unknown[]): Buffer;
/** @internal Exported for testing. Builds a PostgreSQL Execute ('E') message. */
export declare function buildExecuteMessage(): Buffer;
/** @internal Exported for testing. Builds a PostgreSQL Describe ('D') message for an unnamed prepared statement. */
export declare function buildDescribeMessage(): Buffer;
/** @internal Exported for testing. Builds a PostgreSQL Sync ('S') message. */
export declare function buildSyncMessage(): Buffer;
/** @internal Exported for testing. Builds a SASLInitialResponse ('p') message. */
export declare function buildSASLInitialResponse(mechanism: string, clientFirstMessage: string): Buffer;
/** @internal Exported for testing. Builds a SASLResponse ('p') message with raw client-final-message bytes. */
export declare function buildSASLResponse(clientFinalMessage: string): Buffer;
/** @internal Exported for testing. Parse a SASL mechanism list from buffer (null-terminated strings). */
export declare function parseSASLMechanisms(data: Buffer): string[];
/** @internal Exported for testing. Parse SCRAM key=value parameters from a comma-separated message string. */
export declare function parseScramParams(message: string): Record<string, string>;
/**
 * Validate that a string does not contain characters prohibited by RFC 4013 §3 (SASLprep).
 * Checks the most common prohibited categories after NFKC normalization.
 * @internal Exported for testing.
 */
export declare function validateSASLprep(s: string): boolean;
/** @internal Exported for testing. XOR two buffers together (bytewise). */
export declare function xorBuffers(a: Buffer, b: Buffer): Buffer;
export interface PgRow {
    [column: string]: string | null;
}
/**
 * PostgreSQL query result — alias for the shared {@link DbResult} type.
 * Maintained for backwards compatibility.
 */
export type PgResult = DbResult;
export type { DbResult } from './types.js';
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
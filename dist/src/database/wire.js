// src/database/wire.ts
// PostgreSQL frontend/backend wire protocol v3 implementation.
// Pure node:net + node:crypto – no external dependencies.
import { createConnection } from 'node:net';
import { createHash, createHmac } from 'node:crypto';
import { Readable } from 'node:stream';
// ─── Wire Constants ────────────────────────────────────────────────────────────
const PROTOCOL_VERSION = 196608; // 3.0
const BackendMsg = {
    AuthRequest: 0x52, // 'R'
    BackendKeyData: 0x4b, // 'K'
    BindComplete: 0x32, // '2'
    CloseComplete: 0x33, // '3'
    CommandComplete: 0x43, // 'C'
    DataRow: 0x44, // 'D'
    EmptyQuery: 0x49, // 'I'
    ErrorResponse: 0x45, // 'E'
    NoData: 0x6e, // 'n'
    NoticeResponse: 0x4e, // 'N'
    ParameterDescription: 0x74, // 't'
    ParameterStatus: 0x53, // 'S'
    ParseComplete: 0x31, // '1'
    PortalSuspended: 0x73, // 's'
    ReadyForQuery: 0x5a, // 'Z'
    RowDescription: 0x54, // 'T'
};
const AuthType = {
    Ok: 0,
    CleartextPassword: 3,
    MD5Password: 5,
};
// ─── Message Builders (client → server) ────────────────────────────────────────
function buildStartupMessage(user, database) {
    const params = `user\0${user}\0database\0${database}\0`;
    const paramBuf = Buffer.from(params, 'utf8');
    const buf = Buffer.allocUnsafe(4 + 4 + paramBuf.length + 1);
    let offset = 0;
    buf.writeUInt32BE(buf.length, offset);
    offset += 4;
    buf.writeUInt32BE(PROTOCOL_VERSION, offset);
    offset += 4;
    paramBuf.copy(buf, offset);
    offset += paramBuf.length;
    buf[offset] = 0; // terminator
    return buf;
}
function buildPasswordMessage(password) {
    const pwBuf = Buffer.from(password + '\0', 'utf8');
    const buf = Buffer.allocUnsafe(1 + 4 + pwBuf.length);
    buf[0] = 0x70; // 'p'
    buf.writeUInt32BE(4 + pwBuf.length, 1);
    pwBuf.copy(buf, 5);
    return buf;
}
function buildMD5Password(password, user, salt) {
    const inner = md5(password + user);
    const outer = 'md5' + md5(inner + salt.toString('binary'));
    return buildPasswordMessage(outer);
}
function buildQueryMessage(sql) {
    const sqlBuf = Buffer.from(sql + '\0', 'utf8');
    const buf = Buffer.allocUnsafe(1 + 4 + sqlBuf.length);
    buf[0] = 0x51; // 'Q'
    buf.writeUInt32BE(4 + sqlBuf.length, 1);
    sqlBuf.copy(buf, 5);
    return buf;
}
function buildTerminateMessage() {
    const buf = Buffer.allocUnsafe(5);
    buf[0] = 0x58; // 'X'
    buf.writeUInt32BE(4, 1);
    return buf;
}
// ─── Extended Query Protocol: Parse / Bind / Execute / Sync ────────────────────
/** @internal Exported for testing. Builds a PostgreSQL Parse ('P') message. */
export function buildParseMessage(query) {
    const queryBuf = Buffer.from(query + '\0', 'utf8');
    // Empty statement name + query string + 2-byte zero param types count
    const stmtNameLen = 1; // just null terminator for empty name
    const buf = Buffer.allocUnsafe(1 + 4 + stmtNameLen + queryBuf.length + 2);
    let offset = 0;
    buf[offset] = 0x50; // 'P'
    offset += 1;
    // Length placeholder, will be filled at the end
    const lenOffset = offset;
    offset += 4;
    // Empty statement name (just null terminator)
    buf[offset] = 0;
    offset += 1;
    // Query string + null terminator
    queryBuf.copy(buf, offset);
    offset += queryBuf.length;
    // Number of parameter types (0 = let server infer)
    buf.writeUInt16BE(0, offset);
    offset += 2;
    // Fill length
    buf.writeUInt32BE(offset - 1, lenOffset);
    return buf.subarray(0, offset);
}
/** @internal Exported for testing. Builds a PostgreSQL Bind ('B') message. */
export function buildBindMessage(params) {
    let totalLen = 1 + 4; // 'B' + length
    // Portal name (empty)
    totalLen += 1; // null terminator
    // Statement name (empty)
    totalLen += 1; // null terminator
    // Parameter format codes: 2 bytes, 0 = all text
    totalLen += 2;
    // Number of parameters: 2 bytes
    totalLen += 2;
    const paramBuffers = [];
    for (const param of params) {
        if (param === null || param === undefined) {
            // NULL: 4-byte length = -1
            totalLen += 4;
            paramBuffers.push(Buffer.alloc(4));
            paramBuffers[paramBuffers.length - 1].writeInt32BE(-1);
        }
        else {
            let val;
            if (typeof param === 'boolean') {
                val = param ? 't' : 'f';
            }
            else if (typeof param === 'number') {
                val = String(param);
            }
            else if (param instanceof Buffer) {
                // Binary parameter - send raw bytes with text format (might not work for all types)
                val = param.toString('utf8');
            }
            else {
                val = String(param);
            }
            const valBuf = Buffer.from(val, 'utf8');
            totalLen += 4 + valBuf.length; // length prefix + value bytes
            paramBuffers.push(valBuf);
        }
    }
    // Result format codes: 2 bytes, 0 = all text
    totalLen += 2;
    const buf = Buffer.allocUnsafe(totalLen);
    let offset = 0;
    buf[offset] = 0x42; // 'B'
    offset += 1;
    buf.writeUInt32BE(totalLen - 1, offset);
    offset += 4;
    // Empty portal name
    buf[offset] = 0;
    offset += 1;
    // Empty statement name
    buf[offset] = 0;
    offset += 1;
    // All params use text format (0)
    buf.writeUInt16BE(0, offset);
    offset += 2;
    // Number of parameters
    buf.writeUInt16BE(params.length, offset);
    offset += 2;
    let paramIdx = 0;
    for (const param of params) {
        if (param === null || param === undefined) {
            const lenBuf = paramBuffers[paramIdx];
            lenBuf.copy(buf, offset);
            offset += 4;
        }
        else {
            const valBuf = paramBuffers[paramIdx];
            buf.writeInt32BE(valBuf.length, offset);
            offset += 4;
            valBuf.copy(buf, offset);
            offset += valBuf.length;
        }
        paramIdx++;
    }
    // Result format codes (0 = all text)
    buf.writeUInt16BE(0, offset);
    offset += 2;
    return buf.subarray(0, offset);
}
/** @internal Exported for testing. Builds a PostgreSQL Execute ('E') message. */
export function buildExecuteMessage() {
    const buf = Buffer.allocUnsafe(1 + 4 + 1 + 4);
    buf[0] = 0x45; // 'E'
    buf.writeUInt32BE(9, 1); // length
    buf[5] = 0; // empty portal name (null terminator)
    buf.writeUInt32BE(0, 6); // max rows (0 = unlimited)
    return buf;
}
/** @internal Exported for testing. Builds a PostgreSQL Sync ('S') message. */
export function buildSyncMessage() {
    const buf = Buffer.allocUnsafe(5);
    buf[0] = 0x53; // 'S'
    buf.writeUInt32BE(4, 1);
    return buf;
}
function md5(input) {
    return createHash('md5').update(input, 'binary').digest('hex');
}
// ─── Streaming result (backpressure-aware) ─────────────────────────────────────
export class StreetPostgresWireStream extends Readable {
    rows = [];
    _done = false;
    MAX_BUFFERED = 256; // bounded row queue
    constructor() {
        super({ objectMode: true, highWaterMark: 64 });
    }
    /** Called internally when a DataRow is parsed */
    pushRow(row) {
        if (this._done)
            return false;
        if (this.rows.length >= this.MAX_BUFFERED)
            return false; // signal backpressure
        return this.push(row);
    }
    finalize(error) {
        this._done = true;
        if (error) {
            this.destroy(error);
        }
        else {
            this.push(null);
        }
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _read(_size) {
        // Downstream wants more data — nothing to do in push mode
        // Socket resume is handled by the connection layer
    }
}
export class PgConnection {
    socket = null;
    state = 'connecting';
    buffer = Buffer.alloc(0);
    fields = [];
    // Pending query callbacks
    queryResolve = null;
    queryReject = null;
    queryRows = [];
    queryCommand = '';
    streamTarget = null;
    // Auth resolve
    authResolve = null;
    authReject = null;
    static async connect(opts) {
        const conn = new PgConnection();
        await conn._connect(opts);
        return conn;
    }
    _connect(opts) {
        return new Promise((resolve, reject) => {
            const timeoutMs = opts.connectTimeoutMs ?? 10_000;
            const timer = setTimeout(() => {
                this.socket?.destroy();
                reject(new Error('PostgreSQL connection timeout'));
            }, timeoutMs);
            timer.unref();
            this.authResolve = () => { clearTimeout(timer); resolve(); };
            this.authReject = (err) => { clearTimeout(timer); reject(err); };
            const socket = createConnection({ host: opts.host, port: opts.port });
            this.socket = socket;
            socket.setKeepAlive(true, 10_000);
            socket.setNoDelay(true);
            socket.once('connect', () => {
                this.state = 'authenticating';
                socket.write(buildStartupMessage(opts.user, opts.database));
            });
            socket.on('data', (chunk) => {
                this.buffer = Buffer.concat([this.buffer, chunk]);
                this._processBuffer(opts);
            });
            socket.once('error', (err) => {
                this.state = 'closed';
                if (this.authReject) {
                    this.authReject(err);
                    this.authReject = null;
                }
                if (this.queryReject) {
                    this.queryReject(err);
                    this.queryReject = null;
                }
                if (this.streamTarget) {
                    this.streamTarget.finalize(err);
                    this.streamTarget = null;
                }
            });
            socket.once('close', () => {
                this.state = 'closed';
                const err = new Error('PostgreSQL connection closed unexpectedly');
                if (this.queryReject) {
                    this.queryReject(err);
                    this.queryReject = null;
                }
                if (this.streamTarget) {
                    this.streamTarget.finalize(err);
                    this.streamTarget = null;
                }
            });
        });
    }
    _processBuffer(opts) {
        while (this.buffer.length >= 5) {
            const msgType = this.buffer[0];
            const msgLen = this.buffer.readUInt32BE(1);
            const totalLen = 1 + msgLen;
            if (this.buffer.length < totalLen)
                break;
            const msgBody = this.buffer.subarray(5, totalLen);
            this.buffer = this.buffer.subarray(totalLen);
            this._handleMessage(msgType, msgBody, opts);
        }
    }
    _handleMessage(type, body, opts) {
        switch (type) {
            case BackendMsg.AuthRequest:
                this._handleAuth(body, opts);
                break;
            case BackendMsg.ParameterStatus:
                // e.g. "server_version=16.0" — ignore
                break;
            case BackendMsg.BackendKeyData:
                // pid + secret key — ignore for now
                break;
            case BackendMsg.ReadyForQuery:
                if (this.state === 'authenticating') {
                    this.state = 'ready';
                    if (this.authResolve) {
                        this.authResolve();
                        this.authResolve = null;
                    }
                }
                else if (this.state === 'query') {
                    this.state = 'ready';
                    const rows = this.queryRows;
                    const cmd = this.queryCommand;
                    const resolve = this.queryResolve;
                    const stream = this.streamTarget;
                    this.queryRows = [];
                    this.queryCommand = '';
                    this.queryResolve = null;
                    this.queryReject = null;
                    this.streamTarget = null;
                    this.fields = [];
                    if (stream) {
                        stream.finalize();
                    }
                    else if (resolve) {
                        // Parse row count from CommandComplete message when available
                        // CommandComplete examples: "SELECT 3", "INSERT 0 1", "DELETE 2"
                        const rcMatch = cmd.match(/(\d+)\s*$/);
                        const rowCount = rcMatch ? parseInt(rcMatch[1], 10) : rows.length;
                        resolve({ rows, command: cmd, rowCount });
                    }
                }
                break;
            case BackendMsg.RowDescription:
                this.fields = this._parseRowDescription(body);
                break;
            case BackendMsg.DataRow: {
                const row = this._parseDataRow(body);
                if (this.streamTarget) {
                    const canContinue = this.streamTarget.pushRow(row);
                    if (!canContinue && this.socket) {
                        this.socket.pause(); // backpressure
                    }
                }
                else {
                    this.queryRows.push(row);
                }
                break;
            }
            case BackendMsg.CommandComplete: {
                const cmd = body.toString('utf8').replace(/\0$/, '');
                this.queryCommand = cmd;
                break;
            }
            case BackendMsg.EmptyQuery:
                this.queryCommand = '';
                break;
            case BackendMsg.ErrorResponse: {
                const err = this._parseError(body);
                // Move to ready state immediately to avoid leaving the connection
                // stuck in "query" if the client checks isReady right after an error.
                if (this.state === 'query')
                    this.state = 'ready';
                if (this.state === 'authenticating') {
                    if (this.authReject) {
                        this.authReject(err);
                        this.authReject = null;
                    }
                }
                else {
                    if (this.streamTarget) {
                        this.streamTarget.finalize(err);
                        this.streamTarget = null;
                    }
                    else if (this.queryReject) {
                        this.queryReject(err);
                        this.queryReject = null;
                    }
                    // Clear any pending resolve to avoid duplicate callbacks when ReadyForQuery arrives
                    this.queryResolve = null;
                }
                // After error, server will still send ReadyForQuery; ignore duplicate handling
                break;
            }
            case BackendMsg.NoticeResponse:
                // Log notices but don't block
                break;
            default:
                // Unknown message type — skip
                break;
        }
    }
    _handleAuth(body, opts) {
        const authType = body.readUInt32BE(0);
        switch (authType) {
            case AuthType.Ok:
                // Auth succeeded — wait for ReadyForQuery
                break;
            case AuthType.CleartextPassword:
                this.socket?.write(buildPasswordMessage(opts.password));
                break;
            case AuthType.MD5Password: {
                const salt = body.subarray(4, 8);
                this.socket?.write(buildMD5Password(opts.password, opts.user, salt));
                break;
            }
            default:
                if (this.authReject) {
                    this.authReject(new Error(`Unsupported PostgreSQL auth method: ${authType}`));
                    this.authReject = null;
                }
        }
    }
    _parseRowDescription(body) {
        const fieldCount = body.readUInt16BE(0);
        const fields = [];
        let offset = 2;
        for (let i = 0; i < fieldCount; i++) {
            const nameEnd = body.indexOf(0, offset);
            const name = body.toString('utf8', offset, nameEnd);
            offset = nameEnd + 1 + 18; // skip tableOid(4)+attNum(2)+typeOid(4)+typeSize(2)+typeMod(4)+format(2)
            const typeOid = body.readUInt32BE(nameEnd + 1 + 6);
            fields.push({ name, typeOid });
        }
        return fields;
    }
    _parseDataRow(body) {
        const colCount = body.readUInt16BE(0);
        const row = {};
        let offset = 2;
        for (let i = 0; i < colCount; i++) {
            const len = body.readInt32BE(offset);
            offset += 4;
            const fieldName = this.fields[i]?.name ?? `col${i}`;
            if (len === -1) {
                row[fieldName] = null;
            }
            else {
                row[fieldName] = body.toString('utf8', offset, offset + len);
                offset += len;
            }
        }
        return row;
    }
    _parseError(body) {
        const fields = {};
        let i = 0;
        while (i < body.length) {
            const code = String.fromCharCode(body[i]);
            if (code === '\0')
                break;
            i++;
            const end = body.indexOf(0, i);
            fields[code] = body.toString('utf8', i, end);
            i = end + 1;
        }
        const msg = fields['M'] ?? 'Unknown PostgreSQL error';
        const detail = fields['D'] ?? '';
        return new Error(`PostgreSQL: ${msg}${detail ? ' — ' + detail : ''}`);
    }
    /** Execute a query with optional parameters, return all rows buffered */
    query(sql, params) {
        if (this.state !== 'ready') {
            return Promise.reject(new Error(`Cannot query: connection is in state "${this.state}"`));
        }
        // Use extended query protocol when params are provided
        if (params !== undefined && params.length > 0) {
            return this._queryParams(sql, params);
        }
        return new Promise((resolve, reject) => {
            this.state = 'query';
            this.queryResolve = resolve;
            this.queryReject = reject;
            this.queryRows = [];
            this.streamTarget = null;
            this.socket?.write(buildQueryMessage(sql));
        });
    }
    /** Execute a parameterized query using Parse/Bind/Execute/Sync protocol */
    _queryParams(sql, params) {
        return new Promise((resolve, reject) => {
            this.state = 'query';
            this.queryResolve = resolve;
            this.queryReject = reject;
            this.queryRows = [];
            this.streamTarget = null;
            const parseMsg = buildParseMessage(sql);
            const bindMsg = buildBindMessage(params);
            const execMsg = buildExecuteMessage();
            const syncMsg = buildSyncMessage();
            // Send all four messages in a single write for atomicity
            this.socket?.write(Buffer.concat([parseMsg, bindMsg, execMsg, syncMsg]));
        });
    }
    /** Execute a query, return a Readable stream of PgRow objects */
    queryStream(sql) {
        const stream = new StreetPostgresWireStream();
        if (this.state !== 'ready') {
            setImmediate(() => stream.finalize(new Error(`Cannot query: connection state is "${this.state}"`)));
            return stream;
        }
        this.state = 'query';
        this.streamTarget = stream;
        this.queryResolve = null;
        this.queryReject = null;
        this.queryRows = [];
        // Resume socket when consumer reads from stream
        stream.on('drain', () => {
            this.socket?.resume();
        });
        this.socket?.write(buildQueryMessage(sql));
        return stream;
    }
    /** Close the connection gracefully */
    async close() {
        if (this.state === 'closed')
            return;
        this.state = 'closed';
        return new Promise((resolve) => {
            if (!this.socket) {
                resolve();
                return;
            }
            this.socket.write(buildTerminateMessage(), () => {
                this.socket?.destroy();
                resolve();
            });
        });
    }
    get isReady() {
        return this.state === 'ready';
    }
    get isClosed() {
        return this.state === 'closed';
    }
    /** Sign a payload with HMAC-SHA256 (utility method) */
    static hmacSign(key, data) {
        return createHmac('sha256', key).update(data).digest('hex');
    }
}
//# sourceMappingURL=wire.js.map
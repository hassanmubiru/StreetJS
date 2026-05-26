// tests/wire-protocol.test.ts
// Unit tests for the PostgreSQL extended query protocol message builders and
// the _queryParams integration path (Parse/Bind/Execute/Sync).
//
// Message builders are tested by directly inspecting buffer bytes against
// the PostgreSQL wire protocol v3 specification.
//
// The _queryParams integration test wires a mock socket into PgConnection
// to verify the full write-and-response cycle without a real database.
import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { buildParseMessage, buildBindMessage, buildExecuteMessage, buildSyncMessage, PgConnection, } from '../src/database/wire.js';
// ─── Helpers ───────────────────────────────────────────────────────────────────
/** Build a complete PG server response from an array of {type, body} parts */
function serverResponse(msgs) {
    const parts = [];
    for (const m of msgs) {
        const len = Buffer.alloc(4);
        len.writeUInt32BE(4 + m.body.length); // length includes itself
        parts.push(Buffer.from([m.type]), len, m.body);
    }
    return Buffer.concat(parts);
}
// NOTE: serverResponse() wraps each body with a type byte and length prefix.
// These helpers return ONLY the body content (without length prefix).
function parseComplete() {
    return Buffer.alloc(0); // no body
}
function bindComplete() {
    return Buffer.alloc(0); // no body
}
function commandComplete(tag) {
    // Body is just the null-terminated command tag
    return Buffer.from(tag + '\0', 'utf8');
}
function readyForQuery(status) {
    // Body is a single byte (transaction status indicator)
    return Buffer.from([status]);
}
const MOCK_CONNECT_OPTS = {
    host: 'localhost',
    port: 5432,
    user: 'test',
    password: 'test',
    database: 'test',
};
// ─── Suite 1: buildParseMessage ───────────────────────────────────────────────
describe('buildParseMessage', () => {
    it('has type byte 0x50 (P)', () => {
        const buf = buildParseMessage('SELECT 1');
        assert.equal(buf[0], 0x50);
    });
    it('encodes message length correctly', () => {
        const buf = buildParseMessage('SELECT 1');
        // length field is bytes 1-4, includes itself (4) + stmt name null (1)
        // + queryBuf (query + null) + param types count (2)
        const length = buf.readUInt32BE(1);
        const expectedLen = 4 + 1 + Buffer.from('SELECT 1\0', 'utf8').length + 2;
        assert.equal(length, expectedLen);
    });
    it('has empty statement name (null terminator at offset 5)', () => {
        const buf = buildParseMessage('SELECT 1');
        // After type byte (1) + length (4) = offset 5
        assert.equal(buf[5], 0);
    });
    it('embeds the query string followed by null terminator', () => {
        const query = 'SELECT $1::int AS val';
        const buf = buildParseMessage(query);
        const queryEnd = buf.indexOf(0, 6); // find null after query start
        const extracted = buf.toString('utf8', 6, queryEnd);
        assert.equal(extracted, query);
        assert.equal(buf[queryEnd], 0); // null terminator
    });
    it('sets parameter types count to 0 (uint16BE)', () => {
        const buf = buildParseMessage('SELECT 1');
        // After query string + null, last 2 bytes = param types
        const paramTypesLen = buf.readUInt16BE(buf.length - 2);
        assert.equal(paramTypesLen, 0);
    });
    it('handles queries with special characters', () => {
        const query = "INSERT INTO items (name, price) VALUES ($1, $2)";
        const buf = buildParseMessage(query);
        const queryEnd = buf.indexOf(0, 6);
        const extracted = buf.toString('utf8', 6, queryEnd);
        assert.equal(extracted, query);
    });
    it('returns a buffer whose subarray(0) gives the full message including type byte', () => {
        const buf = buildParseMessage('SELECT 1');
        const length = buf.readUInt32BE(1);
        // Total message size on wire = 1 (type) + length
        assert.equal(buf.length, 1 + length);
    });
});
// ─── Suite 2: buildBindMessage ────────────────────────────────────────────────
describe('buildBindMessage', () => {
    it('has type byte 0x42 (B)', () => {
        const buf = buildBindMessage(['hello']);
        assert.equal(buf[0], 0x42);
    });
    it('encodes empty portal name (null at offset 5)', () => {
        const buf = buildBindMessage(['hello']);
        // type(1) + length(4) = offset 5
        assert.equal(buf[5], 0);
    });
    it('encodes empty statement name (null after portal name)', () => {
        const buf = buildBindMessage(['hello']);
        // type(1) + length(4) + portal_null(1) = offset 6
        assert.equal(buf[6], 0);
    });
    it('sets parameter format codes to 0 (all text)', () => {
        const buf = buildBindMessage(['hello']);
        // type(1) + length(4) + portal_null(1) + stmt_null(1) = offset 7
        const formatCode = buf.readUInt16BE(7);
        assert.equal(formatCode, 0);
    });
    it('writes correct number of parameters', () => {
        const buf = buildBindMessage(['a', 'b', 'c']);
        // type(1) + length(4) + portal_null(1) + stmt_null(1) + format(2) = offset 9
        const paramCount = buf.readUInt16BE(9);
        assert.equal(paramCount, 3);
    });
    it('encodes a string param with 4-byte length prefix + utf8 value', () => {
        const buf = buildBindMessage(['hello']);
        // After header: type(1) + len(4) + portal_null(1) + stmt_null(1) + fmt(2) + count(2) = 11
        const paramLen = buf.readInt32BE(11);
        assert.equal(paramLen, 5); // 'hello' is 5 bytes
        const paramVal = buf.toString('utf8', 15, 20);
        assert.equal(paramVal, 'hello');
    });
    it('encodes null param as Int32BE(-1)', () => {
        const buf = buildBindMessage([null]);
        const paramLen = buf.readInt32BE(11);
        assert.equal(paramLen, -1);
    });
    it('encodes undefined param as Int32BE(-1)', () => {
        const buf = buildBindMessage([undefined]);
        const paramLen = buf.readInt32BE(11);
        assert.equal(paramLen, -1);
    });
    it('encodes boolean true as single byte t', () => {
        const buf = buildBindMessage([true]);
        const paramLen = buf.readInt32BE(11);
        assert.equal(paramLen, 1);
        assert.equal(buf[15], 0x74); // 't'
    });
    it('encodes boolean false as single byte f', () => {
        const buf = buildBindMessage([false]);
        const paramLen = buf.readInt32BE(11);
        assert.equal(paramLen, 1);
        assert.equal(buf[15], 0x66); // 'f'
    });
    it('encodes number as its string representation', () => {
        const buf = buildBindMessage([42]);
        const paramLen = buf.readInt32BE(11);
        assert.equal(paramLen, 2); // '42' is 2 bytes
        const paramVal = buf.toString('utf8', 15, 17);
        assert.equal(paramVal, '42');
    });
    it('encodes negative number', () => {
        const buf = buildBindMessage([-10]);
        const paramLen = buf.readInt32BE(11);
        assert.equal(paramLen, 3); // '-10' is 3 bytes
        const paramVal = buf.toString('utf8', 15, 18);
        assert.equal(paramVal, '-10');
    });
    it('encodes floating point number', () => {
        const buf = buildBindMessage([3.14]);
        const paramLen = buf.readInt32BE(11);
        const paramVal = buf.toString('utf8', 15, 15 + paramLen);
        assert.equal(paramVal, '3.14');
    });
    it('encodes multiple params of mixed types', () => {
        const buf = buildBindMessage([42, 'hello', null, true]);
        // header = 11 bytes, then 4 params
        let offset = 11;
        // Param 0: number 42
        assert.equal(buf.readInt32BE(offset), 2);
        assert.equal(buf.toString('utf8', offset + 4, offset + 6), '42');
        offset += 4 + 2;
        // Param 1: string 'hello' (5 chars)
        assert.equal(buf.readInt32BE(offset), 5);
        assert.equal(buf.toString('utf8', offset + 4, offset + 9), 'hello');
        offset += 4 + 5;
        // Param 2: null
        assert.equal(buf.readInt32BE(offset), -1);
        offset += 4;
        // Param 3: boolean true
        assert.equal(buf.readInt32BE(offset), 1);
        assert.equal(buf[offset + 4], 0x74); // 't'
        offset += 4 + 1;
        // Result format codes at end (2 bytes = 0)
        assert.equal(buf.readUInt16BE(offset), 0);
    });
    it('handles empty params array', () => {
        const buf = buildBindMessage([]);
        // After header, param count should be 0, then result format codes
        assert.equal(buf.readUInt16BE(9), 0); // param count = 0
        const paramCount = buf.length - 11; // header = 11
        assert.equal(paramCount, 2); // just result format codes (2 bytes)
        assert.equal(buf.readUInt16BE(11), 0); // result format = all text
    });
    it('writes zero result format codes at the end', () => {
        const buf = buildBindMessage(['a']);
        const resultFmt = buf.readUInt16BE(buf.length - 2);
        assert.equal(resultFmt, 0);
    });
});
// ─── Suite 3: buildExecuteMessage ─────────────────────────────────────────────
describe('buildExecuteMessage', () => {
    it('has type byte 0x45 (E)', () => {
        const buf = buildExecuteMessage();
        assert.equal(buf[0], 0x45);
    });
    it('has total length of 9 bytes on wire', () => {
        const buf = buildExecuteMessage();
        // type(1) + length(4) + portal_null(1) + max_rows(4) = 10? No...
        // Actually: type(1) + len(4) + portal_null(1) + max_rows(4) = 10
        // But the length field = 9 (everything after type byte)
        const length = buf.readUInt32BE(1);
        assert.equal(length, 9);
        assert.equal(buf.length, 1 + 9); // 10 total
    });
    it('has empty portal name at byte 5', () => {
        const buf = buildExecuteMessage();
        // type(1) + len(4) = offset 5
        assert.equal(buf[5], 0);
    });
    it('sets max rows to 0 (unlimited) at byte 6', () => {
        const buf = buildExecuteMessage();
        // type(1) + len(4) + portal_null(1) = offset 6
        const maxRows = buf.readUInt32BE(6);
        assert.equal(maxRows, 0);
    });
});
// ─── Suite 4: buildSyncMessage ────────────────────────────────────────────────
describe('buildSyncMessage', () => {
    it('has type byte 0x53 (S)', () => {
        const buf = buildSyncMessage();
        assert.equal(buf[0], 0x53);
    });
    it('has length of 4 (no body)', () => {
        const buf = buildSyncMessage();
        const length = buf.readUInt32BE(1);
        assert.equal(length, 4);
        assert.equal(buf.length, 5); // type(1) + length(4)
    });
});
// ─── Suite 5: _queryParams integration ────────────────────────────────────────
//
// Wires a mock socket into PgConnection to verify the extended query protocol
// flow without a real database: Parse → Bind → Execute → Sync messages are
// written atomically, and the connection correctly handles the server response
// cycle (ParseComplete → BindComplete → CommandComplete → ReadyForQuery).
describe('_queryParams integration (via PgConnection.query)', () => {
    /** Helper: create a PgConnection wired to a mock socket */
    function createMockedConnection() {
        const socket = new EventEmitter();
        socket.setKeepAlive = () => { };
        socket.setNoDelay = () => { };
        socket.destroy = () => { };
        socket.write = mock.fn(() => true);
        const conn = new PgConnection();
        conn.socket = socket;
        conn.state = 'ready';
        // Register the data handler that _connect() normally sets up
        socket.on('data', (chunk) => {
            conn.buffer = Buffer.concat([conn.buffer, chunk]);
            conn._processBuffer(MOCK_CONNECT_OPTS);
        });
        return { conn, socket };
    }
    it('writes Parse+Bind+Execute+Sync concatenated when params are provided', async () => {
        const { conn, socket } = createMockedConnection();
        const queryPromise = conn.query('SELECT $1::text AS name', ['Alice']);
        // The write should have been called synchronously with one buffer
        assert.equal(socket.write.mock.calls.length, 1);
        const written = socket.write.mock.calls[0].arguments[0];
        // Verify the concatenated buffer starts with 'P', then 'B', then 'E', then 'S'
        // using length-based positioning (NOT byte-search, since query text may contain
        // bytes matching message type bytes like 0x45 'E')
        assert.equal(written[0], 0x50, 'First message type is Parse (P)');
        // Parse message: type(1) + length(UInt32BE at offset 1)
        const parseLen = written.readUInt32BE(1);
        const bindStart = 1 + parseLen;
        assert.equal(written[bindStart], 0x42, 'Bind (B) follows Parse');
        // Bind message
        const bindLen = written.readUInt32BE(bindStart + 1);
        const execStart = bindStart + 1 + bindLen;
        assert.equal(written[execStart], 0x45, 'Execute (E) follows Bind');
        // Execute message
        const execLen = written.readUInt32BE(execStart + 1);
        const syncStart = execStart + 1 + execLen;
        assert.equal(written[syncStart], 0x53, 'Sync (S) follows Execute');
        // Sync message: type(1) + length(4), total 5 bytes
        const syncLen = written.readUInt32BE(syncStart + 1);
        assert.equal(syncLen, 4, 'Sync message length is 4 (no body)');
        assert.equal(written.length, syncStart + 1 + syncLen, 'Written buffer ends at Sync boundary');
        // Parse message should contain the query
        const nullAt = written.indexOf(0, 6);
        const queryText = written.toString('utf8', 6, nullAt);
        assert.equal(queryText, 'SELECT $1::text AS name');
        // Bind message should contain the parameter 'Alice'
        const bindMsg = written.subarray(bindStart);
        const bindHeaderLen = 1 + 4 + 1 + 1 + 2 + 2; // B + len + portal_null + stmt_null + fmt + count
        const aliceLen = bindMsg.readInt32BE(bindHeaderLen);
        const aliceVal = bindMsg.toString('utf8', bindHeaderLen + 4, bindHeaderLen + 4 + aliceLen);
        assert.equal(aliceVal, 'Alice');
        // Respond with mock server messages to complete the query
        const response = serverResponse([
            { type: 0x31, body: parseComplete() }, // ParseComplete
            { type: 0x32, body: bindComplete() }, // BindComplete
            { type: 0x43, body: commandComplete('SELECT 1') }, // CommandComplete
            { type: 0x5a, body: readyForQuery(0x49) }, // ReadyForQuery (I=idle)
        ]);
        socket.emit('data', response);
        const result = await queryPromise;
        assert.equal(result.command, 'SELECT 1', `commandComplete tag mismatch, got: ${result.command}`);
        assert.equal(result.rows.length, 0); // no DataRow in our mock response
    });
    it('handles DataRow results via extended query', async () => {
        const { conn, socket } = createMockedConnection();
        const queryPromise = conn.query('SELECT $1::int AS n', [99]);
        const written = socket.write.mock.calls[0].arguments[0];
        assert.ok(written[0] === 0x50);
        // Build RowDescription for one column 'n' (typeoid INT4 = 23)
        // Field format: count(uint16) + for each field: name(null-term) + tableOid(int32)
        // + attNum(int16) + typeOid(int32) + typeSize(int16) + typeMod(int32) + format(int16)
        const rdBody = Buffer.alloc(2);
        rdBody.writeUInt16BE(1); // 1 column
        const nameBuf = Buffer.from('n\0', 'utf8');
        const fieldInfo = Buffer.alloc(18);
        fieldInfo.writeUInt32BE(0, 0); // tableOid = 0
        fieldInfo.writeUInt16BE(0, 4); // attNum = 0
        fieldInfo.writeUInt32BE(23, 6); // typeOid = 23 (int4)
        fieldInfo.writeUInt16BE(4, 10); // typeSize = 4
        fieldInfo.writeInt32BE(-1, 12); // typeMod = -1
        fieldInfo.writeUInt16BE(0, 16); // format = 0 (text)
        const rowDescFull = Buffer.concat([rdBody, nameBuf, fieldInfo]);
        // Build a DataRow with one column = '99'
        const dataRowBody = Buffer.alloc(2 + 4 + 2); // colCount(2) + col1len(4) + col1val(2)
        dataRowBody.writeUInt16BE(1, 0); // 1 column
        dataRowBody.writeInt32BE(2, 2); // length = 2
        dataRowBody.write('99', 6, 'utf8'); // value
        const response = serverResponse([
            { type: 0x31, body: parseComplete() },
            { type: 0x32, body: bindComplete() },
            { type: 0x54, body: rowDescFull }, // RowDescription
            { type: 0x44, body: dataRowBody }, // DataRow
            { type: 0x43, body: commandComplete('SELECT 1') },
            { type: 0x5a, body: readyForQuery(0x49) },
        ]);
        socket.emit('data', response);
        const result = await queryPromise;
        assert.equal(result.rows.length, 1);
        assert.equal(result.rows[0]?.['n'], '99');
    });
    it('falls back to simple query protocol when params is empty', async () => {
        const { conn, socket } = createMockedConnection();
        // Calling query() without params should use simple query ('Q'), not extended
        const queryPromise = conn.query('SELECT 1 AS val');
        assert.equal(socket.write.mock.calls.length, 1);
        const written = socket.write.mock.calls[0].arguments[0];
        // Simple query message starts with 'Q' (0x51)
        assert.equal(written[0], 0x51, 'Should use simple query protocol');
        assert.notEqual(written[0], 0x50, 'Should NOT use Parse message');
        // Respond with mock response
        const dataRowBody = Buffer.alloc(2 + 4 + 1); // colCount(2) + len(4) + '1'
        dataRowBody.writeUInt16BE(1, 0);
        dataRowBody.writeInt32BE(1, 2);
        dataRowBody[6] = 0x31; // '1'
        const rowDescBody = Buffer.alloc(2 + 4 + 18); // count + "val\0" + fieldInfo
        rowDescBody.writeUInt16BE(1, 0);
        Buffer.from('val\0', 'utf8').copy(rowDescBody, 2);
        const fiOffset = 2 + 4;
        rowDescBody.writeUInt32BE(0, fiOffset);
        rowDescBody.writeUInt16BE(0, fiOffset + 4);
        rowDescBody.writeUInt32BE(25, fiOffset + 6); // text type (25)
        rowDescBody.writeInt16BE(-1, fiOffset + 10); // typeSize = -1 (variable length, signed)
        rowDescBody.writeInt32BE(-1, fiOffset + 12);
        rowDescBody.writeUInt16BE(0, fiOffset + 16);
        // Build response using serverResponse() helper (which wraps bodies with type+len)
        const response = serverResponse([
            { type: 0x54, body: rowDescBody }, // RowDescription
            { type: 0x44, body: dataRowBody }, // DataRow
            { type: 0x43, body: commandComplete('SELECT 1') }, // CommandComplete
            { type: 0x5a, body: readyForQuery(0x49) }, // ReadyForQuery
        ]);
        socket.emit('data', response);
        const result = await queryPromise;
        assert.equal(result.rows[0]?.['val'], '1');
    });
    it('rejects when connection is not ready', async () => {
        const conn = new PgConnection();
        // State is 'connecting' by default — query should reject
        await assert.rejects(() => conn.query('SELECT $1', ['test']), /Cannot query: connection is in state "connecting"/);
    });
});
//# sourceMappingURL=wire-protocol.test.js.map
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


import {
  buildParseMessage,
  buildBindMessage,
  buildExecuteMessage,
  buildSyncMessage,
  buildSASLInitialResponse,
  buildSASLResponse,
  parseSASLMechanisms,
  parseScramParams,
  xorBuffers,
  validateSASLprep,
  PgConnection,
} from '../src/database/wire.js';
import { pbkdf2Sync, createHmac } from 'node:crypto';

// ─── Helpers ───────────────────────────────────────────────────────────────────

/** Build a complete PG server response from an array of {type, body} parts */
function serverResponse(msgs: { type: number; body: Buffer }[]): Buffer {
  const parts: Buffer[] = [];
  for (const m of msgs) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(4 + m.body.length); // length includes itself
    parts.push(Buffer.from([m.type]), len, m.body);
  }
  return Buffer.concat(parts);
}

// NOTE: serverResponse() wraps each body with a type byte and length prefix.
// These helpers return ONLY the body content (without length prefix).

function parseComplete(): Buffer {
  return Buffer.alloc(0); // no body
}
function bindComplete(): Buffer {
  return Buffer.alloc(0); // no body
}
function commandComplete(tag: string): Buffer {
  // Body is just the null-terminated command tag
  return Buffer.from(tag + '\0', 'utf8');
}
function readyForQuery(status: number): Buffer {
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

  it('encodes a Date as ISO-8601 UTC (never a locale/timezone string)', () => {
    // Regression: a Date fell through to String(date) → "... GMT+0300 (…)",
    // which PostgreSQL rejects binding a timestamptz on any non-UTC host.
    const d = new Date('2026-07-12T08:25:22.698Z');
    const buf = buildBindMessage([d]);
    const paramLen = buf.readInt32BE(11);
    const paramVal = buf.toString('utf8', 15, 15 + paramLen);
    assert.equal(paramVal, '2026-07-12T08:25:22.698Z');
    assert.doesNotMatch(paramVal, /GMT|\(/); // no locale/offset tokens
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
// flow without a real database: Parse → Describe → Bind → Execute → Sync
// messages are written atomically, and the connection correctly handles the
// server response cycle.

/** Flush pending micro/macrotasks so deferred socket writes have executed before
 *  we assert on them. query() awaits the command gate (_acquire) before writing,
 *  so the socket write happens on a later tick rather than synchronously. */
const flushAsync = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe('_queryParams integration (via PgConnection.query)', () => {
  /** Helper: create a PgConnection wired to a mock socket */
  function createMockedConnection(): {
    conn: PgConnection;
    socket: EventEmitter & { write: ReturnType<typeof mock.fn>; destroy: () => void };
  } {
    const socket = new EventEmitter() as EventEmitter & {
      write: ReturnType<typeof mock.fn>;
      destroy: () => void;
      setKeepAlive: () => void;
      setNoDelay: () => void;
    };

    socket.setKeepAlive = () => {};
    socket.setNoDelay = () => {};
    socket.destroy = () => {};
    socket.write = mock.fn(() => true);

    const conn = new PgConnection();
    (conn as any).socket = socket;
    (conn as any).state = 'ready';

    // Register the data handler that _connect() normally sets up
    socket.on('data', (chunk: Buffer) => {
      (conn as any).buffer = Buffer.concat([(conn as any).buffer, chunk]);
      (conn as any)._processBuffer(MOCK_CONNECT_OPTS);
    });

    return { conn, socket };
  }

  it('writes Parse+Describe+Bind+Execute+Sync concatenated when params are provided', async () => {
    const { conn, socket } = createMockedConnection();

    const queryPromise = conn.query('SELECT $1::text AS name', ['Alice']);

    // query() awaits the command gate (_acquire) before writing, so the write
    // happens on a later tick — flush pending tasks before asserting.
    await flushAsync();
    assert.equal(socket.write.mock.calls.length, 1);
    const written = socket.write.mock.calls[0].arguments[0] as Buffer;

    // Verify the concatenated buffer starts with 'P', then 'D', then 'B', then 'E', then 'S'
    // using length-based positioning (NOT byte-search, since query text may contain
    // bytes matching message type bytes like 0x45 'E')
    assert.equal(written[0], 0x50, 'First message type is Parse (P)');

    // Parse message: type(1) + length(UInt32BE at offset 1)
    const parseLen = written.readUInt32BE(1);
    const describeStart = 1 + parseLen;
    assert.equal(written[describeStart], 0x44, 'Describe (D) follows Parse');

    // Describe message: type(1) + length(4), body = 'S' + '\0' = 7 bytes total
    const describeLen = written.readUInt32BE(describeStart + 1);
    assert.equal(describeLen, 6, 'Describe message length is 6');
    assert.equal(written[describeStart + 1 + 4], 0x53, 'Describe context is Statement (S)');
    assert.equal(written[describeStart + 1 + 4 + 1], 0, 'Describe name is null');
    const bindStart = describeStart + 1 + describeLen;
    assert.equal(written[bindStart], 0x42, 'Bind (B) follows Describe');

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
    // Extended protocol response order: ParseComplete → ParameterDescription → RowDescription → BindComplete → CommandComplete → ReadyForQuery
    // ParameterDescription body: numParams(Int16BE) + paramType OIDs (Int32BE × n) — 2 bytes for 0 params
    const paramDescBody = Buffer.alloc(2);
    paramDescBody.writeUInt16BE(0, 0); // 0 parameters described
    // RowDescription body: fieldCount(Int16BE) — 2 bytes with 0 fields (no column metadata needed)
    const rowDescBody = Buffer.alloc(2);
    rowDescBody.writeUInt16BE(0, 0); // 0 columns
    const response = serverResponse([
      { type: 0x31, body: parseComplete() },         // ParseComplete (from Parse)
      { type: 0x74, body: paramDescBody },           // ParameterDescription (from Describe)
      { type: 0x54, body: rowDescBody },             // RowDescription (from Describe)
      { type: 0x32, body: bindComplete() },          // BindComplete
      { type: 0x43, body: commandComplete('SELECT 1') }, // CommandComplete
      { type: 0x5a, body: readyForQuery(0x49) },    // ReadyForQuery (I=idle)
    ]);
    socket.emit('data', response);

    const result = await queryPromise;
    assert.equal(result.command, 'SELECT 1', `commandComplete tag mismatch, got: ${result.command}`);
    assert.equal(result.rows.length, 0); // no DataRow in our mock response
  });

  it('handles DataRow results via extended query', async () => {
    const { conn, socket } = createMockedConnection();

    const queryPromise = conn.query('SELECT $1::int AS n', [99]);

    await flushAsync();
    const written = socket.write.mock.calls[0].arguments[0] as Buffer;
    assert.ok(written[0] === 0x50);

    // Build RowDescription for one column 'n' (typeoid INT4 = 23)
    // Field format: count(uint16) + for each field: name(null-term) + tableOid(int32)
    // + attNum(int16) + typeOid(int32) + typeSize(int16) + typeMod(int32) + format(int16)
    const rdBody = Buffer.alloc(2);
    rdBody.writeUInt16BE(1); // 1 column
    const nameBuf = Buffer.from('n\0', 'utf8');
    const fieldInfo = Buffer.alloc(18);
    fieldInfo.writeUInt32BE(0, 0);  // tableOid = 0
    fieldInfo.writeUInt16BE(0, 4);  // attNum = 0
    fieldInfo.writeUInt32BE(23, 6); // typeOid = 23 (int4)
    fieldInfo.writeUInt16BE(4, 10); // typeSize = 4
    fieldInfo.writeInt32BE(-1, 12); // typeMod = -1
    fieldInfo.writeUInt16BE(0, 16); // format = 0 (text)
    const rowDescFull = Buffer.concat([rdBody, nameBuf, fieldInfo]);

    // Build a DataRow with one column = '99'
    const dataRowBody = Buffer.alloc(2 + 4 + 2); // colCount(2) + col1len(4) + col1val(2)
    dataRowBody.writeUInt16BE(1, 0); // 1 column
    dataRowBody.writeInt32BE(2, 2);  // length = 2
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

    await flushAsync();
    assert.equal(socket.write.mock.calls.length, 1);
    const written = socket.write.mock.calls[0].arguments[0] as Buffer;

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
    rowDescBody.writeInt16BE(-1, fiOffset + 10);  // typeSize = -1 (variable length, signed)
    rowDescBody.writeInt32BE(-1, fiOffset + 12);
    rowDescBody.writeUInt16BE(0, fiOffset + 16);

    // Build response using serverResponse() helper (which wraps bodies with type+len)
    const response = serverResponse([
      { type: 0x54, body: rowDescBody },                     // RowDescription
      { type: 0x44, body: dataRowBody },                     // DataRow
      { type: 0x43, body: commandComplete('SELECT 1') },     // CommandComplete
      { type: 0x5a, body: readyForQuery(0x49) },             // ReadyForQuery
    ]);
    socket.emit('data', response);

    const result = await queryPromise;
    assert.equal(result.rows[0]?.['val'], '1');
  });

  it('rejects when connection is not ready', async () => {
    const conn = new PgConnection();
    // State is 'connecting' by default — query should reject

    await assert.rejects(
      () => conn.query('SELECT $1', ['test']),
      /Cannot query: connection is in state "connecting"/,
    );
  });
});

// ─── Suite 6: buildSASLInitialResponse ────────────────────────────────────────

describe('buildSASLInitialResponse', () => {
  it('has type byte 0x70 (p)', () => {
    const buf = buildSASLInitialResponse('SCRAM-SHA-256', 'n,,n=user,r=abc');
    assert.equal(buf[0], 0x70);
  });

  it('encodes the mechanism as a null-terminated string', () => {
    const buf = buildSASLInitialResponse('SCRAM-SHA-256', 'n,,n=user,r=abc');
    // After type(1) + length(4) = offset 5
    const nullAt = buf.indexOf(0, 5);
    const mechanism = buf.toString('utf8', 5, nullAt);
    assert.equal(mechanism, 'SCRAM-SHA-256');
  });

  it('encodes the client-first-message length as Int32BE before the data', () => {
    const msg = 'n,,n=user,r=abc123';
    const buf = buildSASLInitialResponse('SCRAM-SHA-256', msg);
    // After type(1) + len(4) + mechanism + null(1) = offset varies
    const mechEnd = buf.indexOf(0, 5); // null at end of mechanism
    const dataLenOffset = mechEnd + 1;
    const dataLen = buf.readInt32BE(dataLenOffset);
    assert.equal(dataLen, Buffer.from(msg, 'utf8').length);
  });

  it('places the client-first-message bytes after the length prefix', () => {
    const msg = 'n,,n=user,r=myrandomnonce';
    const buf = buildSASLInitialResponse('SCRAM-SHA-256', msg);
    const mechEnd = buf.indexOf(0, 5);
    const dataLenOffset = mechEnd + 1;
    const dataLen = buf.readInt32BE(dataLenOffset);
    const dataStart = dataLenOffset + 4;
    const extracted = buf.toString('utf8', dataStart, dataStart + dataLen);
    assert.equal(extracted, msg);
  });

  it('computes correct total message length', () => {
    const mechanism = 'SCRAM-SHA-256';
    const msg = 'n,,n=user,r=abc';
    const buf = buildSASLInitialResponse(mechanism, msg);
    const msgLen = buf.readUInt32BE(1);
    // total wire bytes = 1 (type) + length field
    assert.equal(buf.length, 1 + msgLen);
  });

  it('round-trips a realistic client-first-message with gs2-header', () => {
    const mechanism = 'SCRAM-SHA-256';
    const gs2Header = 'n,,';
    const cNonce = '9mM4WxLq7RtBp2KjHvY3Zw';
    const clientFirstMessageBare = `n=testuser,r=${cNonce}`;
    const clientFirstMessage = gs2Header + clientFirstMessageBare;

    const buf = buildSASLInitialResponse(mechanism, clientFirstMessage);

    // Decode mechanism
    const mechEnd = buf.indexOf(0, 5);
    const decodedMech = buf.toString('utf8', 5, mechEnd);
    assert.equal(decodedMech, mechanism);

    // Decode data
    const dataLenOffset = mechEnd + 1;
    const dataLen = buf.readInt32BE(dataLenOffset);
    const dataStart = dataLenOffset + 4;
    const decodedMsg = buf.toString('utf8', dataStart, dataStart + dataLen);
    assert.equal(decodedMsg, clientFirstMessage);

    // Verify gs2-header is present
    assert.ok(decodedMsg.startsWith('n,,'));
    assert.ok(decodedMsg.includes('r=' + cNonce));
  });
});

// ─── Suite 7: buildSASLResponse ───────────────────────────────────────────────

describe('buildSASLResponse', () => {
  it('has type byte 0x70 (p)', () => {
    const buf = buildSASLResponse('c=biws,r=abc,p=proof');
    assert.equal(buf[0], 0x70);
  });

  it('contains only raw bytes with no extra Int32 length prefix', () => {
    const msg = 'c=biws,r=abc,p=proof';
    const buf = buildSASLResponse(msg);
    // Per PG protocol: SASLResponse body is raw bytes, no extra framing
    // After type(1) + length(4) = offset 5, the raw bytes should start directly
    const bodyStart = 5;
    const extracted = buf.toString('utf8', bodyStart, buf.length);
    assert.equal(extracted, msg);
  });

  it('computes correct total message length (type + len + raw bytes)', () => {
    const msg = 'c=biws,r=abc,p=proof';
    const buf = buildSASLResponse(msg);
    const msgLen = buf.readUInt32BE(1);
    const expectedLen = 4 + Buffer.from(msg, 'utf8').length;
    assert.equal(msgLen, expectedLen);
    assert.equal(buf.length, 1 + msgLen, `expected ${1 + msgLen} but got ${buf.length}`);
  });

  it('handles a realistic client-final-message with proof', () => {
    const clientFinalMessageWithoutProof = 'c=biws,r=9mM4WxLq7RtBp2KjHvY3Zw+serverNonce';
    const proof = 'dHxY7jK9mQpZ2LvN4RtBw6FgC3VsX8JkMnP0Ab';
    const clientFinalMessage = `${clientFinalMessageWithoutProof},p=${proof}`;

    const buf = buildSASLResponse(clientFinalMessage);
    const decoded = buf.toString('utf8', 5, buf.length);
    assert.equal(decoded, clientFinalMessage);
    assert.ok(decoded.includes('c=biws'));
    assert.ok(decoded.includes('p=' + proof));
  });

  it('encodes an empty string correctly', () => {
    const buf = buildSASLResponse('');
    const msgLen = buf.readUInt32BE(1);
    assert.equal(msgLen, 4); // just self, no body
    assert.equal(buf.length, 5); // type(1) + length(4) = 5
  });
});

// ─── Suite 8: parseSASLMechanisms ─────────────────────────────────────────────

describe('parseSASLMechanisms', () => {
  it('parses a single null-terminated mechanism', () => {
    const buf = Buffer.from('SCRAM-SHA-256\0', 'utf8');
    const mechanisms = parseSASLMechanisms(buf);
    assert.deepEqual(mechanisms, ['SCRAM-SHA-256']);
  });

  it('parses multiple null-terminated mechanisms', () => {
    const buf = Buffer.from('SCRAM-SHA-256\0SCRAM-SHA-1\0SCRAM-SHA-224\0', 'utf8');
    const mechanisms = parseSASLMechanisms(buf);
    assert.deepEqual(mechanisms, ['SCRAM-SHA-256', 'SCRAM-SHA-1', 'SCRAM-SHA-224']);
  });

  it('stops at empty string (double null)', () => {
    const buf = Buffer.from('SCRAM-SHA-256\0\0', 'utf8');
    const mechanisms = parseSASLMechanisms(buf);
    assert.deepEqual(mechanisms, ['SCRAM-SHA-256']);
  });

  it('returns empty array for empty input', () => {
    const buf = Buffer.alloc(0);
    const mechanisms = parseSASLMechanisms(buf);
    assert.deepEqual(mechanisms, []);
  });

  it('stops at empty string vs trailing non-null bytes', () => {
    // After list ends with double null, there may be trailing bytes
    const buf = Buffer.from('SCRAM-SHA-256\0\0extra', 'utf8');
    const mechanisms = parseSASLMechanisms(buf);
    assert.deepEqual(mechanisms, ['SCRAM-SHA-256']);
  });

  it('handles mechanism with no trailing null', () => {
    const buf = Buffer.from('SCRAM-SHA-256', 'utf8');
    // offset < length but no null found → loop exits
    const mechanisms = parseSASLMechanisms(buf);
    assert.deepEqual(mechanisms, ['SCRAM-SHA-256']);
  });
});

// ─── Suite 9: parseScramParams ────────────────────────────────────────────────

describe('parseScramParams', () => {
  it('parses r, s, i from a server-first-message', () => {
    const msg = 'r=abc123,s=ZGVm,s=ZGVm,i=4096';
    const params = parseScramParams(msg);
    assert.equal(params['r'], 'abc123');
    assert.equal(params['s'], 'ZGVm');
    assert.equal(params['i'], '4096');
  });

  it('ignores parts without = separator', () => {
    const msg = 'r=abc,justtext,i=4096';
    const params = parseScramParams(msg);
    assert.equal(params['r'], 'abc');
    assert.equal(params['i'], '4096');
    // 'justtext' has no '=' so it's skipped
    assert.equal(Object.keys(params).length, 2);
  });

  it('handles empty string', () => {
    const params = parseScramParams('');
    assert.deepEqual(params, {});
  });

  it('handles value with = character (base64 padding)', () => {
    // base64 sometimes contains = padding
    const msg = 'r=abc,s=dGVzdA==,i=4096';
    const params = parseScramParams(msg);
    assert.equal(params['r'], 'abc');
    assert.equal(params['s'], 'dGVzdA==');
    assert.equal(params['i'], '4096');
  });

  it('handles server-final-message with verifier and error', () => {
    const msg = 'v=6rYTRSdXpPvH/2N+jqGz6w==,e=invalid-encoding';
    const params = parseScramParams(msg);
    assert.equal(params['v'], '6rYTRSdXpPvH/2N+jqGz6w==');
    assert.equal(params['e'], 'invalid-encoding');
  });
});

// ─── Suite 10: xorBuffers ─────────────────────────────────────────────────────

describe('xorBuffers', () => {
  it('XORs two equal-length buffers bytewise', () => {
    const a = Buffer.from([0x0f, 0xff, 0xaa]);
    const b = Buffer.from([0xf0, 0x00, 0x55]);
    const result = xorBuffers(a, b);
    assert.equal(result.length, 3);
    // 0x0f ^ 0xf0 = 0xff; 0xff ^ 0x00 = 0xff; 0xaa ^ 0x55 = 0xff
    assert.equal(result[0], 0xff);
    assert.equal(result[1], 0xff);
    assert.equal(result[2], 0xff);
  });

  it('returns XOR of different-length buffers (min length)', () => {
    const a = Buffer.from([0x0f, 0xff, 0xaa, 0x11]);
    const b = Buffer.from([0xf0, 0x00]); // shorter
    const result = xorBuffers(a, b);
    assert.equal(result.length, 2);
    assert.equal(result[0], 0xff);
    assert.equal(result[1], 0xff);
  });

  it('self-XOR yields zero', () => {
    const a = Buffer.from([0x12, 0x34, 0x56, 0x78]);
    const result = xorBuffers(a, a);
    assert.equal(result.length, 4);
    for (let i = 0; i < 4; i++) {
      assert.equal(result[i], 0);
    }
  });

  it('XOR with zero buffer is identity', () => {
    const a = Buffer.from([0x12, 0x34, 0x56]);
    const zero = Buffer.alloc(3);
    const result = xorBuffers(a, zero);
    assert.deepEqual(result, a);
  });

  it('handles empty buffers', () => {
    const result = xorBuffers(Buffer.alloc(0), Buffer.alloc(0));
    assert.equal(result.length, 0);
  });

  it('XOR property: (A XOR B) XOR B = A', () => {
    const a = Buffer.from([0xde, 0xad, 0xbe, 0xef]);
    const b = Buffer.from([0x12, 0x34, 0x56, 0x78]);
    const xor1 = xorBuffers(a, b);
    const xor2 = xorBuffers(xor1, b);
    assert.deepEqual(xor2, a);
  });
});

// ─── Suite 11: SCRAM nonce validation via mock auth state machine ─────────────
//
// Wires a mock socket into PgConnection and simulates the SASL authentication
// flow (AuthSASL → SASLContinue → SASLFinal → AuthOk → ReadyForQuery) to
// verify nonce prefix validation and overall SCRAM message exchange.

describe('SCRAM auth nonce validation', () => {
  /** Create a PgConnection that skips TCP connection and goes straight to auth */
  function createAuthConnection() {
    const socket = new EventEmitter() as EventEmitter & {
      write: ReturnType<typeof mock.fn>;
      destroy: () => void;
      setKeepAlive: () => void;
      setNoDelay: () => void;
    };
    socket.setKeepAlive = () => {};
    socket.setNoDelay = () => {};
    socket.destroy = () => {};
    socket.write = mock.fn(() => true);

    const conn = new PgConnection();
    (conn as any).socket = socket;
    (conn as any).state = 'authenticating';

    // Register the data handler like _connect() does
    socket.on('data', (chunk: Buffer) => {
      (conn as any).buffer = Buffer.concat([(conn as any).buffer, chunk]);
      (conn as any)._processBuffer(MOCK_CONNECT_OPTS);
    });

    return { conn, socket };
  }

  /** Helper: build a mock SASL mechanisms response body (AuthRequest type=10) */
  function buildSASLStartupBody(mechanisms: string[]): Buffer {
    const typeBuf = Buffer.alloc(4);
    typeBuf.writeUInt32BE(10); // SASL auth type
    const mechBuf = Buffer.from(mechanisms.map(m => m + '\0').join('') + '\0', 'utf8');
    return Buffer.concat([typeBuf, mechBuf]);
  }

  /** Helper: build a mock SASLContinue body (AuthRequest type=11) with custom nonce */
  function buildSASLContinueBody(nonce: string, salt: string, iterations: number): Buffer {
    const typeBuf = Buffer.alloc(4);
    typeBuf.writeUInt32BE(11); // SASL continue
    const msgBuf = Buffer.from(`r=${nonce},s=${salt},i=${iterations}`, 'utf8');
    return Buffer.concat([typeBuf, msgBuf]);
  }

  /**
   * Helper: wrap a body as a complete PostgreSQL backend message (type + length + body).
   * Returns the full message buffer ready to emit as socket data.
   */
  function wrapAuthMessage(type: number, body: Buffer): Buffer {
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(4 + body.length);
    return Buffer.concat([Buffer.from([type]), lenBuf, body]);
  }

  it('writes correct SASLInitialResponse and SASLResponse messages through the auth state machine', async () => {
    const { socket } = createAuthConnection();

    // Round 1: Send AuthenticationSASL with SCRAM-SHA-256
    const saslBody = buildSASLStartupBody(['SCRAM-SHA-256']);
    socket.emit('data', wrapAuthMessage(0x52, saslBody));

    // Connection should have written SASLInitialResponse
    assert.equal(socket.write.mock.calls.length, 1);
    const written1 = socket.write.mock.calls[0].arguments[0] as Buffer;
    assert.equal(written1[0], 0x70, 'First write is SASLInitialResponse');

    // Validate SASLInitialResponse structure
    const mechEnd = written1.indexOf(0, 5);
    const mechanism = written1.toString('utf8', 5, mechEnd);
    assert.equal(mechanism, 'SCRAM-SHA-256', 'Mechanism is SCRAM-SHA-256');

    const dataLenOffset = mechEnd + 1;
    const dataLen = written1.readInt32BE(dataLenOffset);
    const dataStart = dataLenOffset + 4;
    const clientFirstMessage = written1.toString('utf8', dataStart, dataStart + dataLen);
    // Format: n,,n=user,r=<nonce>
    assert.ok(clientFirstMessage.startsWith('n,,'), 'gs2-header present');
    assert.ok(clientFirstMessage.includes('n=test,'), 'username present');
    assert.ok(clientFirstMessage.includes('r='), 'nonce present');

    // Extract the client nonce
    const rMatch = clientFirstMessage.match(/r=([^,]+)/);
    assert.ok(rMatch, 'Client nonce found');
    const clientNonce = rMatch![1]!;

    // Round 2: Send SASLContinue with a valid nonce (client nonce + server suffix)
    const salt = 'c2FsdHlzYWx0';
    const iterations = 4096;
    const serverNonce = clientNonce + 'serverappend';
    const saslContinueBody = buildSASLContinueBody(serverNonce, salt, iterations);
    socket.emit('data', wrapAuthMessage(0x52, saslContinueBody));

    // Connection should have written SASLResponse
    assert.equal(socket.write.mock.calls.length, 2);
    const written2 = socket.write.mock.calls[1].arguments[0] as Buffer;
    assert.equal(written2[0], 0x70, 'Second write is SASLResponse');

    // Validate SASLResponse structure
    const saslResponseBody = written2.toString('utf8', 5, written2.length);
    assert.ok(saslResponseBody.includes('c=biws'), 'SASL response includes c=biws (base64 of gs2-header)');
    assert.ok(saslResponseBody.includes(`r=${serverNonce}`), 'SASL response includes combined nonce');
    assert.ok(saslResponseBody.includes(',p='), 'SASL response includes proof');

    // Verify the client nonce in the response starts with the original client nonce
    const respNonceMatch = saslResponseBody.match(/r=([^,]+)/);
    assert.ok(respNonceMatch, 'Nonce found in SASL response');
    assert.ok(respNonceMatch![1]!.startsWith(clientNonce),
      'Response nonce starts with client nonce');

    // Verify the SASLResponse does NOT have an extra Int32 length prefix before data
    // The raw body (after type+len) should directly contain the text
    const rawSaslLen = written2.readUInt32BE(1);
    const expectedBodyLen = Buffer.from(saslResponseBody, 'utf8').length;
    assert.equal(rawSaslLen, 4 + expectedBodyLen,
      'SASLResponse body is raw bytes (no extra framing)');
  });

  it('rejects authentication when server nonce does not start with client nonce', async () => {
    const { conn, socket } = createAuthConnection();

    // First round: send SASL auth request
    const saslBody = buildSASLStartupBody(['SCRAM-SHA-256']);
    socket.emit('data', wrapAuthMessage(0x52, saslBody));

    assert.equal(socket.write.mock.calls.length, 1);
    const written1 = socket.write.mock.calls[0].arguments[0] as Buffer;

    // Extract client nonce
    const mechEnd = written1.indexOf(0, 5);
    const dataLenOffset = mechEnd + 1;
    const dataLen = written1.readInt32BE(dataLenOffset);
    const dataStart = dataLenOffset + 4;
    const clientFirstMessage = written1.toString('utf8', dataStart, dataStart + dataLen);
    const rMatch = clientFirstMessage.match(/r=([^,]+)/);
    assert.ok(rMatch);

    // Send SASLContinue with a DIFFERENT nonce (doesn't start with client nonce)
    const salt = 'c2FsdHlzYWx0';
    const iterations = 4096;
    // Completely different nonce — NOT starting with client nonce
    const differentNonce = 'attackercontrollednonce';
    const saslContinueBody = buildSASLContinueBody(differentNonce, salt, iterations);

    // Emit the SASLContinue with bad nonce
    socket.emit('data', wrapAuthMessage(0x52, saslContinueBody));

    // Should NOT have written SASLResponse (only 1 write from the first round)
    assert.equal(socket.write.mock.calls.length, 1,
      'No SASLResponse written when nonce validation fails');

    // Connection should NOT be ready
    assert.equal(conn.isReady, false, 'Connection not ready after failed nonce validation');
  });

  it('completes full 3-round SASL-SHA-256 handshake including server signature verification', async () => {
    const { conn, socket } = createAuthConnection();

    // ── Round 1: AuthSASL → SASLInitialResponse ──
    const saslBody = buildSASLStartupBody(['SCRAM-SHA-256']);
    socket.emit('data', wrapAuthMessage(0x52, saslBody));
    assert.equal(socket.write.mock.calls.length, 1);
    const written1 = socket.write.mock.calls[0].arguments[0] as Buffer;
    assert.equal(written1[0], 0x70, 'SASLInitialResponse written');

    // Extract client nonce from client-first-message
    const mechEnd = written1.indexOf(0, 5);
    const dataLenOffset = mechEnd + 1;
    const dataLen = written1.readInt32BE(dataLenOffset);
    const dataStart = dataLenOffset + 4;
    const clientFirstMessage = written1.toString('utf8', dataStart, dataStart + dataLen);
    const rMatch = clientFirstMessage.match(/r=([^,]+)/);
    assert.ok(rMatch, 'Client nonce found in SASLInitialResponse');
    const clientNonce = rMatch![1]!;
    const clientFirstMessageBare = `n=test,r=${clientNonce}`;

    // ── Round 2: SASLContinue → compute proof → SASLResponse ──
    const password = 'test';
    const saltB64 = 'c2FsdHlzYWx0'; // 'saltsalt' in base64
    const iterations = 4096;
    const serverNonceAppend = 'serverdata';
    const combinedNonce = clientNonce + serverNonceAppend;
    const serverFirstMessage = `r=${combinedNonce},s=${saltB64},i=${iterations}`;

    socket.emit('data', wrapAuthMessage(0x52, buildSASLContinueBody(combinedNonce, saltB64, iterations)));
    assert.equal(socket.write.mock.calls.length, 2, 'SASLResponse written');
    const written2 = socket.write.mock.calls[1].arguments[0] as Buffer;
    assert.equal(written2[0], 0x70, 'SASLResponse type byte');

    // Parse the SASLResponse to verify structure
    const saslResponseBody = written2.toString('utf8', 5, written2.length);
    const respNonceMatch = saslResponseBody.match(/r=([^,]+)/);
    assert.ok(respNonceMatch, 'Nonce in SASLResponse');
    assert.equal(respNonceMatch![1], combinedNonce, 'Combined nonce echoed back');
    assert.ok(saslResponseBody.includes('c=biws'), 'c=biws present');
    assert.ok(saslResponseBody.includes(',p='), 'proof present');

    // ── Compute expected server signature ──
    // Replicate the SCRAM math that wire.ts does internally
    const salt = Buffer.from(saltB64, 'base64');
    const normalizedPassword = password.normalize('NFKC');
    const saltedPassword = pbkdf2Sync(normalizedPassword, salt, iterations, 32, 'sha256');
    const serverKey = createHmac('sha256', saltedPassword).update('Server Key').digest();
    const clientFinalMessageWithoutProof = `c=biws,r=${combinedNonce}`;
    const authMessage = `${clientFirstMessageBare},${serverFirstMessage},${clientFinalMessageWithoutProof}`;
    const expectedServerSignature = createHmac('sha256', serverKey).update(authMessage).digest('base64');

    // ── Round 3: SASLFinal with correct signature → AuthOk → ReadyForQuery ──
    const saslFinalBody = Buffer.alloc(4);
    saslFinalBody.writeUInt32BE(12); // SASL final type
    const finalMsg = Buffer.from(`v=${expectedServerSignature}`, 'utf8');
    socket.emit('data', wrapAuthMessage(0x52, Buffer.concat([saslFinalBody, finalMsg])));

    // Send AuthenticationOk
    const authOkBody = Buffer.alloc(4);
    authOkBody.writeUInt32BE(0); // AuthType.Ok
    socket.emit('data', wrapAuthMessage(0x52, authOkBody));

    // Send ParameterStatus (optional, ignored but realistic)
    const psName = Buffer.from('server_version\0', 'utf8');
    const psValue = Buffer.from('14.0\0', 'utf8');
    socket.emit('data', wrapAuthMessage(0x53, Buffer.concat([psName, psValue])));

    // Send ReadyForQuery
    const rFQBody = Buffer.from([0x49]); // 'I' idle
    socket.emit('data', wrapAuthMessage(0x5a, rFQBody));

    // Connection should now be ready
    assert.ok(conn.isReady, 'Connection is ready after full SASL handshake');
  });

  it('rejects authentication when server signature is wrong', async () => {
    const { conn, socket } = createAuthConnection();

    // ── Round 1: AuthSASL → SASLInitialResponse ──
    const saslBody = buildSASLStartupBody(['SCRAM-SHA-256']);
    socket.emit('data', wrapAuthMessage(0x52, saslBody));
    assert.equal(socket.write.mock.calls.length, 1);
    const written1 = socket.write.mock.calls[0].arguments[0] as Buffer;
    assert.equal(written1[0], 0x70, 'SASLInitialResponse written');

    // Extract client nonce
    const mechEnd = written1.indexOf(0, 5);
    const dataLenOffset = mechEnd + 1;
    const dataLen = written1.readInt32BE(dataLenOffset);
    const dataStart = dataLenOffset + 4;
    const clientFirstMessage = written1.toString('utf8', dataStart, dataStart + dataLen);
    const rMatch = clientFirstMessage.match(/r=([^,]+)/);
    assert.ok(rMatch!);
    const clientNonce = rMatch![1]!;

    // ── Round 2: SASLContinue → SASLResponse ──
    const saltB64 = 'bXlzYWx0'; // 'mysalt'
    const iterations = 4096;
    const combinedNonce = clientNonce + 'serverdata';
    socket.emit('data', wrapAuthMessage(0x52, buildSASLContinueBody(combinedNonce, saltB64, iterations)));
    assert.equal(socket.write.mock.calls.length, 2, 'SASLResponse written');

    // ── Round 3: SASLFinal with WRONG signature ──
    const wrongSignature = 'aW52YWxpZFNpZ25hdHVyZQ==';
    const saslFinalBody = Buffer.alloc(4);
    saslFinalBody.writeUInt32BE(12);
    const finalMsg = Buffer.from(`v=${wrongSignature}`, 'utf8');
    socket.emit('data', wrapAuthMessage(0x52, Buffer.concat([saslFinalBody, finalMsg])));

    // After SASLFinal with wrong sig, authReject was called and scramState was NOT cleared.
    // State remains 'authenticating'. A real PG server would close the connection or
    // send ErrorResponse here — it would NOT send AuthOk or ReadyForQuery.
    // Connection should NOT be ready (still in 'authenticating' state)
    assert.equal(conn.isReady, false, 'Connection not ready after wrong server signature');
  });
});

// ─── Suite 12: validateSASLprep — Unicode edge cases ──────────────────────────
//
// Tests the SASLprep prohibited-character validator (RFC 4013 §2.3) with
// edge-case Unicode code points from categories C.2.1, C.3, C.4, and C.5.
// Uses JavaScript's built-in UTF-16 awareness via String.codePointAt().

describe('validateSASLprep', () => {
  // ── Valid inputs (should return true) ──

  it('accepts empty string', () => {
    assert.equal(validateSASLprep(''), true);
  });

  it('accepts basic ASCII letters and digits', () => {
    assert.equal(validateSASLprep('password123'), true);
    assert.equal(validateSASLprep('JohnDoe'), true);
    assert.equal(validateSASLprep('a'), true);
  });

  it('accepts common ASCII symbols', () => {
    assert.equal(validateSASLprep('hello_world!'), true);
    assert.equal(validateSASLprep('pass-word@host'), true);
    assert.equal(validateSASLprep('ABC123.-_~'), true);
  });

  it('accepts accented Latin characters (Latin-1 Supplement, C1 Controls range overlap check)', () => {
    // U+00A1 (¡) is NOT in C.2.1 range (7F-9F ends at 9F), should pass
    assert.equal(validateSASLprep('¡Hola!'), true);
    // U+00E9 (é), U+00F1 (ñ) — common accented chars
    assert.equal(validateSASLprep('café'), true);
    assert.equal(validateSASLprep('jalapeño'), true);
    // U+00DF (ß) — eszett
    assert.equal(validateSASLprep('straße'), true);
  });

  it('accepts CJK ideographs and non-Latin scripts', () => {
    assert.equal(validateSASLprep('密码'), true);
    assert.equal(validateSASLprep('パスワード'), true);
    assert.equal(validateSASLprep('비밀번호'), true);
    assert.equal(validateSASLprep('كلمةالسر'), true);
  });

  it('accepts emoji and supplementary plane characters (non-private-use, non-non-character)', () => {
    // U+1F600 — GRINNING FACE emoji
    assert.equal(validateSASLprep('😀'), true);
    // U+1F389 — PARTY POPPER
    assert.equal(validateSASLprep('🎉'), true);
    // Combined with ASCII
    assert.equal(validateSASLprep('hello😀world'), true);
  });

  it('accepts Deseret alphabet and other ancient scripts in supplementary planes', () => {
    // U+10400 — DESERET CAPITAL LETTER LONG I (supplementary plane, valid)
    assert.equal(validateSASLprep('𐐀'), true);
    // U+10330 — GOTHIC LETTER AHSA
    assert.equal(validateSASLprep('𐌰'), true);
  });

  it('accepts soft hyphen and other B.1 mapped-to-nothing characters (not prohibited)', () => {
    // U+00AD — SOFT HYPHEN (B.1 mapped-to-nothing, NOT prohibited)
    assert.equal(validateSASLprep('\u00AD'), true);
    // U+034F — COMBINING GRAPHEME JOINER (B.1)
    assert.equal(validateSASLprep('\u034F'), true);
  });

  it('accepts combining characters (valid per SASLprep)', () => {
    // U+0300 — COMBINING GRAVE ACCENT
    assert.equal(validateSASLprep('a\u0300'), true);
    // Multiple combining marks
    assert.equal(validateSASLprep('e\u0301\u0302'), true);
  });

  it('accepts space characters that are not ASCII controls', () => {
    // U+0020 — SPACE (valid, not a control char)
    assert.equal(validateSASLprep('hello world'), true);
    // U+00A0 — NO-BREAK SPACE (valid, NOT in C.2.1 — 7F-9F ends at 9F)
    assert.equal(validateSASLprep('hello\u00A0world'), true);
  });

  // ── Invalid inputs (should return false) ──

  it('rejects C.2.1 — ASCII control characters (U+0000-U+001F)', () => {
    // Null character
    assert.equal(validateSASLprep('\x00'), false);
    // Tab
    assert.equal(validateSASLprep('\t'), false);
    // Newline
    assert.equal(validateSASLprep('\n'), false);
    // Carriage return
    assert.equal(validateSASLprep('\r'), false);
    // Unit separator (U+001F)
    assert.equal(validateSASLprep('\x1F'), false);
    // Within a string with valid chars
    assert.equal(validateSASLprep('pass\x00word'), false);
    assert.equal(validateSASLprep('pass\nword'), false);
  });

  it('rejects C.2.1 — DEL and C1 control characters (U+007F-U+009F)', () => {
    // DEL (U+007F)
    assert.equal(validateSASLprep('\x7F'), false);
    // Padding character (U+0080)
    assert.equal(validateSASLprep('\x80'), false);
    // Application Program Command (U+009F)
    assert.equal(validateSASLprep('\x9F'), false);
    // Embedded in a valid string
    assert.equal(validateSASLprep('hello\x7Fworld'), false);
  });

  it('rejects C.3 — BMP private use area (U+E000-U+F8FF)', () => {
    // Start of BMP private use
    assert.equal(validateSASLprep('\uE000'), false);
    // End of BMP private use
    assert.equal(validateSASLprep('\uF8FF'), false);
    // Middle of BMP private use
    assert.equal(validateSASLprep('\uF000'), false);
    // Embedded in a valid string
    assert.equal(validateSASLprep('pass\uE000word'), false);
  });

  it('rejects C.3 — supplementary private use areas (Planes 15-16)', () => {
    // Plane 15 private use: U+F0000-U+FFFFD
    assert.equal(validateSASLprep(String.fromCodePoint(0xF0000)), false);
    assert.equal(validateSASLprep(String.fromCodePoint(0xFFFFD)), false);
    // Plane 16 private use: U+100000-U+10FFFD
    assert.equal(validateSASLprep(String.fromCodePoint(0x100000)), false);
    assert.equal(validateSASLprep(String.fromCodePoint(0x10FFFD)), false);
    // Embedded with valid characters
    assert.equal(validateSASLprep('a' + String.fromCodePoint(0xF0000) + 'b'), false);
  });

  it('rejects C.4 — non-character code points (U+FDD0-U+FDEF)', () => {
    // Start of non-character range
    assert.equal(validateSASLprep('\uFDD0'), false);
    // End of non-character range
    assert.equal(validateSASLprep('\uFDEF'), false);
    // Middle of non-character range
    assert.equal(validateSASLprep('\uFDE0'), false);
  });

  it('rejects C.4 — non-character code points ending in FFFE or FFFF', () => {
    // BMP non-characters
    assert.equal(validateSASLprep('\uFFFE'), false);
    assert.equal(validateSASLprep('\uFFFF'), false);
    // Supplementary plane non-characters
    assert.equal(validateSASLprep(String.fromCodePoint(0x1FFFE)), false);
    assert.equal(validateSASLprep(String.fromCodePoint(0x1FFFF)), false);
    assert.equal(validateSASLprep(String.fromCodePoint(0x2FFFE)), false);
    assert.equal(validateSASLprep(String.fromCodePoint(0x2FFFF)), false);
    // Maximum code point non-characters
    assert.equal(validateSASLprep(String.fromCodePoint(0x10FFFE)), false);
    assert.equal(validateSASLprep(String.fromCodePoint(0x10FFFF)), false);
  });

  it('rejects C.5 — surrogate code points (U+D800-U+DFFF)', () => {
    // High surrogates
    assert.equal(validateSASLprep(String.fromCharCode(0xD800)), false);
    assert.equal(validateSASLprep(String.fromCharCode(0xDB7F)), false);
    // Low surrogates
    assert.equal(validateSASLprep(String.fromCharCode(0xDC00)), false);
    assert.equal(validateSASLprep(String.fromCharCode(0xDFFF)), false);
    // Isolated surrogate embedded with valid characters
    assert.equal(validateSASLprep('a' + String.fromCharCode(0xD800) + 'b'), false);
  });

  it('rejects strings with multiple prohibited characters', () => {
    // Control char + private use + non-character
    const mixed = '\x00' + '\uE000' + '\uFFFE';
    assert.equal(validateSASLprep(mixed), false);
    // Private use + surrogate
    const mixed2 = '\uF8FF' + String.fromCharCode(0xD800);
    assert.equal(validateSASLprep(mixed2), false);
  });

  // ── Supplementary code point index increment ──

  it('correctly iterates supplementary characters without off-by-one errors', () => {
    // A string with supplementary char + ASCII should be valid
    // If the index increment logic is wrong, it would read the trailing surrogate
    // as a standalone code point and potentially mis-classify or reject it.
    assert.equal(validateSASLprep('😀x'), true);
    // Multiple supplementary chars
    assert.equal(validateSASLprep('😀🎉'), true);
    // Supplementary char followed by a non-character (boundary test)
    assert.equal(validateSASLprep('😀' + String.fromCodePoint(0x1FFFE)), false);
    // Multiple supplementary chars, then ASCII, then control char
    assert.equal(validateSASLprep('😀🎉xyz' + '\x00'), false);
  });

  it('handles code point exactly at boundaries of each prohibited category', () => {
    // Boundary: one below, at, and above each range boundary

    // C.2.1: ASCII control boundary at U+001F/U+0020
    assert.equal(validateSASLprep(' '), true);      // U+0020 — valid (space)
    assert.equal(validateSASLprep('\x1F'), false);  // U+001F — control char

    // C.2.1: DEL + C1 boundary at U+007F/U+0080
    assert.equal(validateSASLprep('~'), true);       // U+007E — ~ is valid
    assert.equal(validateSASLprep('\x7F'), false);  // U+007F — DEL
    assert.equal(validateSASLprep('\x80'), false);  // U+0080 — C1 control
    assert.equal(validateSASLprep('\u00A0'), true); // U+00A0 — just above C1, valid

    // C.3: BMP private use boundary at U+DFFF/U+E000
    assert.equal(validateSASLprep('\uDFFF'), false); // U+DFFF — surrogate (C.5)
    assert.equal(validateSASLprep('\uE000'), false); // U+E000 — private use start
    assert.equal(validateSASLprep('\uF8FF'), false); // U+F8FF — private use end
    // U+F900 is outside private use (it's CJK compat ideographs)
    assert.equal(validateSASLprep('\uF900'), true);

    // C.4: Non-character boundary at U+FDEF/U+FDD0
    assert.equal(validateSASLprep('\uFDCF'), true);  // U+FDCF — valid (just before non-char range)
    assert.equal(validateSASLprep('\uFDD0'), false); // U+FDD0 — non-char start
    assert.equal(validateSASLprep('\uFDEF'), false); // U+FDEF — non-char end
    assert.equal(validateSASLprep('\uFDF0'), true);  // U+FDF0 — valid (just after non-char range)

    // C.4: Non-character at FFFE/FFFF
    assert.equal(validateSASLprep('\uFFFD'), true);  // U+FFFD — valid (replacement char)
    assert.equal(validateSASLprep('\uFFFE'), false); // U+FFFE — non-char
    assert.equal(validateSASLprep('\uFFFF'), false); // U+FFFF — non-char

    // C.5: Surrogate boundary at U+D7FF/U+D800/U+DFFF/U+E000
    assert.equal(validateSASLprep('\uD7FF'), true);  // U+D7FF — valid (just before surrogates)
    assert.equal(validateSASLprep('\uD800'), false); // U+D800 — high surrogate start
    assert.equal(validateSASLprep('\uDFFF'), false); // U+DFFF — low surrogate end
    assert.equal(validateSASLprep('\uE000'), false); // U+E000 — private use
  });
});

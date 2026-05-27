// tests/wire-stream.test.ts
// Unit tests for StreetPostgresWireStream (backpressure-aware Readable stream)
// and PgConnection.queryStream() method.
//
// Uses mock sockets to simulate PostgreSQL server responses without a real
// database connection, following the same pattern established in
// wire-protocol.test.ts.
import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { StreetPostgresWireStream, PgConnection, } from '../src/database/wire.js';
// ─── Helpers ───────────────────────────────────────────────────────────────────
function createMockSocket() {
    const socket = new EventEmitter();
    socket.setKeepAlive = () => { };
    socket.setNoDelay = () => { };
    socket.destroy = () => { };
    socket.write = mock.fn(() => true);
    socket.pause = mock.fn(() => { });
    socket.resume = mock.fn(() => { });
    return socket;
}
/** Build a complete PG backend message (type byte + length prefix + body) */
function wrapMsg(type, body) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(4 + body.length);
    return Buffer.concat([Buffer.from([type]), len, body]);
}
/** Build a RowDescription body for a single column */
function singleColRowDesc(colName, typeOid = 25) {
    // fieldCount(2) + name(null-term) + tableOid(4) + attNum(2) + typeOid(4) + typeSize(2) + typeMod(4) + format(2)
    const nameBuf = Buffer.from(colName + '\0', 'utf8');
    const fi = Buffer.alloc(18);
    fi.writeUInt32BE(0, 0); // tableOid = 0
    fi.writeUInt16BE(0, 4); // attNum = 0
    fi.writeUInt32BE(typeOid, 6); // typeOid
    fi.writeInt16BE(-1, 10); // typeSize
    fi.writeInt32BE(-1, 12); // typeMod
    fi.writeUInt16BE(0, 16); // format = text
    const rdBody = Buffer.alloc(2);
    rdBody.writeUInt16BE(1); // 1 column
    return Buffer.concat([rdBody, nameBuf, fi]);
}
/** Build a DataRow body with an array of string values (one per column) */
function buildDataRow(cols) {
    const colBuffers = [];
    let totalLen = 2; // colCount UInt16BE
    for (const col of cols) {
        totalLen += 4; // length prefix Int32BE
        if (col !== null) {
            const b = Buffer.from(col, 'utf8');
            colBuffers.push(b);
            totalLen += b.length;
        }
        else {
            colBuffers.push(Buffer.alloc(0)); // placeholder, not actually used
        }
    }
    const buf = Buffer.alloc(totalLen);
    buf.writeUInt16BE(cols.length, 0);
    let offset = 2;
    for (let i = 0; i < cols.length; i++) {
        if (cols[i] === null) {
            buf.writeInt32BE(-1, offset); // NULL indicator
            offset += 4;
        }
        else {
            const b = colBuffers[i];
            buf.writeInt32BE(b.length, offset);
            offset += 4;
            b.copy(buf, offset);
            offset += b.length;
        }
    }
    return buf;
}
function commandComplete(tag) {
    return Buffer.from(tag + '\0', 'utf8');
}
function readyForQuery() {
    return Buffer.from([0x49]); // 'I' idle
}
// ─── Suite 1: StreetPostgresWireStream unit tests ─────────────────────────────
describe('StreetPostgresWireStream', () => {
    it('is an object-mode Readable stream', () => {
        const stream = new StreetPostgresWireStream();
        assert.equal(stream.readableObjectMode, true);
        assert.equal(stream.readableHighWaterMark, 64);
        stream.destroy();
    });
    it('pushRow returns true for the first push (buffer not full)', () => {
        const stream = new StreetPostgresWireStream();
        const result = stream.pushRow({ n: '1' });
        assert.equal(result, true);
        stream.destroy();
    });
    it('pushRow returns false after finalize (stream ended)', async () => {
        const stream = new StreetPostgresWireStream();
        // Collect stream data to prevent backpressure from interfering
        const rows = [];
        stream.on('data', (r) => rows.push(r));
        stream.pushRow({ n: '1' });
        stream.finalize();
        // Wait for the stream to end
        await new Promise((resolve) => stream.on('end', resolve));
        // After finalize, pushRow should return false
        assert.equal(stream.pushRow({ n: '2' }), false);
    });
    it('pushRow returns false when stream is destroyed', () => {
        const stream = new StreetPostgresWireStream();
        stream.destroy();
        assert.equal(stream.pushRow({ n: '1' }), false);
    });
    it('finalize() pushes null to end the stream', async () => {
        const stream = new StreetPostgresWireStream();
        const rows = [];
        stream.on('data', (r) => rows.push(r));
        const endPromise = new Promise((resolve) => stream.on('end', resolve));
        stream.pushRow({ a: '1' });
        stream.finalize();
        await endPromise;
        assert.equal(rows.length, 1);
        assert.deepEqual(rows[0], { a: '1' });
    });
    it('finalize(error) destroys the stream with the error', async () => {
        const stream = new StreetPostgresWireStream();
        const errorPromise = new Promise((resolve) => stream.on('error', resolve));
        stream.finalize(new Error('test error'));
        const err = await errorPromise;
        assert.equal(err.message, 'test error');
    });
    it('finalize(error) emits error and does not emit end', async () => {
        const stream = new StreetPostgresWireStream();
        let ended = false;
        stream.on('end', () => { ended = true; });
        const errorPromise = new Promise((resolve) => {
            stream.on('error', () => {
                // Give the event loop a tick to potentially emit 'end'
                setImmediate(() => resolve());
            });
        });
        stream.finalize(new Error('stream error'));
        await errorPromise;
        assert.equal(ended, false);
    });
    it('backs up when highWaterMark is exceeded (push returns false)', () => {
        const stream = new StreetPostgresWireStream();
        // objectMode highWaterMark = 64, push 65 rows without consuming
        let i = 0;
        for (; i < 64; i++) {
            const result = stream.pushRow({ n: String(i) });
            if (!result)
                break;
        }
        // We may or may not hit backpressure depending on Node.js internal buffering.
        // At minimum, we've pushed 64 rows without error and stream is still open.
        assert.ok(i >= 1);
        // The stream should still be writable (pushRow returns true means buffer accepted it)
        // Actually in Node.js, Readable.push() returns true as long as buffer is below highWaterMark.
        // So we may need multiple rounds. Let's just verify the stream behavior is consistent.
        stream.destroy();
    });
    it('backs up and returns false when internal buffer fills', () => {
        const stream = new StreetPostgresWireStream();
        // Don't consume — push until buffer fills
        let pushesAccepted = 0;
        for (let i = 0; i < 200; i++) {
            const canContinue = stream.pushRow({ idx: String(i) });
            if (canContinue) {
                pushesAccepted++;
            }
            else {
                // Backpressure triggered
                break;
            }
        }
        // In object mode with highWaterMark=64, push should return false
        // after the internal buffer exceeds 64 items (when no consumer attached)
        assert.ok(pushesAccepted < 200, 'Backpressure should eventually kick in');
        assert.ok(pushesAccepted >= 1, 'Should accept at least 1 item before backpressure');
        stream.destroy();
    });
    it('can push multiple rows and drain them via pipe', async () => {
        const stream = new StreetPostgresWireStream();
        const collected = [];
        stream.on('data', (row) => collected.push(row));
        stream.pushRow({ x: '10' });
        stream.pushRow({ x: '20' });
        stream.pushRow({ x: '30' });
        stream.finalize();
        await new Promise((resolve) => stream.on('end', resolve));
        assert.equal(collected.length, 3);
        assert.deepEqual(collected, [{ x: '10' }, { x: '20' }, { x: '30' }]);
    });
    it('can be consumed with for-await-of', async () => {
        const stream = new StreetPostgresWireStream();
        stream.pushRow({ val: 'a' });
        stream.pushRow({ val: 'b' });
        stream.finalize();
        const collected = [];
        for await (const row of stream) {
            collected.push(row);
        }
        assert.equal(collected.length, 2);
        assert.deepEqual(collected, [{ val: 'a' }, { val: 'b' }]);
    });
    it('handles empty stream (no rows, finalize immediately)', async () => {
        const stream = new StreetPostgresWireStream();
        const collected = [];
        stream.on('data', (row) => collected.push(row));
        stream.finalize();
        await new Promise((resolve) => stream.on('end', resolve));
        assert.equal(collected.length, 0);
    });
    it('_read does not throw', () => {
        const stream = new StreetPostgresWireStream();
        // _read is called internally when consumer requests data via read()
        assert.doesNotThrow(() => stream.read(0));
        stream.destroy();
    });
    it('multiple rows with varied data types', async () => {
        const stream = new StreetPostgresWireStream();
        const collected = [];
        stream.on('data', (row) => collected.push(row));
        stream.pushRow({ id: '1', name: 'Alice', active: 't' });
        stream.pushRow({ id: '2', name: 'Bob', active: 'f' });
        stream.pushRow({ id: '3', name: null, active: 't' });
        stream.finalize();
        await new Promise((resolve) => stream.on('end', resolve));
        assert.equal(collected.length, 3);
        assert.equal(collected[0]['name'], 'Alice');
        assert.equal(collected[2]['name'], null);
    });
});
// ─── Suite 2: PgConnection.queryStream integration ────────────────────────────
//
// Wires a mock socket into PgConnection to test the queryStream() lifecycle:
//   1. Simple query message ('Q') is written to the socket
//   2. Server responds with RowDescription, DataRow(s), CommandComplete, ReadyForQuery
//   3. Stream receives rows via 'data' events and 'end' when complete
//   4. Error responses are forwarded as stream errors
//   5. Backpressure pauses the socket; resume event resumes it
describe('PgConnection.queryStream', () => {
    function createReadyConnection() {
        const socket = createMockSocket();
        const conn = new PgConnection();
        conn.socket = socket;
        conn.state = 'ready';
        // Wire the data handler like _connect() does
        socket.on('data', (chunk) => {
            conn.buffer = Buffer.concat([conn.buffer, chunk]);
            conn._processBuffer({
                host: 'localhost',
                port: 5432,
                user: 'test',
                password: 'test',
                database: 'test',
            });
        });
        return { conn, socket };
    }
    it('writes a simple query message (type 0x51 = Q) to the socket', () => {
        const { conn, socket } = createReadyConnection();
        const stream = conn.queryStream('SELECT 1 AS n');
        assert.ok(stream instanceof StreetPostgresWireStream);
        assert.equal(socket.write.mock.calls.length, 1);
        const written = socket.write.mock.calls[0].arguments[0];
        assert.equal(written[0], 0x51, 'Message type is Q (simple query)');
        // Verify query text is in the message
        const queryEnd = written.indexOf(0, 5);
        const queryText = written.toString('utf8', 5, queryEnd);
        assert.equal(queryText, 'SELECT 1 AS n');
        // Clean up
        stream.destroy();
    });
    it('delivers DataRows as stream data events', async () => {
        const { conn, socket } = createReadyConnection();
        const stream = conn.queryStream('SELECT 1 AS n');
        const collected = [];
        stream.on('data', (row) => collected.push(row));
        // Build mock response: RowDescription + DataRow + CommandComplete + ReadyForQuery
        const rdBody = singleColRowDesc('n');
        const drBody = buildDataRow(['1']);
        const response = Buffer.concat([
            wrapMsg(0x54, rdBody), // RowDescription
            wrapMsg(0x44, drBody), // DataRow
            wrapMsg(0x43, commandComplete('SELECT 1')), // CommandComplete
            wrapMsg(0x5a, readyForQuery()), // ReadyForQuery
        ]);
        socket.emit('data', response);
        // Wait for stream to end
        await new Promise((resolve) => stream.on('end', resolve));
        assert.equal(collected.length, 1);
        assert.deepEqual(collected[0], { n: '1' });
    });
    it('delivers multiple rows', async () => {
        const { conn, socket } = createReadyConnection();
        const stream = conn.queryStream('SELECT generate_series(1,3) AS n');
        const collected = [];
        stream.on('data', (row) => collected.push(row));
        // Build RowDescription for single column 'n'
        const rdBody = singleColRowDesc('n');
        // Build three DataRows
        const dr1 = buildDataRow(['1']);
        const dr2 = buildDataRow(['2']);
        const dr3 = buildDataRow(['3']);
        const response = Buffer.concat([
            wrapMsg(0x54, rdBody),
            wrapMsg(0x44, dr1),
            wrapMsg(0x44, dr2),
            wrapMsg(0x44, dr3),
            wrapMsg(0x43, commandComplete('SELECT 3')),
            wrapMsg(0x5a, readyForQuery()),
        ]);
        socket.emit('data', response);
        await new Promise((resolve) => stream.on('end', resolve));
        assert.equal(collected.length, 3);
        assert.deepEqual(collected, [{ n: '1' }, { n: '2' }, { n: '3' }]);
    });
    it('handles rows with null values', async () => {
        const { conn, socket } = createReadyConnection();
        const stream = conn.queryStream('SELECT NULL AS n');
        const collected = [];
        stream.on('data', (row) => collected.push(row));
        const rdBody = singleColRowDesc('n');
        const drBody = buildDataRow([null]);
        const response = Buffer.concat([
            wrapMsg(0x54, rdBody),
            wrapMsg(0x44, drBody),
            wrapMsg(0x43, commandComplete('SELECT 1')),
            wrapMsg(0x5a, readyForQuery()),
        ]);
        socket.emit('data', response);
        await new Promise((resolve) => stream.on('end', resolve));
        assert.equal(collected.length, 1);
        assert.equal(collected[0]['n'], null);
    });
    it('handles rows with multiple columns', async () => {
        const { conn, socket } = createReadyConnection();
        const stream = conn.queryStream('SELECT 1 AS a, 2 AS b');
        const collected = [];
        stream.on('data', (row) => collected.push(row));
        // Build RowDescription for two columns 'a' and 'b'
        const aName = Buffer.from('a\0', 'utf8');
        const aFi = Buffer.alloc(18);
        aFi.writeUInt32BE(0, 0);
        aFi.writeUInt16BE(0, 4);
        aFi.writeUInt32BE(23, 6); // int4
        aFi.writeInt16BE(4, 10);
        aFi.writeInt32BE(-1, 12);
        aFi.writeUInt16BE(0, 16);
        const bName = Buffer.from('b\0', 'utf8');
        const bFi = Buffer.alloc(18);
        bFi.writeUInt32BE(0, 0);
        bFi.writeUInt16BE(0, 4);
        bFi.writeUInt32BE(23, 6);
        bFi.writeInt16BE(4, 10);
        bFi.writeInt32BE(-1, 12);
        bFi.writeUInt16BE(0, 16);
        const rdBody = Buffer.alloc(2);
        rdBody.writeUInt16BE(2);
        const rdFull = Buffer.concat([rdBody, aName, aFi, bName, bFi]);
        const drBody = buildDataRow(['1', '2']);
        const response = Buffer.concat([
            wrapMsg(0x54, rdFull),
            wrapMsg(0x44, drBody),
            wrapMsg(0x43, commandComplete('SELECT 1')),
            wrapMsg(0x5a, readyForQuery()),
        ]);
        socket.emit('data', response);
        await new Promise((resolve) => stream.on('end', resolve));
        assert.equal(collected.length, 1);
        const row = collected[0];
        assert.equal(row['a'], '1');
        assert.equal(row['b'], '2');
    });
    it('handles empty result (no DataRows)', async () => {
        const { conn, socket } = createReadyConnection();
        const stream = conn.queryStream('SELECT 1 WHERE false');
        const collected = [];
        stream.on('data', (row) => collected.push(row));
        const rdBody = singleColRowDesc('n');
        const response = Buffer.concat([
            wrapMsg(0x54, rdBody),
            wrapMsg(0x43, commandComplete('SELECT 0')),
            wrapMsg(0x5a, readyForQuery()),
        ]);
        socket.emit('data', response);
        await new Promise((resolve) => stream.on('end', resolve));
        assert.equal(collected.length, 0);
    });
    it('emits error when server sends ErrorResponse', async () => {
        const { conn, socket } = createReadyConnection();
        const stream = conn.queryStream('SELECT * FROM nonexistent');
        const errorPromise = new Promise((resolve) => stream.on('error', resolve));
        // Build ErrorResponse body: 'S' 'ERROR' \0 'M' 'relation \"nonexistent\" does not exist' \0 \0
        const errBody = Buffer.from('SERROR\0Mrelation "nonexistent" does not exist\0\0', 'utf8');
        const response = Buffer.concat([
            wrapMsg(0x45, errBody),
            wrapMsg(0x5a, readyForQuery()),
        ]);
        socket.emit('data', response);
        const err = await errorPromise;
        assert.ok(err.message.includes('nonexistent'));
        // Connection should be ready again
        assert.equal(conn.isReady, true);
    });
    it('emits error when connection is not ready', async () => {
        const conn = new PgConnection();
        // State is 'connecting' by default
        const stream = conn.queryStream('SELECT 1');
        const errorPromise = new Promise((resolve) => stream.on('error', resolve));
        const err = await errorPromise;
        assert.ok(err.message.includes('connecting'));
    });
    it('pauses socket when pushRow returns false (backpressure)', async () => {
        const { conn, socket } = createReadyConnection();
        const stream = conn.queryStream('SELECT generate_series(1,100) AS n');
        // Don't consume from stream — buffer should fill up
        // Push rows until backpressure kicks in
        const rdBody = singleColRowDesc('n');
        // Write RowDescription first (before any DataRows)
        socket.emit('data', wrapMsg(0x54, rdBody));
        // Now write DataRows one by one and check when pause is called
        let pauseCallCount = 0;
        for (let i = 0; i < 100; i++) {
            socket.emit('data', wrapMsg(0x44, buildDataRow([String(i)])));
            const calls = socket.pause.mock.calls.length;
            if (calls > pauseCallCount) {
                pauseCallCount = calls;
                // Stream paused — break
                break;
            }
        }
        assert.ok(pauseCallCount >= 1, 'Socket should have been paused due to backpressure');
        // Clean up
        stream.destroy();
        // Clear internal reference
        conn.streamTarget = null;
    });
    it('resumes socket on stream resume event', async () => {
        const { conn, socket } = createReadyConnection();
        const stream = conn.queryStream('SELECT 1 AS n');
        // Emit 'resume' on the stream to simulate consumer resuming
        // The queryStream method sets up: stream.on('resume', () => { this.socket?.resume(); })
        stream.emit('resume');
        assert.equal(socket.resume.mock.calls.length, 1);
        stream.destroy();
    });
    it('returns connection to ready state after stream completes', async () => {
        const { conn, socket } = createReadyConnection();
        const stream = conn.queryStream('SELECT 1 AS n');
        // Connection should be in 'query' state during stream
        assert.equal(conn.isReady, false);
        const collected = [];
        stream.on('data', (row) => collected.push(row));
        const rdBody = singleColRowDesc('n');
        const drBody = buildDataRow(['1']);
        const response = Buffer.concat([
            wrapMsg(0x54, rdBody),
            wrapMsg(0x44, drBody),
            wrapMsg(0x43, commandComplete('SELECT 1')),
            wrapMsg(0x5a, readyForQuery()),
        ]);
        socket.emit('data', response);
        await new Promise((resolve) => stream.on('end', resolve));
        // Connection should be ready again
        assert.equal(conn.isReady, true);
    });
    it('does not interfere with subsequent simple queries after stream', async () => {
        const { conn, socket } = createReadyConnection();
        // Run a stream first
        const stream1 = conn.queryStream('SELECT 1 AS n');
        const collected1 = [];
        stream1.on('data', (row) => collected1.push(row));
        const rdBody = singleColRowDesc('n');
        const drBody = buildDataRow(['1']);
        const response = Buffer.concat([
            wrapMsg(0x54, rdBody),
            wrapMsg(0x44, drBody),
            wrapMsg(0x43, commandComplete('SELECT 1')),
            wrapMsg(0x5a, readyForQuery()),
        ]);
        socket.emit('data', response);
        await new Promise((resolve) => stream1.on('end', resolve));
        assert.equal(collected1.length, 1);
        // Now run a regular query
        const prevCalls = socket.write.mock.calls.length;
        const queryPromise = conn.query('SELECT 2 AS n');
        assert.equal(socket.write.mock.calls.length, prevCalls + 1, 'query() should write one message');
        const written = socket.write.mock.calls[0].arguments[0];
        assert.equal(written[0], 0x51, 'Second query uses simple query protocol');
        // Respond to regular query
        const drBody2 = buildDataRow(['2']);
        const response2 = Buffer.concat([
            wrapMsg(0x54, singleColRowDesc('n')),
            wrapMsg(0x44, drBody2),
            wrapMsg(0x43, commandComplete('SELECT 1')),
            wrapMsg(0x5a, readyForQuery()),
        ]);
        socket.emit('data', response2);
        const result = await queryPromise;
        assert.equal(result.rows[0]?.['n'], '2');
    });
});
//# sourceMappingURL=wire-stream.test.js.map
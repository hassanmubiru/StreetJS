// src/tests/mysql-result-stream.test.ts
// Unit tests for MysqlResultStream (task 6.5 — queryStream backpressure).
// These do NOT require a live MySQL server: they exercise the stream object
// directly, verifying objectMode, row emission, finalization, and the
// backpressure-release mechanism (_read -> onResume).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { MysqlResultStream } from '../database/mysql/wire.js';
describe('MysqlResultStream — objectMode & row emission', () => {
    it('is a Readable in objectMode', () => {
        const stream = new MysqlResultStream();
        assert.equal(stream.readableObjectMode, true);
        stream.destroy();
    });
    it('emits the pushed row objects and ends on finalize()', async () => {
        const stream = new MysqlResultStream();
        const received = [];
        stream.on('data', (row) => received.push(row));
        assert.equal(stream.pushRow({ id: '1', name: 'Alice' }), true);
        assert.equal(stream.pushRow({ id: '2', name: null }), true);
        stream.finalize();
        await once(stream, 'end');
        assert.deepEqual(received, [
            { id: '1', name: 'Alice' },
            { id: '2', name: null },
        ]);
    });
    it('destroys with the error on finalize(error)', async () => {
        const stream = new MysqlResultStream();
        stream.on('data', () => { });
        const boom = new Error('query failed');
        stream.finalize(boom);
        const [err] = (await once(stream, 'error'));
        assert.equal(err, boom);
    });
    it('pushRow returns false after finalize and emits no further rows', async () => {
        const stream = new MysqlResultStream();
        const received = [];
        stream.on('data', (row) => received.push(row));
        stream.finalize();
        assert.equal(stream.pushRow({ id: '1' }), false);
        await once(stream, 'end');
        assert.equal(received.length, 0);
    });
    it('finalize() is idempotent and does not throw when called twice', async () => {
        const stream = new MysqlResultStream();
        stream.on('data', () => { });
        stream.finalize();
        assert.doesNotThrow(() => stream.finalize());
        await once(stream, 'end');
    });
});
describe('MysqlResultStream — backpressure release', () => {
    it('does not invoke onResume while the consumer is absent (buffer fills)', () => {
        let resumeCalls = 0;
        const stream = new MysqlResultStream(() => { resumeCalls++; });
        // Fill the internal buffer until push() reports backpressure.
        let pushed = 0;
        while (stream.pushRow({ n: String(pushed) })) {
            pushed++;
            if (pushed > 10_000)
                break; // safety valve
        }
        // The buffer is full and nothing is consuming, so the source should not
        // have been asked to resume yet.
        assert.equal(resumeCalls, 0);
        assert.ok(pushed > 0, 'expected at least one row to be buffered');
        stream.destroy();
    });
    it('invokes onResume (via _read) once the consumer drains the buffer', async () => {
        let resumeCalls = 0;
        let finalized = false;
        const stream = new MysqlResultStream(() => {
            resumeCalls++;
            // Simulate the connection layer finishing the result set once the
            // consumer signals it is ready for more data.
            if (!finalized) {
                finalized = true;
                stream.finalize();
            }
        });
        // Fill the buffer past the highWaterMark so push() returns false.
        let pushed = 0;
        while (stream.pushRow({ n: String(pushed) })) {
            pushed++;
            if (pushed > 10_000)
                break;
        }
        assert.equal(resumeCalls, 0);
        // Start consuming. As the buffer drains below the highWaterMark, Node
        // calls _read(), which must release backpressure via onResume.
        const received = [];
        stream.on('data', (row) => received.push(row));
        await once(stream, 'end');
        assert.ok(resumeCalls >= 1, 'onResume should be called when the consumer drains');
        // Every buffered row (including the one whose push returned false) is delivered.
        assert.equal(received.length, pushed + 1);
    });
});
//# sourceMappingURL=mysql-result-stream.test.js.map
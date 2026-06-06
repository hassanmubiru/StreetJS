// src/tests/otel-db-span.test.ts
// Unit tests for instrumentPoolWithOtel / OtelInstrumentedPool.
//   - A child span is created with the parent's traceId and the correct
//     db.* attributes when a parent span is active.
//   - NO span is created when no parent span is active.
// Uses ONLY node:test and node:assert with a real OtelTracer + a fake pool.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { OtelTracer, instrumentPoolWithOtel } from '../observability/otel.js';
// ── Helpers ───────────────────────────────────────────────────────────────────
/** A fake queryable pool that records the SQL/params it received. */
function makeFakePool() {
    const calls = [];
    return {
        calls,
        async query(sql, params) {
            calls.push({ sql, params });
            return { rows: [], rowCount: 0, command: 'SELECT' };
        },
    };
}
/** A fake pool whose query() always rejects. */
function makeRejectingPool(err) {
    return {
        async query() {
            throw err;
        },
    };
}
/** Read the tracer's completed-span buffer (spans land here after `end()`). */
function bufferedSpans(tracer) {
    return tracer.buffer;
}
// ── Tests ─────────────────────────────────────────────────────────────────────
describe('instrumentPoolWithOtel — child span when parent active', () => {
    it('creates a db.query child span inheriting the parent traceId with db.* attributes', async () => {
        const tracer = new OtelTracer({ serviceName: 'test' });
        const fake = makeFakePool();
        const parent = tracer.startSpan('GET /users');
        const pool = instrumentPoolWithOtel(fake, tracer, () => parent);
        const sql = 'SELECT * FROM users WHERE id = $1';
        const result = await pool.query(sql, ['42']);
        // Underlying pool is still invoked with the same arguments.
        assert.equal(fake.calls.length, 1);
        assert.equal(fake.calls[0].sql, sql);
        assert.deepEqual(fake.calls[0].params, ['42']);
        assert.deepEqual(result, { rows: [], rowCount: 0, command: 'SELECT' });
        // Exactly one span was completed: the DB child span.
        const spans = bufferedSpans(tracer);
        assert.equal(spans.length, 1);
        const dbSpan = spans[0];
        assert.equal(dbSpan.name, 'db.query');
        // Parent-child relationship.
        assert.equal(dbSpan.context.traceId, parent.context.traceId);
        assert.equal(dbSpan.parentSpanId, parent.context.spanId);
        assert.notEqual(dbSpan.context.spanId, parent.context.spanId);
        // Attributes.
        assert.equal(dbSpan.attributes['db.system'], 'postgresql');
        assert.equal(dbSpan.attributes['db.statement'], sql);
        // Duration recorded via end().
        assert.ok(dbSpan.endNs !== undefined, 'span should be ended to record duration');
        assert.ok(dbSpan.endNs >= dbSpan.startNs);
        tracer.shutdown();
    });
    it('ends the child span (recording duration) even when the query rejects', async () => {
        const tracer = new OtelTracer({ serviceName: 'test' });
        const parent = tracer.startSpan('GET /boom');
        const pool = instrumentPoolWithOtel(makeRejectingPool(new Error('db down')), tracer, () => parent);
        await assert.rejects(() => pool.query('SELECT 1'), /db down/);
        const spans = bufferedSpans(tracer);
        assert.equal(spans.length, 1);
        const dbSpan = spans[0];
        assert.equal(dbSpan.attributes['db.system'], 'postgresql');
        assert.equal(dbSpan.attributes['db.statement'], 'SELECT 1');
        assert.ok(dbSpan.endNs !== undefined, 'span should be ended even on error');
        tracer.shutdown();
    });
});
describe('instrumentPoolWithOtel — no span when no parent active', () => {
    it('does not create any span and forwards the query unchanged', async () => {
        const tracer = new OtelTracer({ serviceName: 'test' });
        const fake = makeFakePool();
        const pool = instrumentPoolWithOtel(fake, tracer, () => undefined);
        const result = await pool.query('SELECT 1 AS n');
        // Query still ran against the underlying pool.
        assert.equal(fake.calls.length, 1);
        assert.equal(fake.calls[0].sql, 'SELECT 1 AS n');
        assert.deepEqual(result, { rows: [], rowCount: 0, command: 'SELECT' });
        // No span was created because there was no active parent.
        assert.equal(bufferedSpans(tracer).length, 0);
        tracer.shutdown();
    });
    it('decides per-call based on the current active span', async () => {
        const tracer = new OtelTracer({ serviceName: 'test' });
        const fake = makeFakePool();
        let active;
        const pool = instrumentPoolWithOtel(fake, tracer, () => active);
        // No active span on the first call → no span.
        await pool.query('SELECT 1');
        assert.equal(bufferedSpans(tracer).length, 0);
        // Active span set before the second call → one span.
        active = tracer.startSpan('GET /now');
        await pool.query('SELECT 2');
        assert.equal(bufferedSpans(tracer).length, 1);
        assert.equal(bufferedSpans(tracer)[0].attributes['db.statement'], 'SELECT 2');
        tracer.shutdown();
    });
});
//# sourceMappingURL=otel-db-span.test.js.map
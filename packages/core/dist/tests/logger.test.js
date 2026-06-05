// src/tests/logger.test.ts
// Unit tests for the structured Logger (tasks 12.1–12.8).
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { Logger, correlationMiddleware } from '../observability/logger.js';
// ── Helpers ───────────────────────────────────────────────────────────────────
/** Capture writes into an in-memory array of parsed LogEntry objects. */
function captureStream() {
    const entries = [];
    const stream = new Writable({
        write(chunk, _enc, cb) {
            const line = chunk.toString().trim();
            if (line) {
                try {
                    entries.push(JSON.parse(line));
                }
                catch {
                    // ignore non-JSON lines (e.g. dev pretty-print to stdout)
                }
            }
            cb();
        },
    });
    return { stream, entries };
}
/** Build a minimal StreetContext-like object for middleware tests. */
function makeCtx(headers = {}) {
    const responseHeaders = {};
    return {
        req: {},
        res: {},
        path: '/test',
        method: 'GET',
        params: {},
        query: {},
        headers,
        body: null,
        files: [],
        state: {},
        user: null,
        startTime: process.hrtime.bigint(),
        sent: false,
        json: () => undefined,
        text: () => undefined,
        html: () => undefined,
        send: () => undefined,
        setHeader: (name, value) => { responseHeaders[name] = value; },
        cookie: () => undefined,
        setCookie: () => undefined,
        _responseHeaders: responseHeaders,
    };
}
// ── 12.1 — Structure ──────────────────────────────────────────────────────────
describe('Logger — JSON output structure (12.1 / 12.2)', () => {
    it('emits all required LogEntry fields', () => {
        const { stream, entries } = captureStream();
        const log = new Logger({ service: 'test-svc', stream });
        log.info('hello world');
        assert.equal(entries.length, 1);
        const e = entries[0];
        assert.equal(e.service, 'test-svc');
        assert.equal(e.level, 'info');
        assert.equal(e.message, 'hello world');
        assert.ok(typeof e.timestamp === 'string', 'timestamp must be a string');
        // Validate ISO 8601 format
        assert.ok(!Number.isNaN(Date.parse(e.timestamp)), 'timestamp must be valid ISO 8601');
    });
    it('merges meta fields into the log entry', () => {
        const { stream, entries } = captureStream();
        const log = new Logger({ service: 'svc', stream });
        log.debug('debug msg', { requestId: 'abc', userId: 42 });
        assert.equal(entries.length, 1);
        const e = entries[0];
        assert.equal(e['requestId'], 'abc');
        assert.equal(e['userId'], 42);
    });
});
// ── 12.2 — Level filtering ────────────────────────────────────────────────────
describe('Logger — level filtering (12.2)', () => {
    it('suppresses debug and info when level=warn', () => {
        const { stream, entries } = captureStream();
        const log = new Logger({ service: 'svc', level: 'warn', stream });
        log.debug('should be suppressed');
        log.info('also suppressed');
        log.warn('visible');
        log.error('also visible');
        assert.equal(entries.length, 2);
        assert.equal(entries[0].level, 'warn');
        assert.equal(entries[1].level, 'error');
    });
    it('suppresses nothing when level=debug (default)', () => {
        const { stream, entries } = captureStream();
        const log = new Logger({ service: 'svc', level: 'debug', stream });
        log.debug('d');
        log.info('i');
        log.warn('w');
        log.error('e');
        assert.equal(entries.length, 4);
    });
    it('only emits error when level=error', () => {
        const { stream, entries } = captureStream();
        const log = new Logger({ service: 'svc', level: 'error', stream });
        log.debug('d');
        log.info('i');
        log.warn('w');
        log.error('e');
        assert.equal(entries.length, 1);
        assert.equal(entries[0].level, 'error');
    });
});
// ── 12.3 — Child logger ───────────────────────────────────────────────────────
describe('Logger — child() bindings (12.3)', () => {
    it('child logger merges bindings into every entry', () => {
        const { stream, entries } = captureStream();
        const parent = new Logger({ service: 'svc', stream });
        const child = parent.child({ requestId: 'req-99' });
        child.info('from child');
        assert.equal(entries.length, 1);
        assert.equal(entries[0]['requestId'], 'req-99');
        assert.equal(entries[0].service, 'svc');
    });
    it('child inherits parent level filtering', () => {
        const { stream, entries } = captureStream();
        const parent = new Logger({ service: 'svc', level: 'warn', stream });
        const child = parent.child({ tag: 'child' });
        child.debug('suppressed');
        child.warn('visible');
        assert.equal(entries.length, 1);
        assert.equal(entries[0].level, 'warn');
    });
    it('child bindings do not affect parent logger', () => {
        const { stream, entries } = captureStream();
        const parent = new Logger({ service: 'svc', stream });
        const child = parent.child({ childKey: 'yes' });
        parent.info('from parent');
        child.info('from child');
        assert.equal(entries.length, 2);
        assert.equal(entries[0]['childKey'], undefined);
        assert.equal(entries[1]['childKey'], 'yes');
    });
});
// ── 12.4 — Error serialisation ───────────────────────────────────────────────
describe('Logger — Error serialisation (12.4)', () => {
    it('serialises an Error in meta to {name, message, stack}', () => {
        const { stream, entries } = captureStream();
        const log = new Logger({ service: 'svc', stream });
        const err = new Error('boom');
        log.error('something broke', { err });
        assert.equal(entries.length, 1);
        const e = entries[0];
        const serialised = e['err'];
        assert.equal(serialised.name, 'Error');
        assert.equal(serialised.message, 'boom');
        assert.ok(typeof serialised.stack === 'string');
    });
    it('does not affect non-Error meta values', () => {
        const { stream, entries } = captureStream();
        const log = new Logger({ service: 'svc', stream });
        log.info('msg', { count: 5, label: 'ok' });
        assert.equal(entries[0]['count'], 5);
        assert.equal(entries[0]['label'], 'ok');
    });
});
// ── 12.5 — Dev pretty-formatter ──────────────────────────────────────────────
describe('Logger — dev pretty-formatter (12.5)', () => {
    let savedEnv;
    let capturedStdout;
    let originalWrite;
    beforeEach(() => {
        savedEnv = process.env['NODE_ENV'];
        process.env['NODE_ENV'] = 'development';
        capturedStdout = [];
        originalWrite = process.stdout.write.bind(process.stdout);
        process.stdout.write = (chunk, ...args) => {
            capturedStdout.push(chunk.toString());
            return true;
        };
    });
    afterEach(() => {
        process.env['NODE_ENV'] = savedEnv;
        process.stdout.write = originalWrite;
    });
    it('writes colorised output to stdout in development mode', () => {
        const { stream } = captureStream();
        const log = new Logger({ service: 'svc', stream });
        log.info('test message');
        const combined = capturedStdout.join('');
        // Should contain ANSI escape sequences
        assert.ok(combined.includes('\x1b['), 'output should contain ANSI codes');
        assert.ok(combined.includes('test message'), 'output should contain the message');
        assert.ok(combined.includes('INFO'), 'output should contain the level');
    });
    it('includes ANSI red for error level', () => {
        const { stream } = captureStream();
        const log = new Logger({ service: 'svc', stream });
        log.error('critical failure');
        const combined = capturedStdout.join('');
        assert.ok(combined.includes('\x1b[31m'), 'error should use red ANSI code');
    });
    it('includes ANSI cyan for debug level', () => {
        const { stream } = captureStream();
        const log = new Logger({ service: 'svc', stream });
        log.debug('debugging');
        const combined = capturedStdout.join('');
        assert.ok(combined.includes('\x1b[36m'), 'debug should use cyan ANSI code');
    });
});
// ── 12.6 — correlationMiddleware ─────────────────────────────────────────────
describe('correlationMiddleware (12.6)', () => {
    it('generates a new UUID when no X-Correlation-ID header is present', async () => {
        const { stream } = captureStream();
        const log = new Logger({ service: 'svc', stream });
        const mw = correlationMiddleware(log);
        const ctx = makeCtx();
        await mw(ctx, async () => { });
        const correlationId = ctx.state['correlationId'];
        assert.ok(typeof correlationId === 'string');
        // UUID v4 pattern
        assert.match(correlationId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    });
    it('propagates the incoming X-Correlation-ID header', async () => {
        const { stream } = captureStream();
        const log = new Logger({ service: 'svc', stream });
        const mw = correlationMiddleware(log);
        const ctx = makeCtx({ 'x-correlation-id': 'existing-id-123' });
        await mw(ctx, async () => { });
        assert.equal(ctx.state['correlationId'], 'existing-id-123');
    });
    it('stores child logger in ctx.state["logger"]', async () => {
        const { stream } = captureStream();
        const log = new Logger({ service: 'svc', stream });
        const mw = correlationMiddleware(log);
        const ctx = makeCtx();
        await mw(ctx, async () => { });
        assert.ok(ctx.state['logger'] instanceof Logger);
    });
    it('child logger includes correlationId in entries', async () => {
        const { stream, entries } = captureStream();
        const log = new Logger({ service: 'svc', stream });
        const mw = correlationMiddleware(log);
        const ctx = makeCtx({ 'x-correlation-id': 'corr-abc' });
        await mw(ctx, async () => {
            const childLog = ctx.state['logger'];
            childLog.info('inside request');
        });
        const reqEntry = entries.find((e) => e.message === 'inside request');
        assert.ok(reqEntry, 'should have logged "inside request"');
        assert.equal(reqEntry['correlationId'], 'corr-abc');
    });
    it('sets X-Correlation-ID response header', async () => {
        const { stream } = captureStream();
        const log = new Logger({ service: 'svc', stream });
        const mw = correlationMiddleware(log);
        const ctx = makeCtx({ 'x-correlation-id': 'resp-header-test' });
        await mw(ctx, async () => { });
        assert.equal(ctx._responseHeaders['X-Correlation-ID'], 'resp-header-test');
    });
});
//# sourceMappingURL=logger.test.js.map
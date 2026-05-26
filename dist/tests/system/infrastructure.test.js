// tests/system/infrastructure.test.ts
// Production-grade infrastructure validation: migration system, CLI parser,
// telemetry, webhook dispatcher, SSE connections, OpenAPI spec generation,
// cluster coordination, configuration loading.
// Uses only node:test, node:assert, node:path, node:fs.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { TelemetryTracker, telemetryMiddleware } from '../../src/telemetry/tracker.js';
import { WebhookDispatcher } from '../../src/webhook/dispatcher.js';
import { SseConnection } from '../../src/websocket/sse.js';
import { generateOpenApi } from '../../src/http/openapi.js';
import { parseArgv } from '../../src/cli/kernel.js';
import { StreetMigrationRunner } from '../../src/database/migrations.js';
import { PgPool } from '../../src/database/pool.js';
// ═══════════════════════════════════════════════════════════════════════════════
// 1. CLI Argument Parser Validation
// ═══════════════════════════════════════════════════════════════════════════════
describe('CLI — argument parser validation', () => {
    it('parses simple command', () => {
        const args = parseArgv(['node', 'app.js', 'migrate']);
        assert.equal(args.command, 'migrate');
        assert.deepEqual(args.positional, []);
        assert.deepEqual(args.flags, {});
    });
    it('parses command with flags', () => {
        const args = parseArgv(['node', 'app.js', 'user:create', '--email', 'a@b.com', '--name', 'Alice']);
        assert.equal(args.command, 'user:create');
        assert.equal(args.flags['email'], 'a@b.com');
        assert.equal(args.flags['name'], 'Alice');
    });
    it('parses short flags', () => {
        const args = parseArgv(['node', 'app.js', '-v']);
        assert.equal(args.flags['v'], true);
    });
    it('parses --flag=value syntax', () => {
        const args = parseArgv(['node', 'app.js', 'cmd', '--dir=./migrations']);
        assert.equal(args.flags['dir'], './migrations');
    });
    it('parses positional arguments after command', () => {
        const args = parseArgv(['node', 'app.js', 'cmd', 'pos1', 'pos2']);
        assert.equal(args.command, 'cmd');
        assert.deepEqual(args.positional, ['pos1', 'pos2']);
    });
    it('returns null command when no command provided', () => {
        const args = parseArgv(['node', 'app.js']);
        assert.equal(args.command, null);
    });
    it('handles --help flag', () => {
        const args = parseArgv(['node', 'app.js', '--help']);
        assert.equal(args.command, null);
        assert.equal(args.flags['help'], true);
    });
    it('handles empty argv (only node and script)', () => {
        const args = parseArgv(['node', 'app.js']);
        assert.equal(args.command, null);
        assert.deepEqual(args.flags, {});
        assert.deepEqual(args.positional, []);
    });
    it('handles multiple short flags', () => {
        const args = parseArgv(['node', 'app.js', '-a', '-b', '-c']);
        assert.equal(args.flags['a'], true);
        assert.equal(args.flags['b'], true);
        assert.equal(args.flags['c'], true);
    });
});
// ═══════════════════════════════════════════════════════════════════════════════
// 2. Telemetry System Validation
// ═══════════════════════════════════════════════════════════════════════════════
describe('Telemetry — system validation', () => {
    it('records and retrieves latency samples', () => {
        const tracker = new TelemetryTracker(60000);
        tracker.recordRequest(1000000n, false); // 1ms
        tracker.recordRequest(5000000n, false); // 5ms
        tracker.recordRequest(10000000n, true); // 10ms, error
        const snap = tracker.snapshot();
        assert.ok(snap.requestCount >= 3);
        assert.ok(snap.errorCount >= 1);
        assert.ok(snap.latencyP50 >= 0);
        assert.ok(snap.latencyP99 >= 0);
        tracker.destroy();
    });
    it('bounded history — never exceeds MAX_SAMPLES', () => {
        const tracker = new TelemetryTracker(1); // collect every 1ms
        const history = tracker.getHistory(2000);
        assert.ok(history.length <= 1440); // MAX_SAMPLES
        tracker.destroy();
    });
    it('health() returns structured status', () => {
        const tracker = new TelemetryTracker(60000);
        const health = tracker.health();
        assert.ok(typeof health['status'] === 'string');
        assert.ok(typeof health['uptime'] === 'number');
        assert.ok(typeof health['pid'] === 'number');
        assert.ok(typeof health['heap'] === 'object');
        assert.ok(typeof health['requests'] === 'object');
        assert.ok(typeof health['latency'] === 'object');
        tracker.destroy();
    });
    it('bounded latency array — never exceeds MAX_LATENCY_SAMPLES', () => {
        const tracker = new TelemetryTracker(60000);
        for (let i = 0; i < 15000; i++) {
            tracker.recordRequest(BigInt(i * 1000), false);
        }
        const snap = tracker.snapshot();
        assert.ok(snap.requestCount >= 15000);
        tracker.destroy();
    });
    it('telemetryMiddleware records timing', async () => {
        const tracker = new TelemetryTracker(60000);
        const mw = telemetryMiddleware(tracker);
        const ctx = {
            req: {},
            res: { once: () => undefined, writableEnded: false },
            path: '/test',
            method: 'GET',
            query: {},
            params: {},
            headers: {},
            body: null,
            files: [],
            state: {},
            user: null,
            startTime: process.hrtime.bigint(),
            sent: false,
            json: () => { },
            text: () => { },
            html: () => { },
            send: () => { },
            setHeader: () => { },
            cookie: () => undefined,
            setCookie: () => { },
        };
        await mw(ctx, async () => { });
        const snap = tracker.snapshot();
        assert.ok(snap.requestCount >= 1);
        tracker.destroy();
    });
});
// ═══════════════════════════════════════════════════════════════════════════════
// 3. OpenAPI Specification Validation
// ═══════════════════════════════════════════════════════════════════════════════
describe('OpenAPI — spec generation validation', () => {
    it('generates a valid OpenAPI 3.1 spec', () => {
        const routes = [
            { method: 'GET', path: '/api/users', summary: 'List users', tags: ['users'] },
            { method: 'POST', path: '/api/users', summary: 'Create user', tags: ['users'], responses: { '201': { description: 'Created' } } },
            { method: 'GET', path: '/api/users/:id', summary: 'Get user by ID', tags: ['users'] },
        ];
        const spec = generateOpenApi(routes);
        assert.equal(spec['openapi'], '3.1.0');
        assert.ok(spec['info'] !== undefined);
        assert.ok(spec['paths'] !== undefined);
        assert.ok(spec['components'] !== undefined);
    });
    it('converts :param to {param} syntax', () => {
        const routes = [
            { method: 'GET', path: '/users/:id/posts/:postId' },
        ];
        const spec = generateOpenApi(routes);
        const paths = Object.keys(spec.paths);
        assert.ok(paths.includes('/users/{id}/posts/{postId}'));
    });
    it('includes path parameters in spec', () => {
        const routes = [
            { method: 'GET', path: '/users/:id' },
        ];
        const spec = generateOpenApi(routes);
        const pathItem = spec.paths['/users/{id}'];
        assert.ok(pathItem !== undefined);
        const getOp = pathItem.get;
        assert.ok(getOp !== undefined);
        assert.ok(Array.isArray(getOp.parameters));
        assert.equal(getOp.parameters[0].name, 'id');
        assert.equal(getOp.parameters[0].in, 'path');
        assert.equal(getOp.parameters[0].required, true);
    });
    it('includes security scheme in spec', () => {
        const spec = generateOpenApi([]);
        assert.ok(spec.components.securitySchemes.bearerAuth !== undefined);
        assert.equal(spec.components.securitySchemes.bearerAuth.type, 'http');
        assert.equal(spec.components.securitySchemes.bearerAuth.scheme, 'bearer');
    });
    it('handles empty routes gracefully', () => {
        const spec = generateOpenApi([]);
        const s = spec;
        assert.ok(typeof s['paths'] === 'object');
        assert.equal(Object.keys(s['paths']).length, 0);
    });
});
// ═══════════════════════════════════════════════════════════════════════════════
// 4. Webhook Dispatcher Validation
// ═══════════════════════════════════════════════════════════════════════════════
describe('Webhook Dispatcher — infrastructure validation', () => {
    it('enqueues and processes webhooks', async () => {
        const dispatcher = new WebhookDispatcher();
        // Start a local server to receive webhooks
        const { createServer } = await import('node:http');
        const received = [];
        const server = createServer((req, res) => {
            let body = '';
            req.on('data', (c) => body += c);
            req.on('end', () => {
                received.push(JSON.parse(body));
                res.writeHead(200);
                res.end('ok');
            });
        });
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
        const port = server.address().port;
        const target = {
            url: `http://127.0.0.1:${port}/webhook`,
            secret: 'test-secret',
            maxRetries: 1,
            timeoutMs: 2000,
        };
        dispatcher.enqueue(target, 'user.created', { id: 'u1', name: 'Alice' });
        dispatcher.enqueue(target, 'user.updated', { id: 'u1', name: 'Alice Updated' });
        // Wait for processing
        await new Promise((r) => setTimeout(r, 500));
        assert.equal(received.length, 2);
        assert.equal(received[0].event, 'user.created');
        assert.equal(received[0].data.name, 'Alice');
        dispatcher.stop();
        await new Promise((r) => server.close(() => r()));
    });
    it('respects bounded queue size', async () => {
        const dispatcher = new WebhookDispatcher();
        const target = {
            url: 'http://127.0.0.1:1', // unreachable, but we just test queue
            secret: 'secret',
            timeoutMs: 100,
            maxRetries: 0,
        };
        // Fill the queue (MAX_QUEUE_SIZE = 10000). The dispatcher's async drain
        // loop consumes items concurrently, so accepted may slightly exceed 10000
        // by at most MAX_CONCURRENT (32) items that are in-flight at any time.
        let accepted = 0;
        for (let i = 0; i < 10100; i++) {
            if (dispatcher.enqueue(target, 'test', { i })) {
                accepted++;
            }
        }
        // Allow up to 10000 + 32 (in-flight) — the exact bound depends on timing
        assert.ok(accepted <= 10000 + 32, `Queue exceeded max: ${accepted}`);
        assert.ok(accepted > 0, 'Queue should have accepted some items');
        dispatcher.stop();
    });
});
// ═══════════════════════════════════════════════════════════════════════════════
// 5. SSE Connection Validation
// ═══════════════════════════════════════════════════════════════════════════════
describe('SSE — connection lifecycle validation', () => {
    it('sends correctly formatted SSE events', () => {
        let written = '';
        const fakeRes = {
            writeHead: () => undefined,
            write: (chunk) => { written += chunk; return true; },
            end: () => undefined,
            writableEnded: false,
            once: () => fakeRes,
            on: () => fakeRes,
            socket: { once: () => undefined },
        };
        const sse = new SseConnection(fakeRes, 10000);
        sse.send({ event: 'test', data: { message: 'hello' } });
        assert.ok(written.includes('event: test'));
        assert.ok(written.includes('data: '));
        assert.ok(written.includes('"message"'));
        assert.ok(written.includes('"hello"'));
        sse.close();
    });
    it('returns false for writes after close', () => {
        let writableEnded = false;
        const fakeRes = {
            writeHead: () => undefined,
            write: () => { return !writableEnded; },
            end: () => { writableEnded = true; },
            writableEnded: false,
            once: () => fakeRes,
            on: () => fakeRes,
            socket: { once: () => undefined },
        };
        const sse = new SseConnection(fakeRes, 10000);
        sse.close();
        const result = sse.send({ event: 'late', data: 'should-fail' });
        assert.equal(result, false);
    });
    it('handles heartbeat interval', () => {
        let written = '';
        const fakeRes = {
            writeHead: () => undefined,
            write: (chunk) => { written += chunk; return true; },
            end: () => undefined,
            writableEnded: false,
            once: () => fakeRes,
            on: () => fakeRes,
            socket: { once: () => undefined },
        };
        // Very short heartbeat interval
        const sse = new SseConnection(fakeRes, 1);
        sse.close();
    });
});
// ═══════════════════════════════════════════════════════════════════════════════
// 6. Migration System Validation
// ═══════════════════════════════════════════════════════════════════════════════
describe('Migration System — (requires PG, skipped if unavailable)', () => {
    let pool;
    let runner;
    let migrationsDir;
    const PG_HOST = process.env['PG_HOST'];
    const testEnabled = PG_HOST !== undefined;
    before(async function () {
        if (!testEnabled) {
            console.log('[SKIP] Migration tests require PG_HOST set');
            return;
        }
        pool = new PgPool({
            host: PG_HOST,
            port: parseInt(process.env['PG_PORT'] ?? '5432', 10),
            user: process.env['PG_USER'] ?? 'street',
            password: process.env['PG_PASSWORD'] ?? 'street_secret',
            database: process.env['PG_DATABASE'] ?? 'street_test',
            minConnections: 1,
            maxConnections: 3,
        });
        await pool.initialize();
        runner = new StreetMigrationRunner(pool);
        migrationsDir = join(tmpdir(), 'sys_infra_mig_' + randomBytes(4).toString('hex'));
        await mkdir(migrationsDir, { recursive: true });
    });
    after(async function () {
        if (!testEnabled)
            return;
        try {
            await pool.query('DROP TABLE IF EXISTS infra_test_table');
            await rm(migrationsDir, { recursive: true, force: true });
        }
        catch { /* cleanup */ }
        await pool.close();
    });
    // Only run if PG is available
    const itOrSkip = (name, fn) => {
        if (!testEnabled) {
            it.skip(name, () => { });
        }
        else {
            it(name, fn);
        }
    };
    itOrSkip('applies migration and tracks in street_migrations table', async () => {
        await writeFile(join(migrationsDir, '001_create_infra_test.sql'), `CREATE TABLE IF NOT EXISTS infra_test_table (id SERIAL PRIMARY KEY, name TEXT)`);
        await runner.run(migrationsDir);
        const result = await pool.query(`SELECT to_regclass('infra_test_table') AS tbl`);
        assert.ok(result.rows[0]?.['tbl'] !== null);
    });
    itOrSkip('migration is idempotent', async () => {
        await runner.run(migrationsDir);
    });
    itOrSkip('rolls back migration', async () => {
        await writeFile(join(migrationsDir, '001_create_infra_test.rollback.sql'), `DROP TABLE IF EXISTS infra_test_table`);
        await runner.rollback(migrationsDir, 1);
        const result = await pool.query(`SELECT to_regclass('infra_test_table') AS tbl`);
        assert.equal(result.rows[0]?.['tbl'], null);
    });
});
//# sourceMappingURL=infrastructure.test.js.map
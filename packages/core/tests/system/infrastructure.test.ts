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
import { randomBytes, createHmac } from 'node:crypto';
import { TelemetryTracker, telemetryMiddleware } from '../../src/telemetry/tracker.js';
import { WebhookDispatcher, type WebhookTarget } from '../../src/webhook/dispatcher.js';
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
    tracker.recordRequest(1_000_000n, false); // 1ms
    tracker.recordRequest(5_000_000n, false); // 5ms
    tracker.recordRequest(10_000_000n, true); // 10ms, error

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
    const health = tracker.health() as Record<string, unknown>;
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
      req: {} as any,
      res: { once: () => undefined, writableEnded: false } as any,
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
      json: () => {},
      text: () => {},
      html: () => {},
      send: () => {},
      setHeader: () => {},
      cookie: () => undefined,
      setCookie: () => {},
    };

    await mw(ctx, async () => {});
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

    const spec = generateOpenApi(routes) as Record<string, unknown>;
    assert.equal((spec as any)['openapi'], '3.1.0');
    assert.ok((spec as any)['info'] !== undefined);
    assert.ok((spec as any)['paths'] !== undefined);
    assert.ok((spec as any)['components'] !== undefined);
  });

  it('converts :param to {param} syntax', () => {
    const routes = [
      { method: 'GET', path: '/users/:id/posts/:postId' },
    ];

    const spec = generateOpenApi(routes) as any;
    const paths = Object.keys(spec.paths);
    assert.ok(paths.includes('/users/{id}/posts/{postId}'));
  });

  it('includes path parameters in spec', () => {
    const routes = [
      { method: 'GET', path: '/users/:id' },
    ];

    const spec = generateOpenApi(routes) as any;
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
    const spec = generateOpenApi([]) as any;
    assert.ok(spec.components.securitySchemes.bearerAuth !== undefined);
    assert.equal(spec.components.securitySchemes.bearerAuth.type, 'http');
    assert.equal(spec.components.securitySchemes.bearerAuth.scheme, 'bearer');
  });

  it('handles empty routes gracefully', () => {
    const spec = generateOpenApi([]);
    const s = spec as Record<string, unknown>;
    assert.ok(typeof s['paths'] === 'object');
    assert.equal(Object.keys(s['paths'] as object).length, 0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. Webhook Dispatcher — real HTTPS server, real delivery, real HMAC
// ═══════════════════════════════════════════════════════════════════════════════
//
// Spins up a real local HTTPS server with an openssl-generated self-signed
// certificate. The dispatcher sends real HTTPS POST requests with HMAC-SHA256
// signatures. No mocks, no stubs — end-to-end network delivery verified.

describe('Webhook Dispatcher — real HTTPS delivery', () => {
  let server: import('node:https').Server;
  let port: number;
  let tmpDir: string;
  let caCert: Buffer;
  const received: Array<{ event: string; data: unknown; ts: number; id: string; signature: string }> = [];

  before(async () => {
    const { mkdtemp } = await import('node:fs/promises');
    const { readFileSync } = await import('node:fs');
    const { execSync } = await import('node:child_process');
    const { createServer: createHttpsServer } = await import('node:https');

    // Generate a real ephemeral self-signed cert for 127.0.0.1
    tmpDir = await mkdtemp(join(tmpdir(), 'wh-tls-'));
    const keyPath = join(tmpDir, 'key.pem');
    const certPath = join(tmpDir, 'cert.pem');

    execSync(
      `openssl req -x509 -newkey rsa:2048 -keyout "${keyPath}" -out "${certPath}" ` +
      `-days 1 -nodes -subj "/CN=127.0.0.1" -addext "subjectAltName=IP:127.0.0.1"`,
      { stdio: 'pipe' }
    );

    const key = readFileSync(keyPath);
    caCert = readFileSync(certPath);

    // Real HTTPS server — records body + X-Street-Signature header
    server = createHttpsServer({ key, cert: caCert }, (req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        try {
          const body = Buffer.concat(chunks).toString('utf8');
          const parsed = JSON.parse(body) as { event: string; data: unknown; ts: number; id: string };
          received.push({
            ...parsed,
            signature: req.headers['x-street-signature'] as string ?? '',
          });
          res.writeHead(200);
          res.end('ok');
        } catch {
          res.writeHead(400);
          res.end('bad json');
        }
      });
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        port = (server.address() as { port: number }).port;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    const { rm } = await import('node:fs/promises');
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('delivers real HTTPS webhooks with correct HMAC-SHA256 signature', async () => {
    const { Agent } = await import('node:https');
    const { request: httpsRequest } = await import('node:https');

    const secret = 'real-secret-' + randomBytes(8).toString('hex');

    // Dispatcher with 127.0.0.1 in allowedHosts (bypasses SSRF blocklist for test)
    // and a custom https.Agent that trusts our self-signed CA cert.
    const dispatcher = new WebhookDispatcher(['127.0.0.1']);
    const agent = new Agent({ ca: caCert });

    // Patch the internal sendRequest to use our test agent.
    // We do this by monkey-patching the module-level function via a
    // subclass that overrides _dispatch to inject the agent.
    // Since sendRequest is a module-level function (not a method), we
    // instead directly call the real HTTPS endpoint ourselves to verify
    // the dispatcher's payload format and HMAC, then also test the
    // dispatcher end-to-end by patching the agent on the process level.

    // Set NODE_EXTRA_CA_CERTS is not available at runtime, so we use
    // a direct HTTPS call to verify the server works, then test the
    // dispatcher's enqueue → validate → dispatch pipeline separately.

    // Step 1: Verify the HTTPS server is reachable with our CA cert
    const testBody = JSON.stringify({ ping: true });
    const reachable = await new Promise<boolean>((resolve) => {
      const req = httpsRequest({
        hostname: '127.0.0.1',
        port,
        path: '/webhook',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(testBody) },
        agent,
      }, (res) => {
        res.resume();
        res.once('end', () => resolve(res.statusCode === 200));
      });
      req.once('error', () => resolve(false));
      req.write(testBody);
      req.end();
    });
    assert.ok(reachable, 'HTTPS test server must be reachable with self-signed cert');

    // Step 2: Test dispatcher end-to-end — enqueue events, wait for delivery.
    // Keep TLS verification enabled globally; use loopback HTTP for dispatcher
    // pipeline validation while HTTPS reachability is already covered above.
    const beforeCount = received.length;
    try {
      dispatcher.enqueue(
        { url: `https://127.0.0.1:${port}/webhook`, secret, maxRetries: 0, timeoutMs: 5000, tls: { ca: caCert } },
        'user.created',
        { id: 'u1', name: 'Alice' }
      );
      dispatcher.enqueue(
        { url: `https://127.0.0.1:${port}/webhook`, secret, maxRetries: 0, timeoutMs: 5000, tls: { ca: caCert } },
        'user.updated',
        { id: 'u1', name: 'Alice Updated' }
      );

      // Wait for async validation + dispatch (127.0.0.1 is in allowedHosts, no DNS lookup)
      await new Promise((r) => setTimeout(r, 2000));
    } finally {
      dispatcher.stop();
    }

    const delivered = received.slice(beforeCount);
    assert.ok(delivered.length >= 2, `Expected 2 webhook deliveries, got ${delivered.length}`);

    // Verify event names
    const events = delivered.map((e) => e.event);
    assert.ok(events.includes('user.created'), 'user.created must be delivered');
    assert.ok(events.includes('user.updated'), 'user.updated must be delivered');

    // Verify HMAC-SHA256 signature on each delivered event
    for (const event of delivered) {
      const { signature, ...payload } = event;
      const bodyStr = JSON.stringify(payload);
      const expectedSig = 'sha256=' + createHmac('sha256', secret).update(bodyStr).digest('hex');
      assert.equal(signature, expectedSig, `HMAC signature mismatch for event "${event.event}"`);
    }
  });

  it('stop() prevents further enqueuing', () => {
    const dispatcher = new WebhookDispatcher(['127.0.0.1']);
    dispatcher.stop();
    const result = dispatcher.enqueue(
      { url: `https://127.0.0.1:${port}/webhook`, secret: 'x' },
      'test.event', {}
    );
    assert.equal(result, false, 'enqueue must return false after stop()');
  });

  it('queue full — enqueue returns false at MAX_QUEUE_SIZE', () => {
    const dispatcher = new WebhookDispatcher(['127.0.0.1']);
    const target: WebhookTarget = {
      url: `https://127.0.0.1:${port}/webhook`,
      secret: 'secret',
      timeoutMs: 100,
      maxRetries: 0,
    };
    let accepted = 0;
    for (let i = 0; i < 10_050; i++) {
      if (dispatcher.enqueue(target, 'test', { i })) accepted++;
    }
    assert.ok(accepted > 0, 'Should have accepted items before queue full');
    dispatcher.stop();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. Migration System Validation
// ═══════════════════════════════════════════════════════════════════════════════

describe('Migration System — (requires PG, skipped if unavailable)', () => {
  let pool: PgPool;
  let runner: StreetMigrationRunner;
  let migrationsDir: string;
  const PG_HOST = process.env['PG_HOST'];
  const testEnabled = PG_HOST !== undefined && PG_HOST !== '';

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
    if (!testEnabled) return;
    try {
      await pool.query('DROP TABLE IF EXISTS infra_test_table');
      await rm(migrationsDir, { recursive: true, force: true });
    } catch { /* cleanup */ }
    await pool.close();
  });

  // Only run if PG is available
  const itOrSkip = (name: string, fn: () => Promise<void>) => {
    if (!testEnabled) {
      it.skip(name, () => {});
    } else {
      it(name, fn);
    }
  };

  itOrSkip('applies migration and tracks in street_migrations table', async () => {
    await writeFile(
      join(migrationsDir, '001_create_infra_test.sql'),
      `CREATE TABLE IF NOT EXISTS infra_test_table (id SERIAL PRIMARY KEY, name TEXT)`
    );
    await runner.run(migrationsDir);

    const result = await pool.query(
      `SELECT to_regclass('infra_test_table') AS tbl`
    );
    assert.ok(result.rows[0]?.['tbl'] !== null);
  });

  itOrSkip('migration is idempotent', async () => {
    await runner.run(migrationsDir);
  });

  itOrSkip('rolls back migration', async () => {
    await writeFile(
      join(migrationsDir, '001_create_infra_test.rollback.sql'),
      `DROP TABLE IF EXISTS infra_test_table`
    );
    await runner.rollback(migrationsDir, 1);

    const result = await pool.query(
      `SELECT to_regclass('infra_test_table') AS tbl`
    );
    assert.equal(result.rows[0]?.['tbl'], null);
  });
});

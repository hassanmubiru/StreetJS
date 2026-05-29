// tests/integration.test.ts
// Integration tests: IoC, PostgreSQL wire, repository,
// HTTP server, router, migrations, schema.
// Uses ONLY node:test and node:assert.

import 'reflect-metadata';
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { request as httpRequest } from 'node:http';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

// Framework imports
import { container, Container, Injectable } from '../src/core/container.js';
import { Controller, Get, Post } from '../src/core/decorators.js';
import { PgConnection } from '../src/database/wire.js';
import { PgPool } from '../src/database/pool.js';
import { StreetMigrationRunner } from '../src/database/migrations.js';
import { streetApp } from '../src/http/server.js';
import { createContext } from '../src/core/context.js';
import { Router } from '../src/router/router.js';
import { StreetPostgresRepository } from '../src/database/repository.js';

// ─── Test DB configuration ─────────────────────────────────────────────────────

const PG_OPTS = {
  host: process.env['PG_HOST'] ?? 'localhost',
  port: parseInt(process.env['PG_PORT'] ?? '5432', 10),
  user: process.env['PG_USER'] ?? 'street',
  password: process.env['PG_PASSWORD'] ?? 'street_secret',
  database: process.env['PG_DATABASE'] ?? 'street_test',
};

const TEST_TABLE = 'test_items_' + randomBytes(4).toString('hex');
const TEST_UPLOADS = join(tmpdir(), 'street_test_uploads_' + randomBytes(4).toString('hex'));

// ─── Helper: HTTP request ──────────────────────────────────────────────────────

function fetch(
  port: number,
  path: string,
  opts: { method?: string; body?: string; headers?: Record<string, string> } = {}
): Promise<{ status: number; body: string; headers: Record<string, string> }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: opts.method ?? 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...(opts.body ? { 'Content-Length': Buffer.byteLength(opts.body).toString() } : {}),
          ...(opts.headers ?? {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const headers: Record<string, string> = {};
          for (const [k, v] of Object.entries(res.headers)) {
            if (v !== undefined) headers[k] = Array.isArray(v) ? v[0]! : v;
          }
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
            headers,
          });
        });
        res.on('error', reject);
      }
    );
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

// ─── Suite 1: IoC Container ───────────────────────────────────────────────────

describe('IoC Container', () => {
  beforeEach(() => {
    container.reset();
  });

  it('resolves a class with no dependencies', () => {
    @Injectable()
    class NoDepService {
      greet(): string { return 'hello'; }
    }
    const inst = container.resolve(NoDepService);
    assert.equal(inst.greet(), 'hello');
  });

  it('resolves nested dependencies', () => {
    @Injectable()
    class DepA {
      value = 'A';
    }

    @Injectable()
    class DepB {
      constructor(public readonly a: DepA) {}
      value(): string { return 'B+' + this.a.value; }
    }

    const b = container.resolve(DepB);
    assert.equal(b.value(), 'B+A');
  });

  it('returns singleton on repeated resolve', () => {
    @Injectable()
    class SingletonService {
      id = Math.random();
    }
    const a = container.resolve(SingletonService);
    const b = container.resolve(SingletonService);
    assert.equal(a.id, b.id);
  });

  it('detects circular dependencies', () => {
    // We cannot actually create a real circular dep with TS decorators
    // but we can simulate via direct registration
    const c = Container.getInstance();
    assert.throws(
      () => {
        // Register a token that tries to resolve itself
        const fakeToken = class CircularA {} as unknown as new () => object;
        Reflect.defineMetadata('design:paramtypes', [fakeToken], fakeToken);
        c.resolve(fakeToken as new () => object);
      },
      /Circular dependency/
    );
  });

  it('register() overrides resolved singleton', () => {
    @Injectable()
    class OverrideService {
      val = 'original';
    }
    container.resolve(OverrideService); // creates original
    const mock = new OverrideService();
    mock.val = 'mocked';
    container.register(OverrideService, mock);
    assert.equal(container.resolve(OverrideService).val, 'mocked');
  });
});

// ─── Suite 2: Router ─────────────────────────────────────────────────────────

describe('Router', () => {
  it('matches a simple route and extracts params', async () => {
    const router = new Router();
    let captured: Record<string, string> = {};

    router.add('GET', '/users/:id', [], async (ctx) => {
      captured = ctx.params;
      ctx.json({ ok: true });
    });

    const ctx = makeMinimalCtx('127.0.0.1', 'GET', '/users/abc-123');
    const matched = await router.dispatch(ctx);
    assert.equal(matched, true);
    assert.equal(captured['id'], 'abc-123');
  });

  it('returns false for unmatched routes', async () => {
    const router = new Router();
    router.add('GET', '/only-this', [], async (ctx) => ctx.json({}));
    const ctx = makeMinimalCtx('127.0.0.1', 'GET', '/other-path');
    const matched = await router.dispatch(ctx);
    assert.equal(matched, false);
  });

  it('runs middleware pipeline in order', async () => {
    const router = new Router();
    const order: number[] = [];

    router.add(
      'POST',
      '/test',
      [
        async (_ctx: import('../src/core/context.js').StreetContext, next: () => Promise<void>) => { order.push(1); await next(); order.push(3); },
        async (_ctx: import('../src/core/context.js').StreetContext, next: () => Promise<void>) => { order.push(2); await next(); },
      ],
      async (_ctx) => { order.push(4); }
    );

    const ctx = makeMinimalCtx('127.0.0.1', 'POST', '/test');
    await router.dispatch(ctx);
    assert.deepEqual(order, [1, 2, 4, 3]);
  });

  it('validation middleware rejects bad input', async () => {
    const router = new Router();
    router.add(
      'POST',
      '/validate',
      [],
      async (ctx) => ctx.json({ ok: true }),
      { body: { email: { type: 'email', required: true } } }
    );

    const ctx = makeMinimalCtx('127.0.0.1', 'POST', '/validate');
    (ctx as unknown as Record<string, unknown>)['body'] = { email: 'not-an-email' };

    await assert.rejects(() => router.dispatch(ctx), /Validation failed/);
  });
});

// ─── Suite 3: HTTP Server ─────────────────────────────────────────────────────

describe('HTTP Server', () => {
  let port: number;
  let app: ReturnType<typeof streetApp>;

  before(async () => {
    port = 3100 + Math.floor(Math.random() * 900);
    app = streetApp({ port, uploadsDir: TEST_UPLOADS });

    @Injectable()
    @Controller('/test')
    class TestCtrl {
      @Get('/hello')
      async hello(ctx: import('../src/core/context.js').StreetContext): Promise<void> {
        ctx.json({ message: 'world' });
      }

      @Post('/echo')
      async echo(ctx: import('../src/core/context.js').StreetContext): Promise<void> {
        ctx.json({ received: ctx.body }, 201);
      }

      @Get('/error')
      async error(_ctx: import('../src/core/context.js').StreetContext): Promise<void> {
        throw new (await import('../src/http/exceptions.js')).NotFoundException('test not found');
      }
    }

    container.reset();
    app.registerController(TestCtrl);
    await app.listen(port);
  });

  after(async () => {
    await app.close();
  });

  it('GET returns JSON response', async () => {
    const res = await fetch(port, '/test/hello');
    assert.equal(res.status, 200);
    const body = JSON.parse(res.body) as { message: string };
    assert.equal(body.message, 'world');
  });

  it('POST parses JSON body and echoes it', async () => {
    const payload = { name: 'Alice', value: 42 };
    const res = await fetch(port, '/test/echo', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    assert.equal(res.status, 201);
    const body = JSON.parse(res.body) as { received: typeof payload };
    assert.equal(body.received.name, 'Alice');
  });

  it('returns 404 for unknown routes', async () => {
    const res = await fetch(port, '/does/not/exist');
    assert.equal(res.status, 404);
  });

  it('returns typed error responses', async () => {
    const res = await fetch(port, '/test/error');
    assert.equal(res.status, 404);
    const body = JSON.parse(res.body) as { error: string };
    assert.equal(body.error, 'NotFoundException');
  });

  it('sets content-type header', async () => {
    const res = await fetch(port, '/test/hello');
    assert.ok(res.headers['content-type']?.includes('application/json'));
  });
});

// ─── Suite 4: PostgreSQL Wire Driver ────────────────────────────────────────

describe('PostgreSQL Wire Protocol', () => {
  let conn: PgConnection;

  before(async () => {
    conn = await PgConnection.connect({ ...PG_OPTS, connectTimeoutMs: 10_000 });
  });

  after(async () => {
    await conn.close();
  });

  it('connects to PostgreSQL', () => {
    assert.equal(conn.isReady, true);
    assert.equal(conn.isClosed, false);
  });

  it('executes a simple query', async () => {
    const result = await conn.query('SELECT 1 AS val, 2 AS val2');
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0]?.['val'], '1');
    assert.equal(result.rows[0]?.['val2'], '2');
  });

  it('returns multiple rows', async () => {
    const result = await conn.query(
      `SELECT generate_series(1, 5) AS n`
    );
    assert.equal(result.rows.length, 5);
    assert.equal(result.rows[0]?.['n'], '1');
    assert.equal(result.rows[4]?.['n'], '5');
  });

  it('handles SQL errors gracefully', async () => {
    await assert.rejects(
      () => conn.query('SELECT * FROM table_that_does_not_exist_xyz'),
      /PostgreSQL/
    );
    // Connection should recover to ready state
    assert.equal(conn.isReady, true);
  });

  it('executes streaming query row by row', async () => {
    const stream = conn.queryStream('SELECT generate_series(1, 3) AS n');
    const rows: string[] = [];

    await new Promise<void>((resolve, reject) => {
      stream.on('data', (row: unknown) => {
        const r = row as Record<string, string | null>;
        rows.push(r['n'] ?? '');
      });
      stream.on('end', resolve);
      stream.on('error', reject);
    });

    assert.deepEqual(rows, ['1', '2', '3']);
  });
});

// ─── Suite 5: PgPool ────────────────────────────────────────────────────────

describe('PgPool', () => {
  let pool: PgPool;

  before(async () => {
    pool = new PgPool({ ...PG_OPTS, minConnections: 1, maxConnections: 3 });
    await pool.initialize();
  });

  after(async () => {
    await pool.close();
  });

  it('executes queries through pool', async () => {
    const result = await pool.query(`SELECT 'pool' AS src`);
    assert.equal(result.rows[0]?.['src'], 'pool');
  });

  it('runs transactions with COMMIT', async () => {
    await pool.query(`CREATE TEMP TABLE tx_test (val INT)`);
    await pool.transaction(async (conn) => {
      await conn.query('INSERT INTO tx_test VALUES (99)');
    });
    const r = await pool.query('SELECT val FROM tx_test');
    assert.equal(r.rows[0]?.['val'], '99');
    await pool.query('DROP TABLE tx_test');
  });

  it('rolls back on transaction error', async () => {
    await pool.query(`CREATE TEMP TABLE tx_rollback (val INT)`);
    try {
      await pool.transaction(async (conn) => {
        await conn.query('INSERT INTO tx_rollback VALUES (1)');
        throw new Error('forced rollback');
      });
    } catch { /* expected */ }
    const r = await pool.query('SELECT COUNT(*) AS c FROM tx_rollback');
    assert.equal(r.rows[0]?.['c'], '0');
    await pool.query('DROP TABLE tx_rollback');
  });

  it('handles concurrent queries', async () => {
    const results = await Promise.all([
      pool.query('SELECT 1 AS n'),
      pool.query('SELECT 2 AS n'),
      pool.query('SELECT 3 AS n'),
    ]);
    const values = results.map((r) => r.rows[0]?.['n']);
    assert.ok(values.includes('1'));
    assert.ok(values.includes('2'));
    assert.ok(values.includes('3'));
  });
});

// ─── Suite 6: Repository & Migrations ───────────────────────────────────────

describe('Repository & Migrations', () => {
  let pool: PgPool;
  let runner: StreetMigrationRunner;
  let migrationsDir: string;

  interface TestItem {
    id: string;
    name: string;
    value: string;
    created_at: string;
    updated_at: string;
  }

  class TestItemRepository extends StreetPostgresRepository<TestItem> {
    protected readonly tableName = TEST_TABLE;
    constructor(p: PgPool) { super(p); }
    protected mapRow(row: Record<string, string | null>): TestItem {
      return {
        id: row['id'] ?? '',
        name: row['name'] ?? '',
        value: row['value'] ?? '',
        created_at: row['created_at'] ?? '',
        updated_at: row['updated_at'] ?? '',
      };
    }
  }

  before(async () => {
    pool = new PgPool({ ...PG_OPTS, minConnections: 1, maxConnections: 3 });
    await pool.initialize();
    runner = new StreetMigrationRunner(pool);

    // Create temp migrations directory
    migrationsDir = join(tmpdir(), 'street_test_migrations_' + randomBytes(4).toString('hex'));
    await mkdir(migrationsDir, { recursive: true });

    // Write test migration
    await writeFile(
      join(migrationsDir, `001_create_${TEST_TABLE}.sql`),
      `CREATE TABLE IF NOT EXISTS ${TEST_TABLE} (
        id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name       VARCHAR(100) NOT NULL,
        value      TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`
    );

    await runner.run(migrationsDir);
  });

  after(async () => {
    await pool.query(`DROP TABLE IF EXISTS ${TEST_TABLE}`);
    await pool.query(`DELETE FROM street_migrations WHERE name LIKE $1`, [`%${TEST_TABLE}%`]);
    await rm(migrationsDir, { recursive: true, force: true });
    await pool.close();
  });

  it('migration creates table', async () => {
    const result = await pool.query(
      `SELECT to_regclass($1) AS tbl`, [TEST_TABLE]
    );
    assert.ok(result.rows[0]?.['tbl'] !== null);
  });

  it('migration is idempotent (skips on re-run)', async () => {
    // Should not throw on second run
    await runner.run(migrationsDir);
  });

  it('repository creates and finds by ID', async () => {
    const repo = new TestItemRepository(pool);
    const item = await repo.create({
      id: randomUUID(),
      name: 'Test Item',
      value: 'hello',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as Partial<TestItem>);

    assert.equal(item.name, 'Test Item');
    assert.ok(item.id);

    const found = await repo.findById(item.id);
    assert.ok(found);
    assert.equal(found!.name, 'Test Item');
  });

  it('repository updates a row', async () => {
    const repo = new TestItemRepository(pool);
    const item = await repo.create({
      id: randomUUID(),
      name: 'Original',
      value: 'v1',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as Partial<TestItem>);

    const updated = await repo.update(item.id, { name: 'Updated', value: 'v2' } as Partial<TestItem>);
    assert.ok(updated);
    assert.equal(updated!.name, 'Updated');
  });

  it('repository deletes a row', async () => {
    const repo = new TestItemRepository(pool);
    const item = await repo.create({
      id: randomUUID(),
      name: 'ToDelete',
      value: 'bye',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as Partial<TestItem>);

    const deleted = await repo.delete(item.id);
    assert.equal(deleted, true);

    const found = await repo.findById(item.id);
    assert.equal(found, null);
  });

  it('repository findAll returns paginated results', async () => {
    const repo = new TestItemRepository(pool);
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const id = randomUUID();
      ids.push(id);
      await repo.create({
        id,
        name: `Paginated-${i}`,
        value: String(i),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as Partial<TestItem>);
    }

    const page1 = await repo.findAll(3, 0);
    assert.equal(page1.length, 3);
    const page2 = await repo.findAll(3, 3);
    assert.ok(page2.length >= 2);
  });

  it('repository count returns correct total', async () => {
    const repo = new TestItemRepository(pool);
    const before = await repo.count();
    await repo.create({
      id: randomUUID(),
      name: 'CountTest',
      value: 'x',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as Partial<TestItem>);
    const after = await repo.count();
    assert.equal(after, before + 1);
  });
});

// ─── Suite 7: Schema Behavior ────────────────────────────────────────────────

describe('Schema: users table (via pool)', () => {
  let pool: PgPool;
  let migrationsDir: string;

  before(async () => {
    pool = new PgPool({ ...PG_OPTS, minConnections: 1, maxConnections: 3 });
    await pool.initialize();

    // Run the real users migration
    migrationsDir = resolve('./migrations');
    const runner = new StreetMigrationRunner(pool);
    await runner.run(migrationsDir);
  });

  after(async () => {
    // Clean up test users
    await pool.query(`DELETE FROM users WHERE email LIKE '%@streettest.local'`);
    await pool.close();
  });

  it('inserts and retrieves a user row', async () => {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, name, password_hash, roles)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [id, 'test@streettest.local', 'Test User', 'hashed', '["user"]']
    );

    const result = await pool.query(`SELECT * FROM users WHERE id = $1`, [id]);
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0]?.['email'], 'test@streettest.local');
    assert.equal(result.rows[0]?.['name'], 'Test User');
  });

  it('enforces unique email constraint', async () => {
    const email = `unique-${randomBytes(4).toString('hex')}@streettest.local`;
    await pool.query(
      `INSERT INTO users (id, email, name, password_hash)
       VALUES ($1, $2, $3, $4)`,
      [randomUUID(), email, 'A', 'h']
    );
    await assert.rejects(
      () => pool.query(
        `INSERT INTO users (id, email, name, password_hash)
         VALUES ($1, $2, $3, $4)`,
        [randomUUID(), email, 'B', 'h']
      ),
      /unique/i
    );
  });
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeMinimalCtx(
  ip: string,
  method = 'GET',
  path = '/'
): import('../src/core/context.js').StreetContext {
  const fakeReq = {
    method,
    url: path,
    headers: { 'x-forwarded-for': ip },
    socket: { remoteAddress: ip },
    on: () => fakeReq,
    once: () => fakeReq,
    pipe: () => fakeReq,
    resume: () => fakeReq,
    destroy: () => fakeReq,
  } as unknown as IncomingMessage;

  const fakeRes = {
    writeHead: () => undefined,
    write: () => true,
    end: () => undefined,
    setHeader: () => undefined,
    writableEnded: false,
    once: () => fakeRes,
    on: () => fakeRes,
    socket: { once: () => undefined },
  } as unknown as ServerResponse;

  const ctx = createContext(fakeReq, fakeRes, path, {});
  return ctx;
}

function randomUUID(): string {
  const bytes = randomBytes(16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// Provider + parser tests using real temporary fixture files (no mocks).
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createConfig,
  s,
  envProvider,
  parseYaml,
  parseToml,
  jsonFileProvider,
  ConfigParseError,
} from '../index.js';

describe('envProvider', () => {
  it('applies prefix, nesting, and camelCase; explicit map overrides', () => {
    const provider = envProvider({
      env: {
        APP_PORT: '8080',
        APP_DATABASE__POOL_SIZE: '20',
        APP_LOG_LEVEL: 'debug',
        OTHER: 'ignored',
        RAW_SECRET: 'shh',
      },
      prefix: 'APP_',
      map: { RAW_SECRET: 'database.password' },
    });
    const data = provider.load() as Record<string, unknown>;
    assert.equal(data.port, '8080');
    assert.equal(data.logLevel, 'debug');
    assert.deepEqual(data.database, { poolSize: '20', password: 'shh' });
    assert.equal('other' in data, false);
  });
});

describe('parseYaml (subset)', () => {
  it('parses maps, sequences, scalars, quotes, and inline flow', () => {
    const doc = parseYaml(`
# comment
server:
  host: db.internal
  port: 5432
  tags:
    - primary
    - "read-replica"
features: [a, b, c]
flags:
  debug: true
  ratio: 0.5
  note: "hello: world"
matrix:
  - name: n1
    weight: 1
  - name: n2
    weight: 2
empty:
`);
    assert.deepEqual(doc, {
      server: { host: 'db.internal', port: 5432, tags: ['primary', 'read-replica'] },
      features: ['a', 'b', 'c'],
      flags: { debug: true, ratio: 0.5, note: 'hello: world' },
      matrix: [
        { name: 'n1', weight: 1 },
        { name: 'n2', weight: 2 },
      ],
      empty: null,
    });
  });
});

describe('parseToml (subset)', () => {
  it('parses tables, dotted keys, scalars, arrays, and inline tables', () => {
    const doc = parseToml(`
# comment
title = "StreetJS"
retries = 3
ratio = 1.5
enabled = true

[database]
host = "localhost"
port = 5432
tags = ["a", "b"]

[database.pool]
min = 1
max = 10

server.timeout = 30
limits = { soft = 10, hard = 20 }
`);
    assert.deepEqual(doc, {
      title: 'StreetJS',
      retries: 3,
      ratio: 1.5,
      enabled: true,
      database: { host: 'localhost', port: 5432, tags: ['a', 'b'], pool: { min: 1, max: 10 } },
      server: { timeout: 30 },
      limits: { soft: 10, hard: 20 },
    });
  });
});

describe('file providers (real fixtures)', () => {
  let dir = '';
  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'streetjs-config-'));
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ port: 3000, database: { url: 'postgres://json/db' } }));
    writeFileSync(
      join(dir, 'config.yaml'),
      'port: 4000\ndatabase:\n  url: postgres://yaml/db\n  poolSize: 15\n',
    );
    writeFileSync(join(dir, 'config.toml'), 'port = 5000\n[database]\nurl = "postgres://toml/db"\n');
    writeFileSync(join(dir, 'broken.json'), '{ not: valid');
  });
  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const schema = {
    port: s.number({ integer: true }).default(1),
    database: { url: s.url({ protocols: ['postgres'] }), poolSize: s.number({ integer: true }).default(10) },
  } as const;

  it('loads JSON', async () => {
    const c = await createConfig({ environment: 'test' }).schema(schema).json(join(dir, 'config.json')).load();
    assert.equal(c.get('port'), 3000);
    assert.equal(c.get('database.url'), 'postgres://json/db');
  });

  it('loads YAML', async () => {
    const c = await createConfig({ environment: 'test' }).schema(schema).yaml(join(dir, 'config.yaml')).load();
    assert.equal(c.get('port'), 4000);
    assert.equal(c.get('database.poolSize'), 15);
  });

  it('loads TOML', async () => {
    const c = await createConfig({ environment: 'test' }).schema(schema).toml(join(dir, 'config.toml')).load();
    assert.equal(c.get('port'), 5000);
    assert.equal(c.get('database.url'), 'postgres://toml/db');
  });

  it('dispatches by extension via file() and layers file < env', async () => {
    const c = await createConfig({ env: { APP_PORT: '9000' }, environment: 'test' })
      .schema(schema)
      .file(join(dir, 'config.yaml'))
      .env({ prefix: 'APP_' })
      .load();
    assert.equal(c.get('port'), 9000); // env overrides file
    assert.equal(c.get('database.url'), 'postgres://yaml/db'); // from file
  });

  it('treats a missing optional file as empty', async () => {
    const c = await createConfig({ environment: 'test' })
      .schema(schema)
      .json(join(dir, 'does-not-exist.json'), { optional: true })
      .object({ database: { url: 'postgres://obj/db' } })
      .load();
    assert.equal(c.get('database.url'), 'postgres://obj/db');
  });

  it('throws ConfigParseError on malformed input', async () => {
    await assert.rejects(
      () => jsonFileProvider(join(dir, 'broken.json')).load(),
      (e: unknown) => e instanceof ConfigParseError && e.source.provider === 'json',
    );
  });
});

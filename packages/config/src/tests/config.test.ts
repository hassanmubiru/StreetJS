// End-to-end tests for createConfig: schema, loading, validation, merging,
// precedence, transforms, custom validators, immutability, reload, namespaces,
// secret masking, and serialization.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createConfig,
  s,
  ConfigValidationError,
  ConfigStateError,
  REDACTED,
} from '../index.js';

const baseSchema = {
  port: s.number({ integer: true, min: 1, max: 65535 }).default(3000),
  logLevel: s.enum(['debug', 'info', 'warn', 'error'] as const).default('info'),
  featureFlags: s.array(s.string()).default([]),
  database: {
    host: s.hostname().default('localhost'),
    port: s.number({ integer: true }).default(5432),
    url: s.url({ protocols: ['postgres', 'postgresql'] }).secret(),
    poolSize: s.number({ integer: true, min: 1 }).default(10),
  },
  timeout: s.duration().default(30_000),
  adminEmail: s.email().optional(),
} as const;

function build(env: Record<string, string | undefined>) {
  return createConfig({ env, environment: 'test' }).schema(baseSchema).env({ prefix: 'APP_' });
}

describe('successful loading + typed access', () => {
  it('resolves required, default, and provided values', async () => {
    const config = await build({
      APP_DATABASE__URL: 'postgres://u:p@db:5432/app',
      APP_PORT: '8080',
      APP_LOG_LEVEL: 'debug',
      APP_FEATURE_FLAGS: 'a,b,c',
    }).load();

    assert.equal(config.get('port'), 8080);
    assert.equal(config.get('logLevel'), 'debug');
    assert.deepEqual(config.get('featureFlags'), ['a', 'b', 'c']);
    assert.equal(config.get('database.host'), 'localhost'); // default
    assert.equal(config.get('database.poolSize'), 10); // default
    assert.equal(config.get('timeout'), 30000); // "30s" default → ms
    assert.equal(config.environment, 'test');
  });
});

describe('missing values', () => {
  it('throws an aggregated error when a required value is missing', async () => {
    await assert.rejects(
      () => build({}).load(),
      (e: unknown) => {
        assert.ok(e instanceof ConfigValidationError);
        const missing = e.issues.find((i) => i.key === 'database.url');
        assert.ok(missing, 'database.url should be reported missing');
        assert.equal(missing!.message, 'required configuration value is missing');
        assert.equal(missing!.expectedType, 'url');
        return true;
      },
    );
  });

  it('optional-absent value reads as undefined and has()=false', async () => {
    const config = await build({ APP_DATABASE__URL: 'postgres://x/db' }).load();
    assert.equal(config.get('adminEmail'), undefined);
    assert.equal(config.has('adminEmail'), false);
    assert.equal(config.metadata('adminEmail')?.present, false);
  });
});

describe('invalid values + error reporting', () => {
  it('aggregates every failing field with full diagnostics', async () => {
    await assert.rejects(
      () =>
        build({
          APP_DATABASE__URL: 'postgres://x/db',
          APP_PORT: '99999', // out of range
          APP_LOG_LEVEL: 'verbose', // not in enum
        }).load(),
      (e: unknown) => {
        assert.ok(e instanceof ConfigValidationError);
        const keys = e.issues.map((i) => i.key).sort();
        assert.deepEqual(keys, ['logLevel', 'port']);
        const port = e.issues.find((i) => i.key === 'port')!;
        assert.equal(port.expectedType, 'number <= 65535');
        assert.equal(port.invalidValue, '99999');
        assert.ok(port.source && port.source.provider === 'env');
        return true;
      },
    );
  });
});

describe('provider precedence + deep merging', () => {
  it('later providers override earlier ones, merging nested objects', async () => {
    const config = await createConfig({ environment: 'test' })
      .schema(baseSchema)
      .object({ port: 1000, database: { url: 'postgres://a/db', poolSize: 5 } }, 'defaults')
      .object({ port: 2000, database: { poolSize: 25 } }, 'override') // overrides port + poolSize, keeps url
      .load();

    assert.equal(config.get('port'), 2000);
    assert.equal(config.get('database.poolSize'), 25);
    assert.equal(config.get('database.url'), 'postgres://a/db'); // merged, not lost
    assert.equal(config.metadata('database.poolSize')?.source?.provider, 'override');
    assert.equal(config.metadata('database.url')?.source?.provider, 'defaults');
  });
});

describe('transforms + custom validators', () => {
  it('applies transform and custom checks', async () => {
    const schema = {
      name: s.string().transform((v) => v.toUpperCase()),
      even: s.number({ integer: true }).check((n) => (n % 2 === 0 ? true : 'must be even')),
      hex: s.custom<number>((raw) =>
        typeof raw === 'string' && /^0x[0-9a-f]+$/i.test(raw)
          ? { ok: true, value: parseInt(raw, 16) }
          : { ok: false, expected: 'hex string', message: 'not a hex string' },
      ),
    };
    const config = await createConfig({ environment: 'test' })
      .schema(schema)
      .object({ name: 'streetjs', even: 4, hex: '0xff' })
      .load();
    assert.equal(config.get('name'), 'STREETJS');
    assert.equal(config.get('even'), 4);
    assert.equal(config.get('hex'), 255);

    await assert.rejects(
      () => createConfig({ environment: 'test' }).schema(schema).object({ name: 'x', even: 3, hex: '0x1' }).load(),
      (e: unknown) => e instanceof ConfigValidationError && e.issues[0]!.message === 'must be even',
    );
  });
});

describe('strict mode', () => {
  it('rejects unknown keys when strict', async () => {
    await assert.rejects(
      () =>
        createConfig({ environment: 'test', strict: true })
          .schema({ a: s.string().default('x') })
          .object({ a: 'y', unexpected: 'z' })
          .load(),
      (e: unknown) => e instanceof ConfigValidationError && e.issues.some((i) => i.key === 'unexpected'),
    );
  });
});

describe('immutability', () => {
  it('freezes resolved values (mutation throws in strict mode)', async () => {
    const config = await build({ APP_DATABASE__URL: 'postgres://x/db' }).load();
    assert.equal(config.isFrozen, true);
    const flags = config.get('featureFlags') as string[];
    assert.throws(() => {
      (flags as string[]).push('x');
    }, TypeError);
  });
});

describe('reload behavior', () => {
  it('is disabled by default and enabled via option', async () => {
    const disabled = await build({ APP_DATABASE__URL: 'postgres://x/db' }).load();
    await assert.rejects(() => disabled.reload(), (e: unknown) => e instanceof ConfigStateError);

    const mutableEnv: Record<string, string | undefined> = { APP_DATABASE__URL: 'postgres://x/db', APP_PORT: '3000' };
    const reloadable = await createConfig({ env: mutableEnv, environment: 'test', reloadable: true })
      .schema(baseSchema)
      .env({ prefix: 'APP_' })
      .load();
    assert.equal(reloadable.get('port'), 3000);
    mutableEnv.APP_PORT = '4000';
    await reloadable.reload();
    assert.equal(reloadable.get('port'), 4000);
  });

  it('keeps the current snapshot when reload validation fails', async () => {
    const mutableEnv: Record<string, string | undefined> = { APP_DATABASE__URL: 'postgres://x/db', APP_PORT: '3000' };
    const config = await createConfig({ env: mutableEnv, environment: 'test', reloadable: true })
      .schema(baseSchema)
      .env({ prefix: 'APP_' })
      .load();
    mutableEnv.APP_PORT = '99999'; // invalid
    await assert.rejects(() => config.reload(), (e: unknown) => e instanceof ConfigValidationError);
    assert.equal(config.get('port'), 3000); // unchanged
  });
});

describe('namespaces', () => {
  it('scopes reads and nests', async () => {
    const config = await build({ APP_DATABASE__URL: 'postgres://x/db', APP_DATABASE__POOL_SIZE: '7' }).load();
    const db = config.namespace('database');
    assert.equal(db.get('poolSize'), 7);
    assert.equal(db.has('url'), true);
    assert.ok(db.keys().includes('poolSize'));
    assert.equal(db.metadata('poolSize')?.key, 'poolSize');
  });
});

describe('secret masking', () => {
  it('masks secrets in serialize/toJSON and redacts them in errors', async () => {
    const config = await build({ APP_DATABASE__URL: 'postgres://user:pw@db/app' }).load();
    const json = config.toJSON() as { database: { url: string } };
    assert.equal(json.database.url, '********');
    assert.ok(!config.serialize().includes('pw@db'));
    assert.ok(config.serialize({ includeSecrets: true }).includes('pw@db'));

    // Errors never reveal a secret's value.
    await assert.rejects(
      () => build({ APP_DATABASE__URL: 'ftp://bad' }).load(),
      (e: unknown) => {
        assert.ok(e instanceof ConfigValidationError);
        const issue = e.issues.find((i) => i.key === 'database.url')!;
        assert.equal(issue.secret, true);
        assert.equal(issue.invalidValue, REDACTED);
        assert.ok(!e.message.includes('ftp://bad'));
        return true;
      },
    );
  });
});

describe('serialization formats', () => {
  it('produces json and flat output', async () => {
    const config = await build({ APP_DATABASE__URL: 'postgres://x/db', APP_PORT: '8080' }).load();
    const json = JSON.parse(config.serialize({ format: 'json' })) as { port: number };
    assert.equal(json.port, 8080);
    const flat = config.serialize({ format: 'flat' });
    assert.ok(flat.includes('port=8080'));
    assert.ok(flat.includes('database.url=********'));
  });
});

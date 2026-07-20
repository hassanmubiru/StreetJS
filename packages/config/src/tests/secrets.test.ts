// packages/config/src/tests/secrets.test.ts
// Secret resolution, caching, rotation, audit, and the config bridge.
// Fully offline — all providers are injected.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  SecretStore,
  SecretNotFoundError,
  envSecretProvider,
  memorySecretProvider,
  fileSecretProvider,
  secretsProvider,
  createConfig,
  s,
  type SecretProvider,
} from '../index.js';

describe('secret providers', () => {
  it('envSecretProvider reads from an env map with an optional prefix', async () => {
    const p = envSecretProvider({ env: { APP_DB: 'pw', OTHER: 'x' }, prefix: 'APP_' });
    assert.equal(await p.get('DB'), 'pw');
    assert.equal(await p.get('MISSING'), undefined);
  });

  it('memorySecretProvider resolves only own properties', async () => {
    const p = memorySecretProvider({ token: 'abc' });
    assert.equal(await p.get('token'), 'abc');
    assert.equal(await p.get('toString'), undefined); // not an own prop
  });

  it('fileSecretProvider reads <dir>/<key> via the injected reader', async () => {
    const files: Record<string, string> = { '/run/secrets/db': 'filepw' };
    const p = fileSecretProvider('/run/secrets', { read: async (path) => files[path] });
    assert.equal(await p.get('db'), 'filepw');
    assert.equal(await p.get('nope'), undefined);
    // Trailing separator on dir is normalized.
    const p2 = fileSecretProvider('/run/secrets/', { read: async (path) => files[path] });
    assert.equal(await p2.get('db'), 'filepw');
  });
});

describe('SecretStore', () => {
  it('requires at least one provider', () => {
    assert.throws(() => new SecretStore({ providers: [] }), /at least one provider/);
  });

  it('resolves across providers in order (first hit wins)', async () => {
    const store = new SecretStore({
      providers: [memorySecretProvider({ a: '1' }, 'p1'), memorySecretProvider({ a: '2', b: '3' }, 'p2')],
    });
    assert.equal(await store.get('a'), '1'); // p1 wins
    assert.equal(await store.get('b'), '3'); // falls through to p2
  });

  it('throws SecretNotFoundError for a required missing secret', async () => {
    const store = new SecretStore({ providers: [memorySecretProvider({})] });
    await assert.rejects(() => store.get('nope'), SecretNotFoundError);
    assert.equal(await store.getOptional('nope'), undefined);
    assert.equal(await store.has('nope'), false);
  });

  it('caches values and refetches only after rotate() or TTL', async () => {
    let calls = 0;
    let current = 'v1';
    const provider: SecretProvider = { name: 'counting', get: () => { calls += 1; return current; } };
    const store = new SecretStore({ providers: [provider] });

    assert.equal(await store.get('k'), 'v1');
    assert.equal(await store.get('k'), 'v1');
    assert.equal(calls, 1, 'second read served from cache');

    // Rotate the underlying value; without rotate() the cache still serves v1.
    current = 'v2';
    assert.equal(await store.get('k'), 'v1');
    assert.equal(calls, 1);

    store.rotate('k');
    assert.equal(await store.get('k'), 'v2');
    assert.equal(calls, 2, 'rotate forced a refetch');
  });

  it('honors a TTL with an injected clock', async () => {
    let calls = 0;
    let t = 1000;
    const provider: SecretProvider = { name: 'c', get: () => { calls += 1; return 'v'; } };
    const store = new SecretStore({ providers: [provider], ttlMs: 500, now: () => t });

    await store.get('k');
    t = 1200; // within TTL
    await store.get('k');
    assert.equal(calls, 1);
    t = 1600; // past TTL (1600 - 1000 >= 500)
    await store.get('k');
    assert.equal(calls, 2);
  });

  it('rotate() notifies listeners; onRotate returns an unsubscribe', async () => {
    const store = new SecretStore({ providers: [memorySecretProvider({ k: 'v' })] });
    const seen: Array<string | undefined> = [];
    const off = store.onRotate((key) => seen.push(key));

    store.rotate('k');
    store.rotate(); // all
    assert.deepEqual(seen, ['k', undefined]);

    off();
    store.rotate('again');
    assert.deepEqual(seen, ['k', undefined], 'no more notifications after unsubscribe');
  });

  it('invokes the access-audit hook on every resolve', async () => {
    const accessed: string[] = [];
    const store = new SecretStore({
      providers: [memorySecretProvider({ k: 'v' })],
      onAccess: (key) => accessed.push(key),
    });
    await store.get('k');
    await store.get('k'); // cached, but audit still fires
    await store.getOptional('missing');
    assert.deepEqual(accessed, ['k', 'k', 'missing']);
  });

  it('clearCache drops cached values without notifying listeners', async () => {
    let calls = 0;
    const store = new SecretStore({ providers: [{ name: 'c', get: () => { calls += 1; return 'v'; } }] });
    const seen: unknown[] = [];
    store.onRotate(() => seen.push(1));
    await store.get('k');
    store.clearCache();
    await store.get('k');
    assert.equal(calls, 2);
    assert.deepEqual(seen, []);
  });
});

describe('secretsProvider (config bridge)', () => {
  it('flows resolved secrets into typed config at dotted paths', async () => {
    const store = new SecretStore({
      providers: [memorySecretProvider({ DB_PASSWORD: 's3cr3t', API_KEY: 'ak' })],
    });
    const config = await createConfig()
      .schema({
        database: { password: s.string().secret() },
        apiKey: s.string().secret(),
      })
      .provider(secretsProvider(store, { 'database.password': 'DB_PASSWORD', apiKey: 'API_KEY' }))
      .load();

    assert.equal(config.get('database.password'), 's3cr3t');
    assert.equal(config.get('apiKey'), 'ak');
    // Secret masking still applies in serialization.
    assert.ok(!config.serialize().includes('s3cr3t'));
  });

  it('skips missing optional secrets and fails on required missing ones', async () => {
    const store = new SecretStore({ providers: [memorySecretProvider({})] });
    // Optional: missing secret is simply absent from the produced object.
    const provider = secretsProvider(store, { 'a.b': 'MISSING' });
    assert.deepEqual(await provider.load(), {});
    // Required: load throws SecretNotFoundError.
    const strict = secretsProvider(store, { 'a.b': 'MISSING' }, { required: true });
    await assert.rejects(() => strict.load(), SecretNotFoundError);
  });
});

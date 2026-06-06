// tests/secret-providers.test.ts
// Contract tests for the cloud secret providers using a local mock HTTP server
// harness. Because real cloud credentials are unavailable in CI, each provider
// is pointed at an in-process http.Server that emulates the relevant API
// (Vault KV v2, AWS Secrets Manager, Azure Key Vault, GCP Secret Manager).
//
// These tests verify the production behaviours that matter regardless of the
// backend: caching within TTL (no extra network calls), re-fetch after TTL
// expiry, `[REDACTED]` in error messages, request shape / auth headers, and the
// SecretRotationManager rotate event + onRotate callback.

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import {
  VaultSecretProvider,
  AwsSecretsManagerProvider,
  AzureKeyVaultProvider,
  GcpSecretManagerProvider,
  SecretRotationManager,
} from '../cloud/secret-providers.js';

// ── Mock server harness ─────────────────────────────────────────────────────

interface RecordedRequest { method: string; url: string; headers: Record<string, string | string[] | undefined>; body: string; }

class MockServer {
  readonly requests: RecordedRequest[] = [];
  private server: Server;
  private handler: (req: RecordedRequest, res: ServerResponse) => void = () => {};
  port = 0;

  constructor() {
    this.server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const rec: RecordedRequest = {
          method: req.method ?? 'GET',
          url: req.url ?? '/',
          headers: req.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        };
        this.requests.push(rec);
        this.handler(rec, res);
      });
    });
  }

  async listen(): Promise<void> {
    this.server.listen(0, '127.0.0.1');
    await once(this.server, 'listening');
    const addr = this.server.address();
    if (addr && typeof addr === 'object') this.port = addr.port;
  }

  get baseUrl(): string { return `http://127.0.0.1:${this.port}`; }
  onRequest(fn: (req: RecordedRequest, res: ServerResponse) => void): void { this.handler = fn; }
  reset(): void { this.requests.length = 0; }
  async close(): Promise<void> { this.server.close(); await once(this.server, 'close').catch(() => undefined); }
}

function json(res: ServerResponse, status: number, obj: unknown): void {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(body);
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Secret providers (contract tests against mock server)', () => {
  let mock: MockServer;

  before(async () => { mock = new MockServer(); await mock.listen(); });
  after(async () => { await mock.close(); });
  beforeEach(() => { mock.reset(); });

  // ── Vault ──
  it('VaultSecretProvider reads a KV v2 secret and sends the Vault token header', async () => {
    mock.onRequest((req, res) => {
      assert.equal(req.headers['x-vault-token'], 'test-token');
      assert.match(req.url, /^\/v1\/secret\/data\/db-password$/);
      json(res, 200, { data: { data: { 'db-password': 'super-secret' } } });
    });
    const provider = new VaultSecretProvider({ endpoint: mock.baseUrl, token: 'test-token' });
    assert.equal(await provider.get('db-password'), 'super-secret');
  });

  it('VaultSecretProvider serves from cache within TTL (no second network call)', async () => {
    mock.onRequest((_req, res) => json(res, 200, { data: { data: { k: 'v1' } } }));
    const provider = new VaultSecretProvider({ endpoint: mock.baseUrl, token: 't', cacheTtlMs: 10_000 });
    await provider.get('k');
    await provider.get('k');
    await provider.get('k');
    assert.equal(mock.requests.length, 1, 'only one fetch within TTL');
  });

  it('VaultSecretProvider re-fetches after the cache TTL expires', async () => {
    let n = 0;
    mock.onRequest((_req, res) => { n += 1; json(res, 200, { data: { data: { k: `v${n}` } } }); });
    const provider = new VaultSecretProvider({ endpoint: mock.baseUrl, token: 't', cacheTtlMs: 30 });
    assert.equal(await provider.get('k'), 'v1');
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(await provider.get('k'), 'v2');
    assert.equal(mock.requests.length, 2);
  });

  it('VaultSecretProvider error message redacts the secret value on non-200', async () => {
    mock.onRequest((_req, res) => json(res, 403, { errors: ['permission denied'] }));
    const provider = new VaultSecretProvider({ endpoint: mock.baseUrl, token: 't' });
    await assert.rejects(provider.get('nope'), (e: Error) => /\[REDACTED\]/.test(e.message) && /403/.test(e.message));
  });

  // ── AWS ──
  it('AwsSecretsManagerProvider signs with SigV4 and parses SecretString', async () => {
    mock.onRequest((req, res) => {
      assert.equal(req.headers['x-amz-target'], 'secretsmanager.GetSecretValue');
      const auth = String(req.headers['authorization'] ?? '');
      assert.match(auth, /^AWS4-HMAC-SHA256 Credential=/);
      assert.match(auth, /SignedHeaders=content-type;host;x-amz-date;x-amz-target/);
      assert.match(auth, /Signature=[0-9a-f]{64}/);
      const parsed = JSON.parse(req.body) as { SecretId: string };
      json(res, 200, { SecretString: `value-for-${parsed.SecretId}` });
    });
    const provider = new AwsSecretsManagerProvider({
      region: 'us-east-1', accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secret',
      endpoint: mock.baseUrl,
    });
    assert.equal(await provider.get('prod/db'), 'value-for-prod/db');
  });

  it('AwsSecretsManagerProvider redacts the body in error messages', async () => {
    mock.onRequest((_req, res) => json(res, 400, { __type: 'ResourceNotFoundException' }));
    const provider = new AwsSecretsManagerProvider({
      region: 'us-east-1', accessKeyId: 'AKID', secretAccessKey: 's', endpoint: mock.baseUrl,
    });
    await assert.rejects(provider.get('missing'), (e: Error) => /\[REDACTED\]/.test(e.message));
  });

  // ── Azure ──
  it('AzureKeyVaultProvider retrieves a secret with a bearer token and api-version', async () => {
    mock.onRequest((req, res) => {
      assert.equal(req.headers['authorization'], 'Bearer azure-access-token');
      assert.match(req.url, /^\/secrets\/conn-string\?api-version=7\.4$/);
      json(res, 200, { value: 'azure-secret-value', id: `${mock.baseUrl}/secrets/conn-string/abc` });
    });
    const provider = new AzureKeyVaultProvider({ vaultUrl: mock.baseUrl, accessToken: 'azure-access-token' });
    assert.equal(await provider.get('conn-string'), 'azure-secret-value');
  });

  it('AzureKeyVaultProvider uses a tokenProvider and caches the token', async () => {
    let tokenCalls = 0;
    mock.onRequest((req, res) => {
      assert.equal(req.headers['authorization'], 'Bearer dynamic-token');
      json(res, 200, { value: 'v' });
    });
    const provider = new AzureKeyVaultProvider({
      vaultUrl: mock.baseUrl,
      tokenProvider: async () => { tokenCalls += 1; return { token: 'dynamic-token', expiresAt: Date.now() + 3_600_000 }; },
    });
    await provider.get('a');
    await provider.get('b'); // different key → bypasses secret cache but reuses the token
    assert.equal(tokenCalls, 1, 'token fetched once and reused');
  });

  it('AzureKeyVaultProvider redacts the value in error messages on non-200', async () => {
    mock.onRequest((_req, res) => json(res, 404, { error: { code: 'SecretNotFound' } }));
    const provider = new AzureKeyVaultProvider({ vaultUrl: mock.baseUrl, accessToken: 't' });
    await assert.rejects(provider.get('missing'), (e: Error) => /\[REDACTED\]/.test(e.message));
  });

  it('AzureKeyVaultProvider requires a token source', () => {
    assert.throws(() => new AzureKeyVaultProvider({ vaultUrl: 'https://v.vault.azure.net' }));
  });

  // ── GCP ──
  it('GcpSecretManagerProvider base64-decodes the payload and sends a bearer token', async () => {
    mock.onRequest((req, res) => {
      assert.equal(req.headers['authorization'], 'Bearer gcp-token');
      assert.match(req.url, /\/v1\/projects\/my-proj\/secrets\/api-key\/versions\/latest:access$/);
      json(res, 200, { payload: { data: Buffer.from('gcp-secret', 'utf8').toString('base64') } });
    });
    const provider = new GcpSecretManagerProvider({
      projectId: 'my-proj', serviceAccountToken: 'gcp-token', endpoint: mock.baseUrl,
    });
    assert.equal(await provider.get('api-key'), 'gcp-secret');
  });

  it('GcpSecretManagerProvider redacts the body in error messages', async () => {
    mock.onRequest((_req, res) => json(res, 403, { error: { status: 'PERMISSION_DENIED' } }));
    const provider = new GcpSecretManagerProvider({
      projectId: 'p', serviceAccountToken: 't', endpoint: mock.baseUrl,
    });
    await assert.rejects(provider.get('x'), (e: Error) => /\[REDACTED\]/.test(e.message));
  });

  // ── Rotation ──
  it('SecretRotationManager emits rotate + invokes onRotate when the value changes', async () => {
    let v = 'pw-1';
    mock.onRequest((_req, res) => json(res, 200, { data: { data: { 'db-pw': v } } }));
    const provider = new VaultSecretProvider({ endpoint: mock.baseUrl, token: 't', cacheTtlMs: 0 });

    const rotations: Array<{ newValue: string; oldValue: string | null }> = [];
    const mgr = new SecretRotationManager(provider, 'db-pw', {
      intervalMs: 10_000,
      onRotate: (nv, ov) => { rotations.push({ newValue: nv, oldValue: ov }); },
    });
    const initial = await mgr.start();
    assert.equal(initial, 'pw-1');

    v = 'pw-2'; // simulate a backend rotation
    const events: unknown[] = [];
    mgr.on('rotate', (e) => events.push(e));
    await mgr.checkNow();

    assert.equal(mgr.value, 'pw-2');
    assert.equal(rotations.length, 1);
    assert.deepEqual(rotations[0], { newValue: 'pw-2', oldValue: 'pw-1' });
    assert.equal(events.length, 1);
    mgr.stop();
  });

  it('SecretRotationManager does not emit when the value is unchanged', async () => {
    mock.onRequest((_req, res) => json(res, 200, { data: { data: { k: 'same' } } }));
    const provider = new VaultSecretProvider({ endpoint: mock.baseUrl, token: 't', cacheTtlMs: 0 });
    const mgr = new SecretRotationManager(provider, 'k', { intervalMs: 10_000 });
    await mgr.start();
    let fired = false;
    mgr.on('rotate', () => { fired = true; });
    await mgr.checkNow();
    await mgr.checkNow();
    assert.equal(fired, false);
    mgr.stop();
  });

  it('SecretRotationManager surfaces refresh errors as error events without stopping', async () => {
    let mode: 'ok' | 'fail' = 'ok';
    mock.onRequest((_req, res) => {
      if (mode === 'fail') { res.writeHead(500); res.end('boom'); return; }
      json(res, 200, { data: { data: { k: 'v' } } });
    });
    const provider = new VaultSecretProvider({ endpoint: mock.baseUrl, token: 't', cacheTtlMs: 0 });
    const mgr = new SecretRotationManager(provider, 'k', { intervalMs: 10_000 });
    await mgr.start();
    const errors: unknown[] = [];
    mgr.on('error', (e) => errors.push(e));
    mode = 'fail';
    await mgr.checkNow();
    assert.equal(errors.length, 1, 'one error event emitted');
    mgr.stop();
  });
});

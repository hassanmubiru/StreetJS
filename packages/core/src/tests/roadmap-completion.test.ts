// tests/roadmap-completion.test.ts
// Unit tests for the v1.6–v3.0 roadmap modules that are testable in-process
// without external infrastructure. Uses only node:test + node:assert.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ── Versioning ────────────────────────────────────────────────────────────────

import { ApiVersion, getApiVersion, Deprecated, getDeprecatedMeta } from '../versioning/strategy.js';

describe('API Versioning decorators', () => {
  it('@ApiVersion stores version metadata on the controller', () => {
    @ApiVersion('v2')
    class CtrlV2 {}
    assert.equal(getApiVersion(CtrlV2), 'v2');
  });

  it('@Deprecated stores sunset metadata and injects response headers', async () => {
    const sunset = new Date('2030-01-01T00:00:00Z');
    class Ctrl {
      @Deprecated({ sunset })
      async handler(ctx: { setHeader(n: string, v: string): void }): Promise<string> {
        return 'ok';
      }
    }
    const meta = getDeprecatedMeta(Ctrl.prototype, 'handler');
    assert.ok(meta);
    assert.equal(meta!.sunset?.getTime(), sunset.getTime());

    const headers: Record<string, string> = {};
    const ctx = { setHeader: (n: string, v: string) => { headers[n] = v; } };
    const result = await new Ctrl().handler(ctx);
    assert.equal(result, 'ok');
    assert.equal(headers['Deprecation'], 'true');
    assert.equal(headers['Sunset'], sunset.toUTCString());
  });
});

// ── SDK Generator ─────────────────────────────────────────────────────────────

import { generateTypescriptSdk, type OpenApiSpec } from '../sdk-gen/typescript.js';
import { generatePythonSdk } from '../sdk-gen/python.js';

describe('SDK Generator', () => {
  let dir: string;
  const spec: OpenApiSpec = {
    paths: {
      '/users/{id}': {
        get: { operationId: 'getUser', summary: 'Fetch a user', parameters: [{ name: 'id', in: 'path', required: true }] },
      },
      '/users': {
        post: { operationId: 'createUser', summary: 'Create a user' },
      },
    },
  };

  before(async () => { dir = await mkdtemp(join(tmpdir(), 'street-sdk-')); });
  after(async () => { await rm(dir, { recursive: true, force: true }); });

  it('generates a TypeScript SDK with types and client', async () => {
    await generateTypescriptSdk(spec, dir);
    const types = await readFile(join(dir, 'types.ts'), 'utf8');
    const client = await readFile(join(dir, 'api-client.ts'), 'utf8');
    assert.match(types, /GetUserParams/);
    assert.match(client, /class ApiClient/);
    assert.match(client, /getUser/);
    assert.match(client, /createUser/);
  });

  it('generates a Python SDK with models and client', async () => {
    await generatePythonSdk(spec, dir);
    const models = await readFile(join(dir, 'models.py'), 'utf8');
    const client = await readFile(join(dir, 'client.py'), 'utf8');
    assert.match(models, /class GetUserParams/);
    assert.match(client, /class ApiClient/);
    assert.match(client, /def get_user/);
  });
});

// ── Analytics ─────────────────────────────────────────────────────────────────

import { AnalyticsService, type AnalyticsPool } from '../observability/analytics.js';

class FakeAnalyticsPool implements AnalyticsPool {
  inserts: unknown[][] = [];
  reportRows: Record<string, string | null>[] = [];
  deleteCount = 0;
  async query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, string | null>[]; rowCount: number; command: string }> {
    const s = sql.trim().toUpperCase();
    if (s.startsWith('INSERT')) {
      this.inserts.push(params ?? []);
      return { rows: [], rowCount: (params?.length ?? 0) / 6, command: 'INSERT' };
    }
    if (s.startsWith('SELECT')) {
      return { rows: this.reportRows, rowCount: this.reportRows.length, command: 'SELECT' };
    }
    if (s.startsWith('DELETE')) {
      return { rows: [], rowCount: this.deleteCount, command: 'DELETE' };
    }
    return { rows: [], rowCount: 0, command: 'OK' };
  }
}

describe('AnalyticsService', () => {
  it('buffers events and flushes a batched INSERT', async () => {
    const pool = new FakeAnalyticsPool();
    const svc = new AnalyticsService({ pool, batchSize: 100, flushIntervalMs: 60_000 });
    svc.record({ route: '/a', method: 'GET', status: 200, durationMs: 5, userId: null, apiKeyId: null });
    svc.record({ route: '/b', method: 'POST', status: 500, durationMs: 9, userId: 'u1', apiKeyId: null });
    await svc.flush();
    assert.equal(pool.inserts.length, 1);
    assert.equal(pool.inserts[0]!.length, 12); // 2 rows * 6 cols
    await svc.close();
  });

  it('report() maps aggregation rows', async () => {
    const pool = new FakeAnalyticsPool();
    pool.reportRows = [{ route: '/a', method: 'GET', count: '10', avg_latency: '12.5', error_rate: '0.1' }];
    const svc = new AnalyticsService({ pool, flushIntervalMs: 60_000 });
    const report = await svc.report(new Date(0), new Date());
    assert.equal(report.routes[0]!.count, 10);
    assert.equal(report.routes[0]!.avgLatencyMs, 12.5);
    assert.equal(report.routes[0]!.errorRate, 0.1);
    await svc.close();
  });
});

// ── Webhook Manager ───────────────────────────────────────────────────────────

import { WebhookManager, signWebhookPayload, verifyIncomingWebhook, type WebhookManagerPool } from '../webhook/manager.js';

class FakeWebhookPool implements WebhookManagerPool {
  endpoints: Record<string, string | null>[] = [];
  deliveries: Record<string, string | null>[] = [];
  private seq = 1;
  async query(sql: string, params: unknown[] = []): Promise<{ rows: Record<string, string | null>[]; rowCount: number; command: string }> {
    const s = sql.trim().toUpperCase();
    if (s.startsWith('INSERT INTO STREET_WEBHOOK_ENDPOINTS')) {
      const row = { id: 'ep-' + this.seq++, url: String(params[0]), events: String(params[1]), secret: String(params[2]), created_at: new Date().toISOString() };
      this.endpoints.push(row);
      return { rows: [row], rowCount: 1, command: 'INSERT' };
    }
    if (s.startsWith('INSERT INTO STREET_WEBHOOK_DELIVERIES')) {
      this.deliveries.push({ id: String(this.seq++), endpoint_id: String(params[0]), event: String(params[1]), status: String(params[2]), response_code: params[3] == null ? null : String(params[3]), response_body: params[4] as string | null, attempt: String(params[5]), created_at: new Date().toISOString() });
      return { rows: [], rowCount: 1, command: 'INSERT' };
    }
    if (s.includes('FROM STREET_WEBHOOK_ENDPOINTS')) return { rows: this.endpoints, rowCount: this.endpoints.length, command: 'SELECT' };
    if (s.includes('FROM STREET_WEBHOOK_DELIVERIES')) return { rows: this.deliveries, rowCount: this.deliveries.length, command: 'SELECT' };
    return { rows: [], rowCount: 0, command: 'OK' };
  }
}

describe('WebhookManager + signature verification', () => {
  it('HMAC verify accepts valid and rejects invalid signatures', () => {
    const body = JSON.stringify({ hello: 'world' });
    const sig = signWebhookPayload(body, 'secret');
    assert.equal(verifyIncomingWebhook('secret', sig, body), true);
    assert.equal(verifyIncomingWebhook('secret', sig, body + 'x'), false);
    assert.equal(verifyIncomingWebhook('wrong', sig, body), false);
  });

  it('registers endpoints and only delivers to matching event subscribers', async () => {
    const pool = new FakeWebhookPool();
    const mgr = new WebhookManager({ pool });
    await mgr.registerEndpoint('https://example.com/a', ['user.created'], 'sec');
    await mgr.registerEndpoint('https://example.com/b', ['order.paid'], 'sec');
    const res = await mgr.publish('user.created', { id: 1 });
    assert.equal(res.delivered, 1);
  });
});

// ── Cloud runtime: autoscale + mesh + shutdown ────────────────────────────────

import { buildAutoscaleMetrics, isRunningInServiceMesh, registerShutdownHook } from '../cloud/runtime.js';
import { TelemetryTracker } from '../telemetry/tracker.js';

describe('Cloud runtime helpers', () => {
  it('buildAutoscaleMetrics returns Kubernetes External Metrics shape', () => {
    const telemetry = new TelemetryTracker(60_000);
    telemetry.recordRequest(1_000_000n, false);
    const m = buildAutoscaleMetrics({ telemetry, activeConnections: () => 7, queueDepth: () => 3 }, 60);
    assert.equal(m.kind, 'ExternalMetricValueList');
    const names = m.items.map((i) => i.metricName);
    assert.ok(names.includes('http_requests_per_second'));
    assert.ok(names.includes('active_connections'));
    assert.ok(names.includes('queue_depth'));
    assert.equal(m.items.find((i) => i.metricName === 'active_connections')!.value, '7');
    telemetry.destroy();
  });

  it('isRunningInServiceMesh detects Istio/Linkerd env vars', () => {
    assert.equal(isRunningInServiceMesh({}), false);
    assert.equal(isRunningInServiceMesh({ ISTIO_META_MESH_ID: 'mesh' }), true);
    assert.equal(isRunningInServiceMesh({ LINKERD_PROXY_INJECTION_ENABLED: 'enabled' }), true);
  });

  it('registerShutdownHook drains app, closes resources, exits 0 on SIGTERM', async () => {
    const order: string[] = [];
    const app = {
      close: async () => { order.push('app.close'); },
    } as unknown as import('../http/server.js').StreetApp;
    let exitCode = -1;
    const dispose = registerShutdownHook(app, {
      closeables: [{ close: async () => { order.push('pool.close'); } }],
      onShutdown: () => { order.push('onShutdown'); },
      exit: (code) => { exitCode = code; },
    });
    process.emit('SIGTERM');
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(order, ['app.close', 'pool.close', 'onShutdown']);
    assert.equal(exitCode, 0);
    dispose();
  });
});

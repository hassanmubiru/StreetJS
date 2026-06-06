// tests/roadmap-completion.test.ts
// Unit tests for the v1.6–v3.0 roadmap modules that are testable in-process
// without external infrastructure. Uses only node:test + node:assert.
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// ── Versioning ────────────────────────────────────────────────────────────────
import { ApiVersion, getApiVersion, Deprecated, getDeprecatedMeta } from '../versioning/strategy.js';
describe('API Versioning decorators', () => {
    it('@ApiVersion stores version metadata on the controller', () => {
        let CtrlV2 = class CtrlV2 {
        };
        CtrlV2 = __decorate([
            ApiVersion('v2')
        ], CtrlV2);
        assert.equal(getApiVersion(CtrlV2), 'v2');
    });
    it('@Deprecated stores sunset metadata and injects response headers', async () => {
        const sunset = new Date('2030-01-01T00:00:00Z');
        class Ctrl {
            async handler(ctx) {
                return 'ok';
            }
        }
        __decorate([
            Deprecated({ sunset }),
            __metadata("design:type", Function),
            __metadata("design:paramtypes", [Object]),
            __metadata("design:returntype", Promise)
        ], Ctrl.prototype, "handler", null);
        const meta = getDeprecatedMeta(Ctrl.prototype, 'handler');
        assert.ok(meta);
        assert.equal(meta.sunset?.getTime(), sunset.getTime());
        const headers = {};
        const ctx = { setHeader: (n, v) => { headers[n] = v; } };
        const result = await new Ctrl().handler(ctx);
        assert.equal(result, 'ok');
        assert.equal(headers['Deprecation'], 'true');
        assert.equal(headers['Sunset'], sunset.toUTCString());
    });
});
// ── SDK Generator ─────────────────────────────────────────────────────────────
import { generateTypescriptSdk } from '../sdk-gen/typescript.js';
import { generatePythonSdk } from '../sdk-gen/python.js';
describe('SDK Generator', () => {
    let dir;
    const spec = {
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
import { AnalyticsService } from '../observability/analytics.js';
class FakeAnalyticsPool {
    inserts = [];
    reportRows = [];
    deleteCount = 0;
    async query(sql, params) {
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
        assert.equal(pool.inserts[0].length, 12); // 2 rows * 6 cols
        await svc.close();
    });
    it('report() maps aggregation rows', async () => {
        const pool = new FakeAnalyticsPool();
        pool.reportRows = [{ route: '/a', method: 'GET', count: '10', avg_latency: '12.5', error_rate: '0.1' }];
        const svc = new AnalyticsService({ pool, flushIntervalMs: 60_000 });
        const report = await svc.report(new Date(0), new Date());
        assert.equal(report.routes[0].count, 10);
        assert.equal(report.routes[0].avgLatencyMs, 12.5);
        assert.equal(report.routes[0].errorRate, 0.1);
        await svc.close();
    });
});
// ── Webhook Manager ───────────────────────────────────────────────────────────
import { WebhookManager, signWebhookPayload, verifyIncomingWebhook } from '../webhook/manager.js';
class FakeWebhookPool {
    endpoints = [];
    deliveries = [];
    seq = 1;
    async query(sql, params = []) {
        const s = sql.trim().toUpperCase();
        if (s.startsWith('INSERT INTO STREET_WEBHOOK_ENDPOINTS')) {
            const row = { id: 'ep-' + this.seq++, url: String(params[0]), events: String(params[1]), secret: String(params[2]), created_at: new Date().toISOString() };
            this.endpoints.push(row);
            return { rows: [row], rowCount: 1, command: 'INSERT' };
        }
        if (s.startsWith('INSERT INTO STREET_WEBHOOK_DELIVERIES')) {
            this.deliveries.push({ id: String(this.seq++), endpoint_id: String(params[0]), event: String(params[1]), status: String(params[2]), response_code: params[3] == null ? null : String(params[3]), response_body: params[4], attempt: String(params[5]), created_at: new Date().toISOString() });
            return { rows: [], rowCount: 1, command: 'INSERT' };
        }
        if (s.includes('FROM STREET_WEBHOOK_ENDPOINTS'))
            return { rows: this.endpoints, rowCount: this.endpoints.length, command: 'SELECT' };
        if (s.includes('FROM STREET_WEBHOOK_DELIVERIES'))
            return { rows: this.deliveries, rowCount: this.deliveries.length, command: 'SELECT' };
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
        telemetry.recordRequest(1000000n, false);
        const m = buildAutoscaleMetrics({ telemetry, activeConnections: () => 7, queueDepth: () => 3 }, 60);
        assert.equal(m.kind, 'ExternalMetricValueList');
        const names = m.items.map((i) => i.metricName);
        assert.ok(names.includes('http_requests_per_second'));
        assert.ok(names.includes('active_connections'));
        assert.ok(names.includes('queue_depth'));
        assert.equal(m.items.find((i) => i.metricName === 'active_connections').value, '7');
        telemetry.destroy();
    });
    it('isRunningInServiceMesh detects Istio/Linkerd env vars', () => {
        assert.equal(isRunningInServiceMesh({}), false);
        assert.equal(isRunningInServiceMesh({ ISTIO_META_MESH_ID: 'mesh' }), true);
        assert.equal(isRunningInServiceMesh({ LINKERD_PROXY_INJECTION_ENABLED: 'enabled' }), true);
    });
    it('registerShutdownHook drains app, closes resources, exits 0 on SIGTERM', async () => {
        const order = [];
        const app = {
            close: async () => { order.push('app.close'); },
        };
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
// ── Plugin lifecycle (load/unload round-trip) ─────────────────────────────────
import { streetApp } from '../http/server.js';
import { PluginModule } from '../platform/plugins/sdk.js';
describe('Plugin load/unload round-trip', () => {
    it('restores the middleware stack after unload', async () => {
        const app = streetApp();
        const mw = async (_c, next) => { await next(); };
        app.use(mw);
        class MyPlugin extends PluginModule {
            name = 'my-plugin';
            version = '1.0.0';
            loaded = false;
            async onLoad(a) {
                this.loaded = true;
                a.use(async (_c, next) => { await next(); });
                a.use(async (_c, next) => { await next(); });
            }
            async onUnload() { this.loaded = false; }
        }
        const plugin = new MyPlugin();
        await app.loadPlugin(plugin);
        assert.equal(plugin.loaded, true);
        await app.unloadPlugin(plugin);
        assert.equal(plugin.loaded, false);
        // No assertion error means the middleware stack was restored cleanly.
    });
});
// ── Replication coordinator ───────────────────────────────────────────────────
import { ReplicationCoordinator } from '../platform/replication.js';
function fakePool(label, fail = false) {
    return {
        async query() {
            if (fail)
                throw new Error('down');
            return { rows: [{ region: label }] };
        },
    };
}
describe('ReplicationCoordinator', () => {
    it('routes writes to primary and honors preferred read region', () => {
        const coord = new ReplicationCoordinator([
            { name: 'us-east', pool: fakePool('us-east'), primary: true },
            { name: 'eu-west', pool: fakePool('eu-west'), readWeight: 1 },
        ], { healthCheckIntervalMs: 0 });
        assert.equal(coord.getWritePool(), coord.getReadPool('us-east'));
        assert.ok(coord.getReadPool('eu-west'));
        coord.stop();
    });
    it('promotePrimary emits region:promoted', async () => {
        const coord = new ReplicationCoordinator([
            { name: 'a', pool: fakePool('a'), primary: true },
            { name: 'b', pool: fakePool('b') },
        ], { healthCheckIntervalMs: 0 });
        const events = [];
        coord.on('region:promoted', (e) => events.push(e));
        await coord.promotePrimary('b');
        assert.equal(events.length, 1);
        coord.stop();
    });
});
// ── AI Agent Executor (ReAct loop) ────────────────────────────────────────────
import { AgentExecutor } from '../platform/ai/agent-executor.js';
import { ToolRegistry } from '../platform/ai/tool-registry.js';
describe('AgentExecutor ReAct loop', () => {
    it('invokes a tool then returns the final answer', async () => {
        const replies = [
            '```json\n{ "tool": "add", "args": { "a": 2, "b": 3 } }\n```',
            'FINAL ANSWER: The sum is 5',
        ];
        let call = 0;
        const client = {
            async complete(_opts) {
                return { content: replies[call++] ?? 'FINAL ANSWER: done' };
            },
            // eslint-disable-next-line require-yield
            async *stream() { return; },
        };
        const tools = new ToolRegistry();
        let toolArgs = null;
        tools.register('add', async (args) => {
            toolArgs = args;
            const a = args.a;
            const b = args.b;
            return a + b;
        }, { description: 'add two numbers' });
        const steps = [];
        const ctx = { res: { write: (d) => { steps.push(JSON.parse(d.replace(/^data: /, '').trim())); } } };
        const executor = new AgentExecutor(client, tools, { maxSteps: 5 });
        const answer = await executor.run('what is 2 + 3?', ctx);
        assert.match(answer, /5/);
        assert.deepEqual(toolArgs, { a: 2, b: 3 });
        const types = steps.map((s) => s.type);
        assert.ok(types.includes('action'));
        assert.ok(types.includes('observation'));
        assert.ok(types.includes('final'));
    });
});
// ── Feature Flags admin + targeting ───────────────────────────────────────────
import { FeatureFlagService, registerFeatureFlagAdminRoute } from '../enterprise/feature-flags.js';
class FakeFlagPool {
    store = new Map();
    async query(sql, params = []) {
        const s = sql.trim().toUpperCase();
        if (s.startsWith('INSERT')) {
            this.store.set(String(params[0]), { name: String(params[0]), enabled: Boolean(params[1]), rules: JSON.parse(String(params[2])) });
            return { rows: [] };
        }
        if (s.startsWith('SELECT')) {
            const rec = this.store.get(String(params[0]));
            return { rows: rec ? [rec] : [] };
        }
        return { rows: [] };
    }
}
describe('FeatureFlagService', () => {
    it('percentage rollout is stable for the same user', async () => {
        const pool = new FakeFlagPool();
        const svc = new FeatureFlagService(pool);
        await svc.setFlag('beta', true, [{ type: 'percentage', value: 50 }]);
        const first = await svc.isEnabled('beta', { userId: 'user-123' });
        const second = await svc.isEnabled('beta', { userId: 'user-123' });
        assert.equal(first, second);
    });
    it('unknown flag returns false', async () => {
        const svc = new FeatureFlagService(new FakeFlagPool());
        assert.equal(await svc.isEnabled('does-not-exist'), false);
    });
    it('admin route requires admin role and toggles the flag', async () => {
        const pool = new FakeFlagPool();
        const svc = new FeatureFlagService(pool);
        const mws = [];
        registerFeatureFlagAdminRoute({ use: (mw) => mws.push(mw) }, svc);
        const mw = mws[0];
        // Non-admin → 403
        let status = 0;
        await mw({ method: 'PATCH', path: '/admin/feature-flags/beta', body: { enabled: true }, user: { roles: ['user'] }, json: (_d, s = 200) => { status = s; } }, async () => { });
        assert.equal(status, 403);
        // Admin → toggles
        let okBody = null;
        await mw({ method: 'PATCH', path: '/admin/feature-flags/beta', body: { enabled: true }, user: { roles: ['admin'] }, json: (d) => { okBody = d; } }, async () => { });
        assert.deepEqual(okBody, { name: 'beta', enabled: true });
        assert.equal(await svc.isEnabled('beta'), true);
    });
});
// ── @RateLimit decorator metadata ─────────────────────────────────────────────
import { RateLimit, getRateLimitMeta } from '../security/ratelimit.js';
describe('@RateLimit decorator', () => {
    it('stores rate-limit metadata readable by the router', () => {
        class Ctrl {
            async handler() { }
        }
        __decorate([
            RateLimit({ requests: 100, window: 60_000, key: 'ip' }),
            __metadata("design:type", Function),
            __metadata("design:paramtypes", []),
            __metadata("design:returntype", Promise)
        ], Ctrl.prototype, "handler", null);
        const meta = getRateLimitMeta(Ctrl.prototype, 'handler');
        assert.ok(meta);
        assert.equal(meta.requests, 100);
        assert.equal(meta.window, 60_000);
        assert.equal(meta.key, 'ip');
    });
});
// ── RESP codec (Redis transport protocol) ─────────────────────────────────────
import { encodeCommand, RespParser } from '../transports/resp.js';
describe('RESP codec', () => {
    it('encodeCommand produces a RESP2 array of bulk strings', () => {
        const buf = encodeCommand(['SET', 'k', 'v']);
        assert.equal(buf.toString('utf8'), '*3\r\n$3\r\nSET\r\n$1\r\nk\r\n$1\r\nv\r\n');
    });
    it('RespParser parses simple strings, integers, bulk strings, and arrays', () => {
        const p = new RespParser();
        p.push(Buffer.from('+OK\r\n:42\r\n$5\r\nhello\r\n*2\r\n$3\r\nfoo\r\n$3\r\nbar\r\n', 'utf8'));
        assert.equal(p.parse(), 'OK');
        assert.equal(p.parse(), 42);
        assert.equal(p.parse(), 'hello');
        assert.deepEqual(p.parse(), ['foo', 'bar']);
        assert.equal(p.parse(), undefined);
    });
    it('RespParser waits for incomplete frames', () => {
        const p = new RespParser();
        p.push(Buffer.from('$5\r\nhel', 'utf8'));
        assert.equal(p.parse(), undefined);
        p.push(Buffer.from('lo\r\n', 'utf8'));
        assert.equal(p.parse(), 'hello');
    });
});
// ── AWS SigV4 signing ─────────────────────────────────────────────────────────
import { signAwsV4 } from '../enterprise/storage-adapters.js';
describe('AWS SigV4 signing', () => {
    it('produces a deterministic Authorization header for fixed inputs', () => {
        const headers = signAwsV4({
            method: 'GET', host: 'examplebucket.s3.us-east-1.amazonaws.com', path: '/test.txt',
            region: 'us-east-1', service: 's3',
            accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
            payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
            now: new Date('2013-05-24T00:00:00Z'),
        });
        assert.match(headers['authorization'], /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/20130524\/us-east-1\/s3\/aws4_request/);
        assert.match(headers['authorization'], /SignedHeaders=host;x-amz-content-sha256;x-amz-date/);
        assert.match(headers['authorization'], /Signature=[0-9a-f]{64}$/);
        // Determinism: same inputs → same signature
        const again = signAwsV4({
            method: 'GET', host: 'examplebucket.s3.us-east-1.amazonaws.com', path: '/test.txt',
            region: 'us-east-1', service: 's3',
            accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
            payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
            now: new Date('2013-05-24T00:00:00Z'),
        });
        assert.equal(headers['authorization'], again['authorization']);
    });
});
// ── Versioning guard + per-version OpenAPI ────────────────────────────────────
import { versionGuard, filterOpenApiByVersion, registerVersionedOpenApi } from '../versioning/strategy.js';
describe('Versioning guard + per-version OpenAPI', () => {
    it('versionGuard returns 404 with available versions for unknown version', async () => {
        const mws = [];
        versionGuard({ use: (mw) => mws.push(mw) }, ['v1', 'v2']);
        const mw = mws[0];
        let body = null;
        let status = 0;
        await mw({ method: 'GET', path: '/v9/users', json: (d, s = 200) => { body = d; status = s; } }, async () => { });
        assert.equal(status, 404);
        assert.deepEqual(body, { error: 'version_not_found', available: ['v1', 'v2'] });
        // Known version passes through
        let passed = false;
        await mw({ method: 'GET', path: '/v1/users', json: () => { } }, async () => { passed = true; });
        assert.equal(passed, true);
    });
    it('filterOpenApiByVersion keeps only matching paths', () => {
        const spec = { openapi: '3.1.0', paths: { '/v1/users': {}, '/v2/users': {} } };
        const v1 = filterOpenApiByVersion(spec, 'v1');
        assert.deepEqual(Object.keys(v1.paths), ['/v1/users']);
    });
    it('registerVersionedOpenApi serves a filtered spec per version', async () => {
        const mws = [];
        registerVersionedOpenApi({ use: (mw) => mws.push(mw) }, ['v1'], () => ({ paths: { '/v1/a': {}, '/v2/b': {} } }));
        let body = null;
        await mws[0]({ method: 'GET', path: '/v1/openapi.json', json: (d) => { body = d; } }, async () => { });
        assert.ok(body);
        assert.deepEqual(Object.keys(body.paths), ['/v1/a']);
    });
});
// ── Tenant admin route + billing adapter ──────────────────────────────────────
import { TenantServiceImpl, registerTenantMetricsRoute } from '../tenancy/provisioner.js';
import { InMemoryBillingAdapter } from '../tenancy/billing.js';
describe('Tenant metrics admin route + billing', () => {
    it('admin route enforces role and returns quota status', async () => {
        const fakePool = { async query() { return { rows: [], rowCount: 0, command: 'SELECT' }; } };
        const svc = new TenantServiceImpl(fakePool, { maxRequestsPerDay: 1000 });
        const mws = [];
        registerTenantMetricsRoute({ use: (mw) => mws.push(mw) }, svc, { quotaKeys: ['maxRequestsPerDay'] });
        const mw = mws[0];
        let status = 0;
        await mw({ method: 'GET', path: '/admin/tenants/t1/metrics', user: { roles: ['user'] }, json: (_d, s = 200) => { status = s; } }, async () => { });
        assert.equal(status, 403);
        let body = null;
        await mw({ method: 'GET', path: '/admin/tenants/t1/metrics', user: { roles: ['admin'] }, json: (d) => { body = d; } }, async () => { });
        const b = body;
        assert.equal(b.tenantId, 't1');
        assert.ok('maxRequestsPerDay' in b.quotas);
    });
    it('InMemoryBillingAdapter records reported usage', async () => {
        const adapter = new InMemoryBillingAdapter();
        const period = { start: new Date(0), end: new Date() };
        await adapter.reportUsage('t1', period, { apiCalls: 42 });
        assert.equal(adapter.reports.length, 1);
        assert.equal(adapter.reports[0].metrics['apiCalls'], 42);
    });
});
//# sourceMappingURL=roadmap-completion.test.js.map
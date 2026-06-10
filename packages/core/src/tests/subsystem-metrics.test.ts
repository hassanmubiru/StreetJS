// src/tests/subsystem-metrics.test.ts
// Unit tests for the Advanced Observability metrics-first subsystem (task 16.1):
// verifies the PostgreSQL, Kafka, RabbitMQ, and Plugin Host metrics are
// registered/exported and that the instrumentation + live-wiring helpers emit
// real values. Offline only — no live broker/database/cluster required.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import {
  MetricsRegistry,
  prometheusMiddleware,
  registerMetricsRoute,
} from '../observability/prometheus.js';
import {
  SubsystemMetrics,
  registerSubsystemMetrics,
  subsystemMetricNames,
  SUBSYSTEM_METRIC_NAMES,
  instrumentPgPool,
  instrumentPluginHost,
} from '../observability/subsystem-metrics.js';
import type { PgPool } from '../database/pool.js';
import { PluginHost, PluginModule, signManifest } from '../platform/plugins/host.js';
import { streetApp } from '../http/server.js';
import { request } from 'node:http';
import { generateKeyPairSync } from 'node:crypto';

// ── Exported surface ──────────────────────────────────────────────────────────

describe('subsystem metrics — exported surface (16.1)', () => {
  it('registers every PostgreSQL/Kafka/RabbitMQ/Plugin Host metric in the registry', () => {
    const registry = new MetricsRegistry();
    registerSubsystemMetrics(registry);
    const output = registry.collect();
    for (const name of subsystemMetricNames()) {
      assert.ok(output.includes(name), `expected metric "${name}" in exposition:\n${output}`);
    }
  });

  it('exposes exactly the documented metric-first table names', () => {
    assert.deepEqual(SUBSYSTEM_METRIC_NAMES.postgres, [
      'db_pool_connections',
      'db_query_duration_seconds',
      'db_pool_acquire_seconds',
      'db_pool_exhausted_total',
    ]);
    assert.deepEqual(SUBSYSTEM_METRIC_NAMES.kafka, [
      'kafka_messages_produced_total',
      'kafka_messages_consumed_total',
      'kafka_consumer_lag',
      'kafka_coordinator_wait_seconds',
    ]);
    assert.deepEqual(SUBSYSTEM_METRIC_NAMES.rabbitmq, [
      'rabbitmq_messages_published_total',
      'rabbitmq_messages_delivered_total',
      'rabbitmq_queue_depth',
      'rabbitmq_consumer_count',
    ]);
    assert.deepEqual(SUBSYSTEM_METRIC_NAMES.pluginHost, [
      'plugin_host_plugins',
      'plugin_install_duration_seconds',
      'plugin_signature_failures_total',
    ]);
  });

  it('reuses an existing db_pool_connections gauge instead of conflicting', () => {
    const registry = new MetricsRegistry();
    // prometheusMiddleware registers db_pool_connections when a pool is given.
    prometheusMiddleware(registry, { idleCount: 1, activeCount: 2, waitingCount: 0 });
    // Must not throw MetricConflictError.
    assert.doesNotThrow(() => registerSubsystemMetrics(registry));
  });
});

// ── Instrumentation methods ─────────────────────────────────────────────────

describe('subsystem metrics — instrumentation methods (16.1)', () => {
  it('records PostgreSQL durations, exhaustion, and pool connections', () => {
    const registry = new MetricsRegistry();
    const m = new SubsystemMetrics(registry);
    m.observeQueryDuration(0.02);
    m.observeAcquireDuration(0.003);
    m.recordPoolExhausted();
    m.recordPoolExhausted();
    m.setPoolConnections({ idle: 4, active: 6, waiting: 2 });

    const out = registry.collect();
    assert.ok(out.includes('db_query_duration_seconds_count 1'), out);
    assert.ok(out.includes('db_pool_acquire_seconds_count 1'), out);
    assert.ok(out.includes('db_pool_exhausted_total 2'), out);
    assert.ok(out.includes('db_pool_connections{state="active"} 6'), out);
    assert.ok(out.includes('db_pool_connections{state="waiting"} 2'), out);
  });

  it('records Kafka produced/consumed/lag/coordinator-wait', () => {
    const registry = new MetricsRegistry();
    const m = new SubsystemMetrics(registry);
    m.recordProduced('orders', 3);
    m.recordConsumed('orders', 2);
    m.setConsumerLag('orders', 0, 5);
    m.observeCoordinatorWait(1.25);

    const out = registry.collect();
    assert.ok(out.includes('kafka_messages_produced_total{topic="orders"} 3'), out);
    assert.ok(out.includes('kafka_messages_consumed_total{topic="orders"} 2'), out);
    assert.ok(out.includes('kafka_consumer_lag{partition="0",topic="orders"} 5')
      || out.includes('kafka_consumer_lag{topic="orders",partition="0"} 5'), out);
    assert.ok(out.includes('kafka_coordinator_wait_seconds_count 1'), out);
  });

  it('records RabbitMQ published/delivered/queue-depth/consumer-count', () => {
    const registry = new MetricsRegistry();
    const m = new SubsystemMetrics(registry);
    m.recordPublished('street.events', 1);
    m.recordDelivered('street.orders', 4);
    m.setQueueDepth('street.orders', 12);
    m.setConsumerCount('street.orders', 3);

    const out = registry.collect();
    assert.ok(out.includes('rabbitmq_messages_published_total{exchange="street.events"} 1'), out);
    assert.ok(out.includes('rabbitmq_messages_delivered_total{queue="street.orders"} 4'), out);
    assert.ok(out.includes('rabbitmq_queue_depth{queue="street.orders"} 12'), out);
    assert.ok(out.includes('rabbitmq_consumer_count{queue="street.orders"} 3'), out);
  });

  it('records Plugin Host counts, install duration, and signature failures', () => {
    const registry = new MetricsRegistry();
    const m = new SubsystemMetrics(registry);
    m.setPluginCounts({ registered: 5, enabled: 3, disabled: 1 });
    m.observeInstallDuration(0.5);
    m.recordSignatureFailure();

    const out = registry.collect();
    assert.ok(out.includes('plugin_host_plugins{state="enabled"} 3'), out);
    assert.ok(out.includes('plugin_install_duration_seconds_count 1'), out);
    assert.ok(out.includes('plugin_signature_failures_total 1'), out);
  });
});

// ── Live wiring: PgPool ────────────────────────────────────────────────────────

describe('instrumentPgPool (16.1)', () => {
  it('emits query duration, acquire duration, exhaustion, and pool gauge', async () => {
    const registry = new MetricsRegistry();
    const m = new SubsystemMetrics(registry);

    // Minimal PgPool-like double exercising the public surface the helper uses.
    const events = new EventEmitter();
    let size = 5;
    const fake = {
      events,
      get idle() { return 2; },
      get size() { return size; },
      get waiting() { return 1; },
      async acquire() { return { id: 'conn' }; },
      async query(_sql: string, _params?: unknown[]) { return { rows: [], rowCount: 0, command: 'SELECT' }; },
    } as unknown as PgPool;

    instrumentPgPool(fake, m);
    await fake.acquire();
    await fake.query('SELECT 1');
    events.emit('pool:exhausted', { total: 5, idle: 0, waiting: 1 });

    const out = registry.collect();
    assert.ok(out.includes('db_query_duration_seconds_count 1'), out);
    assert.ok(out.includes('db_pool_acquire_seconds_count 1'), out);
    assert.ok(out.includes('db_pool_exhausted_total 1'), out);
    assert.ok(out.includes('db_pool_connections{state="idle"} 2'), out);
    assert.ok(out.includes('db_pool_connections{state="active"} 3'), out); // size - idle
    void size;
  });
});

// ── Live wiring: PluginHost ────────────────────────────────────────────────────

class NoopPlugin extends PluginModule {
  constructor(readonly name: string, readonly version: string) { super(); }
}

describe('instrumentPluginHost (16.1)', () => {
  it('counts a signature failure and refreshes plugin counts on register/enable', async () => {
    const registry = new MetricsRegistry();
    const m = new SubsystemMetrics(registry);
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const host = new PluginHost({ grantedPermissions: '*', publicKey });
    instrumentPluginHost(host, m);

    // Unsigned register → PluginSignatureError → counter increments.
    assert.throws(() => host.register(new NoopPlugin('p', '1.0.0'), { name: 'p', version: '1.0.0' }));

    // Signed register + enable → counts refresh, install duration observed.
    const signed = signManifest({ name: 'p', version: '1.0.0' }, privateKey);
    host.register(new NoopPlugin('p', '1.0.0'), signed);
    await host.enable('p');

    const out = registry.collect();
    assert.ok(out.includes('plugin_signature_failures_total 1'), out);
    assert.ok(out.includes('plugin_host_plugins{state="registered"} 1'), out);
    assert.ok(out.includes('plugin_host_plugins{state="enabled"} 1'), out);
    assert.ok(out.includes('plugin_install_duration_seconds_count 1'), out);
  });
});

// ── Metrics endpoint integration ────────────────────────────────────────────

function httpGet(port: number, path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path, method: 'GET' }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('subsystem metrics — exported via /metrics endpoint (16.1)', () => {
  it('serves the subsystem metrics through registerMetricsRoute', async () => {
    const port = 54611;
    const registry = new MetricsRegistry();
    const app = streetApp({ port });
    registerMetricsRoute(app, registry);
    const m = registerSubsystemMetrics(registry);
    m.recordProduced('orders', 1);

    await app.listen(port);
    try {
      const res = await httpGet(port, '/metrics');
      assert.equal(res.status, 200);
      for (const name of subsystemMetricNames()) {
        assert.ok(res.body.includes(name), `expected "${name}" on /metrics`);
      }
      assert.ok(res.body.includes('kafka_messages_produced_total{topic="orders"} 1'), res.body);
    } finally {
      await app.close();
    }
  });
});

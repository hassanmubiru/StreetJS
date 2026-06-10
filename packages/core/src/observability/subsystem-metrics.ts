// src/observability/subsystem-metrics.ts
//
// Advanced Observability — metrics first (Req 10.1 / 10.2).
//
// Instruments and exports the PostgreSQL, Kafka, RabbitMQ, and Plugin Host
// metrics enumerated in the design's metrics-first table. These metrics are
// registered into a MetricsRegistry so they are emitted via the /metrics
// endpoint, and runtime instrumentation hooks wire them to live subsystem
// instances so the values reflect real signals (never fabricated ones).
//
// This MUST precede any dashboards/alerts that reference these metrics.
//
// Zero runtime dependencies: Node core only.

import type { Counter, Gauge, Histogram, MetricsRegistry } from './prometheus.js';
import type { PgPool } from '../database/pool.js';
import type { KafkaClient, CoordinatorReadinessGate, KafkaRecord } from '../transports/kafka/client.js';
import type { RabbitMqPublisher, RabbitMqConsumer, DeliveredMessage } from '../transports/rabbitmq/index.js';
import type { PluginHost } from '../platform/plugins/host.js';
import { PluginSignatureError } from '../platform/plugins/host.js';

// ── Metric name catalogue (single source of truth) ──────────────────────────

/**
 * Every metric name this module exports, grouped by subsystem. Dashboards,
 * alerts, and the anti-fabrication guard reference these names; keeping them
 * here makes the exported surface explicit and testable.
 */
export const SUBSYSTEM_METRIC_NAMES = {
  postgres: [
    'db_pool_connections',
    'db_query_duration_seconds',
    'db_pool_acquire_seconds',
    'db_pool_exhausted_total',
  ],
  kafka: [
    'kafka_messages_produced_total',
    'kafka_messages_consumed_total',
    'kafka_consumer_lag',
    'kafka_coordinator_wait_seconds',
  ],
  rabbitmq: [
    'rabbitmq_messages_published_total',
    'rabbitmq_messages_delivered_total',
    'rabbitmq_queue_depth',
    'rabbitmq_consumer_count',
  ],
  pluginHost: [
    'plugin_host_plugins',
    'plugin_install_duration_seconds',
    'plugin_signature_failures_total',
  ],
} as const;

/** Flat list of every subsystem metric name exported by this module. */
export function subsystemMetricNames(): string[] {
  return [
    ...SUBSYSTEM_METRIC_NAMES.postgres,
    ...SUBSYSTEM_METRIC_NAMES.kafka,
    ...SUBSYSTEM_METRIC_NAMES.rabbitmq,
    ...SUBSYSTEM_METRIC_NAMES.pluginHost,
  ];
}

// Histogram bucket presets (seconds).
const DURATION_BUCKETS = [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
const WAIT_BUCKETS = [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30];

// ── SubsystemMetrics ─────────────────────────────────────────────────────────

/**
 * Registers and owns the PostgreSQL, Kafka, RabbitMQ, and Plugin Host metrics,
 * and exposes the underlying metric instances plus convenience instrumentation
 * methods. Once constructed against a `MetricsRegistry`, every metric below is
 * exported through that registry's `/metrics` exposition.
 */
export class SubsystemMetrics {
  // PostgreSQL.
  readonly dbPoolConnections: Gauge;
  readonly dbQueryDuration: Histogram;
  readonly dbPoolAcquire: Histogram;
  readonly dbPoolExhausted: Counter;

  // Kafka.
  readonly kafkaProduced: Counter;
  readonly kafkaConsumed: Counter;
  readonly kafkaConsumerLag: Gauge;
  readonly kafkaCoordinatorWait: Histogram;

  // RabbitMQ.
  readonly rabbitmqPublished: Counter;
  readonly rabbitmqDelivered: Counter;
  readonly rabbitmqQueueDepth: Gauge;
  readonly rabbitmqConsumerCount: Gauge;

  // Plugin Host.
  readonly pluginHostPlugins: Gauge;
  readonly pluginInstallDuration: Histogram;
  readonly pluginSignatureFailures: Counter;

  constructor(registry: MetricsRegistry) {
    // PostgreSQL — `db_pool_connections{state}` may already be registered by
    // `prometheusMiddleware(registry, pool)`. Reuse it if present so the two
    // wiring paths don't conflict; otherwise register it here.
    this.dbPoolConnections = (registry.has('db_pool_connections')
      ? (registry.get('db_pool_connections') as Gauge)
      : registry.gauge('db_pool_connections', 'Database pool connection counts by state', ['state']));
    this.dbQueryDuration = registry.histogram(
      'db_query_duration_seconds',
      'PostgreSQL query execution duration in seconds',
      DURATION_BUCKETS,
    );
    this.dbPoolAcquire = registry.histogram(
      'db_pool_acquire_seconds',
      'Time spent acquiring a PostgreSQL connection from the pool in seconds',
      DURATION_BUCKETS,
    );
    this.dbPoolExhausted = registry.counter(
      'db_pool_exhausted_total',
      'Number of times the PostgreSQL pool was exhausted (a caller had to wait)',
    );

    // Kafka.
    this.kafkaProduced = registry.counter(
      'kafka_messages_produced_total',
      'Total Kafka messages produced',
      ['topic'],
    );
    this.kafkaConsumed = registry.counter(
      'kafka_messages_consumed_total',
      'Total Kafka messages consumed',
      ['topic'],
    );
    this.kafkaConsumerLag = registry.gauge(
      'kafka_consumer_lag',
      'Kafka consumer lag (high-watermark minus committed offset)',
      ['topic', 'partition'],
    );
    this.kafkaCoordinatorWait = registry.histogram(
      'kafka_coordinator_wait_seconds',
      'Time spent in the Kafka CoordinatorReadinessGate in seconds',
      WAIT_BUCKETS,
    );

    // RabbitMQ.
    this.rabbitmqPublished = registry.counter(
      'rabbitmq_messages_published_total',
      'Total RabbitMQ messages published',
      ['exchange'],
    );
    this.rabbitmqDelivered = registry.counter(
      'rabbitmq_messages_delivered_total',
      'Total RabbitMQ messages delivered to consumers',
      ['queue'],
    );
    this.rabbitmqQueueDepth = registry.gauge(
      'rabbitmq_queue_depth',
      'RabbitMQ queue depth (ready message count)',
      ['queue'],
    );
    this.rabbitmqConsumerCount = registry.gauge(
      'rabbitmq_consumer_count',
      'RabbitMQ consumer count per queue',
      ['queue'],
    );

    // Plugin Host.
    this.pluginHostPlugins = registry.gauge(
      'plugin_host_plugins',
      'Plugin Host plugin counts by state',
      ['state'],
    );
    this.pluginInstallDuration = registry.histogram(
      'plugin_install_duration_seconds',
      'Plugin install (onInstall + onLoad) duration in seconds',
      DURATION_BUCKETS,
    );
    this.pluginSignatureFailures = registry.counter(
      'plugin_signature_failures_total',
      'Total plugin manifest signature verification failures',
    );
  }

  // ── PostgreSQL instrumentation ───────────────────────────────────────────

  /** Record a completed query duration (seconds). */
  observeQueryDuration(seconds: number): void {
    this.dbQueryDuration.observe(seconds);
  }

  /** Record a connection-acquire duration (seconds). */
  observeAcquireDuration(seconds: number): void {
    this.dbPoolAcquire.observe(seconds);
  }

  /** Increment the pool-exhausted counter. */
  recordPoolExhausted(): void {
    this.dbPoolExhausted.inc();
  }

  /** Set the `db_pool_connections{state}` gauge from pool counts. */
  setPoolConnections(counts: { idle: number; active: number; waiting: number }): void {
    this.dbPoolConnections.set(counts.idle, { state: 'idle' });
    this.dbPoolConnections.set(counts.active, { state: 'active' });
    this.dbPoolConnections.set(counts.waiting, { state: 'waiting' });
  }

  // ── Kafka instrumentation ────────────────────────────────────────────────

  recordProduced(topic: string, count = 1): void {
    if (count > 0) this.kafkaProduced.inc({ topic }, count);
  }

  recordConsumed(topic: string, count = 1): void {
    if (count > 0) this.kafkaConsumed.inc({ topic }, count);
  }

  setConsumerLag(topic: string, partition: number, lag: number): void {
    this.kafkaConsumerLag.set(lag, { topic, partition: String(partition) });
  }

  observeCoordinatorWait(seconds: number): void {
    this.kafkaCoordinatorWait.observe(seconds);
  }

  // ── RabbitMQ instrumentation ─────────────────────────────────────────────

  recordPublished(exchange: string, count = 1): void {
    if (count > 0) this.rabbitmqPublished.inc({ exchange }, count);
  }

  recordDelivered(queue: string, count = 1): void {
    if (count > 0) this.rabbitmqDelivered.inc({ queue }, count);
  }

  setQueueDepth(queue: string, depth: number): void {
    this.rabbitmqQueueDepth.set(depth, { queue });
  }

  setConsumerCount(queue: string, count: number): void {
    this.rabbitmqConsumerCount.set(count, { queue });
  }

  // ── Plugin Host instrumentation ──────────────────────────────────────────

  setPluginCounts(counts: { registered: number; enabled: number; disabled: number }): void {
    this.pluginHostPlugins.set(counts.registered, { state: 'registered' });
    this.pluginHostPlugins.set(counts.enabled, { state: 'enabled' });
    this.pluginHostPlugins.set(counts.disabled, { state: 'disabled' });
  }

  observeInstallDuration(seconds: number): void {
    this.pluginInstallDuration.observe(seconds);
  }

  recordSignatureFailure(): void {
    this.pluginSignatureFailures.inc();
  }
}

/**
 * Register the subsystem metrics into `registry` and return the handle used to
 * instrument the subsystems. Call once per registry. Because the metrics share
 * the registry wired to `registerMetricsRoute`, they are exported via /metrics
 * immediately (rendering as zero until instrumented).
 */
export function registerSubsystemMetrics(registry: MetricsRegistry): SubsystemMetrics {
  return new SubsystemMetrics(registry);
}

// ── Live wiring helpers ──────────────────────────────────────────────────────
//
// Each helper attaches a SubsystemMetrics to a live instance non-invasively
// (wrapping public methods / subscribing to events) so the metrics carry real
// runtime values. Helpers are idempotent-safe to call once per instance.

const SECONDS_PER_MS = 1 / 1000;

/**
 * Wire a `PgPool`: observe query + acquire durations, count pool exhaustion,
 * and refresh the connection-state gauge after each acquire.
 *
 * @returns an unsubscribe function that detaches the `pool:exhausted` listener.
 */
export function instrumentPgPool(pool: PgPool, m: SubsystemMetrics): () => void {
  const onExhausted = (): void => m.recordPoolExhausted();
  pool.events.on('pool:exhausted', onExhausted);

  const refreshGauge = (): void => {
    m.setPoolConnections({ idle: pool.idle, active: pool.size - pool.idle, waiting: pool.waiting });
  };

  const originalAcquire = pool.acquire.bind(pool);
  pool.acquire = async function instrumentedAcquire() {
    const start = process.hrtime.bigint();
    const conn = await originalAcquire();
    m.observeAcquireDuration(Number(process.hrtime.bigint() - start) / 1e9);
    refreshGauge();
    return conn;
  };

  const originalQuery = pool.query.bind(pool);
  pool.query = async function instrumentedQuery(sql: string, params?: unknown[]) {
    const start = process.hrtime.bigint();
    try {
      return await originalQuery(sql, params);
    } finally {
      m.observeQueryDuration(Number(process.hrtime.bigint() - start) / 1e9);
    }
  };

  refreshGauge();
  return () => pool.events.off('pool:exhausted', onExhausted);
}

/**
 * Wire a `KafkaClient`: count produced/consumed messages per topic and set
 * consumer lag (high-watermark minus the next consumed offset) on fetch.
 */
export function instrumentKafkaClient(client: KafkaClient, m: SubsystemMetrics): void {
  const originalProduce = client.produce.bind(client);
  client.produce = async function instrumentedProduce(topic, partition, records: KafkaRecord[], opts) {
    const offset = await originalProduce(topic, partition, records, opts);
    m.recordProduced(topic, records.length);
    return offset;
  };

  const originalFetch = client.fetch.bind(client);
  client.fetch = async function instrumentedFetch(topic, partition, fetchOffset, opts) {
    const result = await originalFetch(topic, partition, fetchOffset, opts);
    m.recordConsumed(topic, result.records.length);
    // Lag = high-watermark − next offset the consumer will read.
    const nextOffset = fetchOffset + BigInt(result.records.length);
    const lag = result.highWatermark > nextOffset ? Number(result.highWatermark - nextOffset) : 0;
    m.setConsumerLag(topic, partition, lag);
    return result;
  };
}

/**
 * Wire a `CoordinatorReadinessGate`: observe the wait duration (seconds) every
 * time the gate is awaited, whether it becomes ready or times out.
 */
export function instrumentCoordinatorGate(gate: CoordinatorReadinessGate, m: SubsystemMetrics): void {
  const originalAwait = gate.await.bind(gate);
  gate.await = async function instrumentedAwait() {
    const result = await originalAwait();
    m.observeCoordinatorWait(result.waitedMs * SECONDS_PER_MS);
    return result;
  };
}

/** Wire a `RabbitMqPublisher`: count published messages per exchange. */
export function instrumentRabbitMqPublisher(
  publisher: RabbitMqPublisher,
  m: SubsystemMetrics,
  exchange: string,
): void {
  const originalPublish = publisher.publish.bind(publisher);
  publisher.publish = async function instrumentedPublish(routingKey, body, opts) {
    await originalPublish(routingKey, body, opts);
    m.recordPublished(exchange);
  };
}

/**
 * Wire a `RabbitMqConsumer`: count delivered messages for `queue`. The consumer
 * handler is wrapped so every delivered message is counted before handling.
 */
export function instrumentRabbitMqConsumer(
  consumer: RabbitMqConsumer,
  m: SubsystemMetrics,
  queue: string,
): void {
  const originalConsume = consumer.consume.bind(consumer);
  consumer.consume = function instrumentedConsume(handler: (msg: DeliveredMessage) => Promise<void>) {
    return originalConsume(async (msg) => {
      m.recordDelivered(queue);
      await handler(msg);
    });
  };
}

/**
 * Wire a `PluginHost`: count signature failures, observe install duration, and
 * refresh the `plugin_host_plugins{state}` gauge as plugins register/enable.
 */
export function instrumentPluginHost(host: PluginHost, m: SubsystemMetrics): void {
  const refreshCounts = (): void => {
    let registered = 0;
    let enabled = 0;
    let disabled = 0;
    for (const name of host.list()) {
      const state = host.state(name);
      registered += 1;
      if (state === 'enabled') enabled += 1;
      else if (state === 'disabled') disabled += 1;
    }
    m.setPluginCounts({ registered, enabled, disabled });
  };

  const originalRegister = host.register.bind(host);
  host.register = function instrumentedRegister(plugin, manifest) {
    try {
      originalRegister(plugin, manifest);
    } catch (err) {
      if (err instanceof PluginSignatureError) {
        m.recordSignatureFailure();
      }
      throw err;
    }
    refreshCounts();
  };

  const originalEnable = host.enable.bind(host);
  host.enable = async function instrumentedEnable(name: string) {
    const start = process.hrtime.bigint();
    await originalEnable(name);
    m.observeInstallDuration(Number(process.hrtime.bigint() - start) / 1e9);
    refreshCounts();
  };

  refreshCounts();
}

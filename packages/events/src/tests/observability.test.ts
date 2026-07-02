// src/tests/observability.test.ts
// Integration tests for events health/metrics registration against the real
// core HealthCheckRegistry and MetricsRegistry.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { HealthCheckRegistry, MetricsRegistry, Counter, Gauge, Histogram } from 'streetjs';

import { createEvents } from '../facade.js';
import { MemoryEventStore } from '../store/memory.js';
import {
  registerEventsObservability,
  EVENTS_HEALTH_CHECK_NAME,
  EVENTS_PUBLISHED_METRIC,
  EVENTS_DELIVERED_METRIC,
  EVENTS_FAILED_METRIC,
  EVENTS_HANDLER_LATENCY_METRIC,
  EVENTS_LISTENERS_METRIC,
  EVENTS_ASYNC_PENDING_METRIC,
} from '../observability.js';

interface AppEvents {
  'user.created': { id: string };
}

test('registers the events health check and reports up with an in-memory store', async () => {
  const health = new HealthCheckRegistry();
  const obs = registerEventsObservability({ health });
  const events = createEvents<AppEvents>({ telemetry: obs.telemetry, store: new MemoryEventStore() });
  obs.attach(events);

  const live = await health.runLiveness();
  assert.ok(EVENTS_HEALTH_CHECK_NAME in live.checks);
  const check = live.checks[EVENTS_HEALTH_CHECK_NAME]!;
  assert.equal(check.status, 'up');
  assert.equal(check.details?.['dispatcher'], 'up');
  assert.equal(check.details?.['store'], 'up');

  obs.close();
  await events.close();
});

test('exports all event metrics of the correct kind and reflects live counts', async () => {
  const metrics = new MetricsRegistry();
  const obs = registerEventsObservability({ metrics });
  const events = createEvents<AppEvents>({ telemetry: obs.telemetry });
  obs.attach(events);

  // Metrics registered, correct kinds.
  assert.ok(metrics.get(EVENTS_PUBLISHED_METRIC) instanceof Counter);
  assert.ok(metrics.get(EVENTS_DELIVERED_METRIC) instanceof Counter);
  assert.ok(metrics.get(EVENTS_FAILED_METRIC) instanceof Counter);
  assert.ok(metrics.get(EVENTS_HANDLER_LATENCY_METRIC) instanceof Histogram);
  assert.ok(metrics.get(EVENTS_LISTENERS_METRIC) instanceof Gauge);
  assert.ok(metrics.get(EVENTS_ASYNC_PENDING_METRIC) instanceof Gauge);

  events.on('user.created', () => {});
  events.on('user.created', () => {
    throw new Error('boom');
  });

  await events.publish('user.created', { id: 'u1' });
  await events.publish('user.created', { id: 'u2' });
  obs.refresh();

  // Counters advanced via the telemetry sink.
  assert.match((metrics.get(EVENTS_PUBLISHED_METRIC) as Counter).render(), /events_published_total 2/);
  assert.match((metrics.get(EVENTS_DELIVERED_METRIC) as Counter).render(), /events_delivered_total 2/);
  assert.match((metrics.get(EVENTS_FAILED_METRIC) as Counter).render(), /events_failed_total 2/);

  // Latency histogram recorded the two successful deliveries.
  assert.match(
    (metrics.get(EVENTS_HANDLER_LATENCY_METRIC) as Histogram).render(),
    /event_handler_latency_seconds_count 2/,
  );

  // Listener gauge reflects the two subscriptions after refresh().
  assert.match(
    (metrics.get(EVENTS_LISTENERS_METRIC) as Gauge).render(),
    /events_listeners\{kind="total"\} 2/,
  );

  obs.close();
  await events.close();
});

test('reading/rendering metrics never throws and registration is idempotent', async () => {
  const metrics = new MetricsRegistry();
  const first = registerEventsObservability({ metrics });
  // A second registration against the same registry must not throw.
  let second!: ReturnType<typeof registerEventsObservability>;
  assert.doesNotThrow(() => {
    second = registerEventsObservability({ metrics });
  });

  const events = createEvents<AppEvents>({ telemetry: first.telemetry });
  first.attach(events);
  await events.publish('user.created', { id: 'u' });

  assert.doesNotThrow(() => {
    first.refresh();
    second.refresh();
    metrics.collect();
  });

  first.close();
  second.close();
  await events.close();
});

test('the health check reports down when a configured store reports down', async () => {
  const health = new HealthCheckRegistry();
  // A store stub that reports down.
  const downStore = {
    append: async () => {},
    read: async () => [],
    count: async () => 0,
    clear: async () => {},
    health: () => ({ status: 'down' as const, details: { reason: 'unreachable' } }),
  };
  const obs = registerEventsObservability({ health });
  const events = createEvents<AppEvents>({ telemetry: obs.telemetry, store: downStore, persist: false });
  obs.attach(events);

  const live = await health.runLiveness();
  assert.equal(live.checks[EVENTS_HEALTH_CHECK_NAME]!.status, 'down');
  assert.equal(live.checks[EVENTS_HEALTH_CHECK_NAME]!.details?.['store'], 'down');

  obs.close();
  await events.close();
});

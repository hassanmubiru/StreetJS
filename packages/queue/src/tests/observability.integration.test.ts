// src/tests/observability.integration.test.ts
// Task 12.2 — integration tests for queue health/metrics registration
// (Req 12.1, 12.2, 12.3).
//
// These are true integration tests: they wire the real
// `registerQueueObservability` against a REAL `MemoryDriver` (the facade's
// default driver), a REAL `Worker` (from `createQueue().work()`), and FRESH core
// `HealthCheckRegistry` / `MetricsRegistry` instances imported from `streetjs`.
// Nothing here is mocked — jobs are dispatched, processed, and dead-lettered
// end-to-end so the exported gauges/counters reflect genuine live state.
//
// Coverage:
//   - Req 12.1: the queue health check named `queue` is registered and, through
//     `health.runLiveness()`, reports `up` for the Memory driver (overall
//     status `ok`, `checks['queue'].status === 'up'`).
//   - Req 12.2: the five queue metrics (queue-length gauge, worker-status gauge,
//     job-latency histogram, processed/failure counters) are exported through
//     the `MetricsRegistry`, of the correct metric kind, and reflect live driver
//     / worker state after `refresh()`; `observeLatency` records into the
//     histogram.
//   - Req 12.3: reading/rendering metrics never throws and returns a best-effort
//     snapshot — `refresh()` and the exposition render are exercised repeatedly,
//     including right after `close()`.
//   - Idempotency: calling `registerQueueObservability` twice against the SAME
//     registries reuses the existing metrics/check rather than throwing.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { HealthCheckRegistry, MetricsRegistry, Gauge, Counter, Histogram } from 'streetjs';

import { createQueue } from '../facade.js';
import { Job } from '../job.js';
import {
  registerQueueObservability,
  QUEUE_HEALTH_CHECK_NAME,
  QUEUE_LENGTH_METRIC,
  QUEUE_WORKER_STATUS_METRIC,
  QUEUE_JOB_LATENCY_METRIC,
  QUEUE_PROCESSED_METRIC,
  QUEUE_FAILURES_METRIC,
} from '../observability.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** A job whose handler always succeeds (drives the `processed` counter). */
class OkJob extends Job<{ n: number }> {
  readonly type = 'ok';
  constructor(n: number) {
    super({ n });
  }
}

/** A job whose handler always throws (drives dead-lettering / the `failed` counter). */
class BadJob extends Job<{ n: number }> {
  readonly type = 'bad';
  constructor(n: number) {
    super({ n });
  }
}

/** Await until `predicate` (sync or async) holds or the deadline passes. */
async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 2000,
): Promise<void> {
  const start = Date.now();
  while (!(await predicate())) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor timed out');
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

// ── Req 12.1: health check registration + `up` for the Memory driver ───────────

test('registers the queue health check and reports up for the Memory driver (Req 12.1)', async () => {
  const queue = createQueue();
  const health = new HealthCheckRegistry();
  const worker = queue.work({ pollIntervalMs: 10 });

  const handle = registerQueueObservability({ driver: queue.driver, worker, health });

  // The check is reported through the core registry: overall liveness is `ok`
  // and the `queue` check itself is `up` (the MemoryDriver is always up, Req 12.5).
  const response = await health.runLiveness();
  assert.equal(response.status, 'ok', 'overall liveness is ok with only the up queue check');
  assert.ok(
    QUEUE_HEALTH_CHECK_NAME in response.checks,
    `the '${QUEUE_HEALTH_CHECK_NAME}' check is registered and reported`,
  );
  const queueCheck = response.checks[QUEUE_HEALTH_CHECK_NAME]!;
  assert.equal(queueCheck.status, 'up', 'the Memory driver reports up');
  assert.equal(typeof queueCheck.durationMs, 'number', 'the check carries a durationMs');
  // Worker liveness is attached to the check details for operator visibility.
  assert.equal(queueCheck.details?.['driver'], 'up', 'driver connectivity is surfaced');
  assert.ok(queueCheck.details?.['worker'], 'worker liveness is attached to the check details');

  handle.close();
  await worker.stop();
  await queue.close();
});

// ── Req 12.2: all five metrics registered, of the correct kind ────────────────

test('exports all five queue metrics of the correct kind through the MetricsRegistry (Req 12.2)', async () => {
  const queue = createQueue();
  const metrics = new MetricsRegistry();
  const worker = queue.work({ pollIntervalMs: 10 });

  const handle = registerQueueObservability({ driver: queue.driver, worker, metrics });

  // Every one of the five metrics is registered.
  for (const name of [
    QUEUE_LENGTH_METRIC,
    QUEUE_WORKER_STATUS_METRIC,
    QUEUE_JOB_LATENCY_METRIC,
    QUEUE_PROCESSED_METRIC,
    QUEUE_FAILURES_METRIC,
  ]) {
    assert.equal(metrics.has(name), true, `${name} is registered`);
  }

  // ...and each is of the correct metric kind.
  assert.ok(metrics.get(QUEUE_LENGTH_METRIC) instanceof Gauge, 'queue_length is a Gauge');
  assert.ok(
    metrics.get(QUEUE_WORKER_STATUS_METRIC) instanceof Gauge,
    'queue_worker_status is a Gauge',
  );
  assert.ok(
    metrics.get(QUEUE_JOB_LATENCY_METRIC) instanceof Histogram,
    'queue_job_latency_seconds is a Histogram',
  );
  assert.ok(
    metrics.get(QUEUE_PROCESSED_METRIC) instanceof Counter,
    'queue_processed_total is a Counter',
  );
  assert.ok(
    metrics.get(QUEUE_FAILURES_METRIC) instanceof Counter,
    'queue_failures_total is a Counter',
  );

  handle.close();
  await worker.stop();
  await queue.close();
});

// ── Req 12.2: metrics reflect live state after processing jobs + refresh ───────

test('metrics reflect live driver/worker state after processing jobs and refresh (Req 12.2)', async () => {
  const queue = createQueue();
  const health = new HealthCheckRegistry();
  const metrics = new MetricsRegistry();

  const processed: number[] = [];
  queue.register<{ n: number }>('ok', (payload) => {
    processed.push(payload.n);
  });
  queue.register<{ n: number }>('bad', () => {
    throw new Error('always fails');
  });

  // Dispatch a mix of succeeding and (single-attempt) failing jobs so both the
  // processed and failure counters have something to reflect.
  await queue.dispatch(new OkJob(1));
  await queue.dispatch(new OkJob(2));
  await queue.dispatch(new OkJob(3));
  await queue.dispatch(new BadJob(1), { maxAttempts: 1 });
  await queue.dispatch(new BadJob(2), { maxAttempts: 1 });

  const worker = queue.work({ pollIntervalMs: 10 });
  const handle = registerQueueObservability({ driver: queue.driver, worker, health, metrics });
  worker.start();

  // Wait until three jobs succeed and two are dead-lettered.
  await waitFor(async () => {
    const dl = await queue.driver.listDeadLetters(undefined, 1000);
    return processed.length === 3 && dl.length === 2;
  });

  // Force an immediate snapshot so the gauges/counters reflect the drained state.
  await handle.refresh();

  const status = worker.status();
  assert.equal(status.processed, 3, 'worker processed the three ok jobs');
  assert.equal(status.failed, 2, 'worker dead-lettered the two bad jobs');

  // Worker-status gauge reflects live processed/failed/in-flight values.
  const workerGauge = metrics.get(QUEUE_WORKER_STATUS_METRIC) as Gauge;
  const workerText = workerGauge.render();
  assert.match(workerText, /queue_worker_status\{field="processed"\} 3/, 'processed gauge is 3');
  assert.match(workerText, /queue_worker_status\{field="failed"\} 2/, 'failed gauge is 2');
  assert.match(workerText, /queue_worker_status\{field="in_flight"\} 0/, 'no jobs in flight');

  // Processed/failure counters advanced to the live totals.
  const processedText = (metrics.get(QUEUE_PROCESSED_METRIC) as Counter).render();
  assert.match(processedText, /queue_processed_total 3/, 'processed counter is 3');
  const failuresText = (metrics.get(QUEUE_FAILURES_METRIC) as Counter).render();
  assert.match(failuresText, /queue_failures_total 2/, 'failures counter is 2');

  // Queue-length gauge reflects the drained driver: nothing ready/reserved, the
  // two dead jobs counted as dead_lettered for the default queue.
  const lengthText = (metrics.get(QUEUE_LENGTH_METRIC) as Gauge).render();
  assert.match(lengthText, /queue_length\{queue="default",state="ready"\} 0/, 'no ready jobs');
  assert.match(
    lengthText,
    /queue_length\{queue="default",state="dead_lettered"\} 2/,
    'two dead-lettered jobs',
  );

  // observeLatency records into the latency histogram (Req 12.2).
  handle.observeLatency(0.5);
  const latencyText = (metrics.get(QUEUE_JOB_LATENCY_METRIC) as Histogram).render();
  assert.match(latencyText, /queue_job_latency_seconds_count 1/, 'one latency sample recorded');
  assert.match(latencyText, /queue_job_latency_seconds_sum 0\.5/, 'latency sum is 0.5s');

  // The whole exposition renders without throwing and includes all metrics.
  const exposition = metrics.collect();
  for (const name of [
    QUEUE_LENGTH_METRIC,
    QUEUE_WORKER_STATUS_METRIC,
    QUEUE_JOB_LATENCY_METRIC,
    QUEUE_PROCESSED_METRIC,
    QUEUE_FAILURES_METRIC,
  ]) {
    assert.ok(exposition.includes(name), `${name} appears in the exposition`);
  }

  handle.close();
  await worker.stop();
  await queue.close();
});

// ── Req 12.3: reading/rendering never throws (best-effort snapshot) ────────────

test('reading and rendering metrics never throws, including after close (Req 12.3)', async () => {
  const queue = createQueue();
  const metrics = new MetricsRegistry();
  const worker = queue.work({ pollIntervalMs: 10 });

  const handle = registerQueueObservability({ driver: queue.driver, worker, metrics });

  // Repeated refresh + render is a best-effort snapshot and must never throw.
  await assert.doesNotReject(async () => {
    for (let i = 0; i < 5; i += 1) {
      await handle.refresh();
      metrics.collect();
    }
  }, 'repeated refresh/render never throws');

  // Tear the queue down, then confirm a scrape after close() still succeeds and
  // returns a best-effort snapshot rather than throwing.
  handle.observeLatency(0.25);
  await worker.stop();
  await queue.close();
  handle.close();

  await assert.doesNotReject(async () => {
    await handle.refresh();
    metrics.collect();
    // Idempotent close is safe.
    handle.close();
    await handle.refresh();
    metrics.collect();
  }, 'refresh/render after close never throws');
});

// ── Idempotency: registering twice against the SAME registries is safe ─────────

test('registering observability twice against the same registries reuses metrics/check without throwing (Req 12.2)', async () => {
  const queue = createQueue();
  const health = new HealthCheckRegistry();
  const metrics = new MetricsRegistry();
  const worker = queue.work({ pollIntervalMs: 10 });

  const first = registerQueueObservability({ driver: queue.driver, worker, health, metrics });

  // A second registration against the SAME registries must not throw a
  // MetricConflictError — it reuses the existing metrics/check.
  let second!: ReturnType<typeof registerQueueObservability>;
  assert.doesNotThrow(() => {
    second = registerQueueObservability({ driver: queue.driver, worker, health, metrics });
  }, 'a second registration reuses existing metrics rather than throwing');

  // The five metrics are still present exactly once each (reused, not duplicated).
  for (const name of [
    QUEUE_LENGTH_METRIC,
    QUEUE_WORKER_STATUS_METRIC,
    QUEUE_JOB_LATENCY_METRIC,
    QUEUE_PROCESSED_METRIC,
    QUEUE_FAILURES_METRIC,
  ]) {
    assert.equal(metrics.has(name), true, `${name} remains registered after the second call`);
  }

  // Both handles work and rendering still succeeds.
  await assert.doesNotReject(async () => {
    await first.refresh();
    await second.refresh();
    metrics.collect();
  });

  first.close();
  second.close();
  await worker.stop();
  await queue.close();
});

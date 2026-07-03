// Unit tests for the @streetjs/workflow observability wiring built by
// `registerWorkflowObservability` (Task 16.2).
//
// These tests exercise the metrics + persistence-store health-check registration
// against the *real* core `MetricsRegistry` / `HealthCheckRegistry` primitives
// (no doubles for the registries), asserting the observable contract:
//
//   - All required workflow metrics are registered when a `MetricsRegistry` is
//     supplied — `reg.has(name)` is true for every exported metric-name constant
//     (Req 21.3).
//   - Registration is idempotent against a shared registry: registering twice
//     with the SAME registry does not throw and reuses the same metric instance
//     rather than conflicting (Req 21.6 / the `reg.has ? reg.get : reg.counter`
//     contract).
//   - With no `MetricsRegistry`, no metric is registered and the telemetry sink
//     is inert — its hooks are absent and driving the handle never throws
//     (Req 21.4).
//   - When a `HealthCheckRegistry` is supplied, `attach` registers the
//     persistence-store health check under `WORKFLOW_STORE_HEALTH_CHECK_NAME` and
//     running it maps `store.probe()` onto a `CheckResult`: `available: true` maps
//     to `up`, `available: false` maps to `down` (Req 21.5).
//
// Everything runs against a small `WorkflowIntrospect` double exposing `stats()`
// and `probe()`, so the tests need no engine and no external services.
//
// Requirements: 21.3, 21.4, 21.5

import test from "node:test";
import assert from "node:assert/strict";

import { MetricsRegistry, HealthCheckRegistry } from "streetjs";

import {
  registerWorkflowObservability,
  WORKFLOW_STORE_HEALTH_CHECK_NAME,
  WORKFLOW_RUNNING_METRIC,
  WORKFLOW_COMPLETED_METRIC,
  WORKFLOW_FAILED_METRIC,
  WORKFLOW_RETRIES_METRIC,
  WORKFLOW_COMPENSATIONS_METRIC,
  WORKFLOW_DURATION_METRIC,
  WORKFLOW_ACTIVE_TIMERS_METRIC,
  WORKFLOW_QUEUED_ACTIVITIES_METRIC,
} from "../observability.js";
import type { WorkflowIntrospect } from "../observability.js";
import type { StoreProbe, WorkflowStats } from "../types.js";

// ── Test harness ─────────────────────────────────────────────────────────────────

/** Every workflow metric-name constant that must be registered (Req 21.3). */
const ALL_METRIC_NAMES = [
  WORKFLOW_RUNNING_METRIC,
  WORKFLOW_COMPLETED_METRIC,
  WORKFLOW_FAILED_METRIC,
  WORKFLOW_RETRIES_METRIC,
  WORKFLOW_COMPENSATIONS_METRIC,
  WORKFLOW_DURATION_METRIC,
  WORKFLOW_ACTIVE_TIMERS_METRIC,
  WORKFLOW_QUEUED_ACTIVITIES_METRIC,
] as const;

/** A neutral, zeroed stats snapshot for the gauges. */
function zeroStats(): WorkflowStats {
  return {
    running: 0,
    waiting: 0,
    completed: 0,
    failed: 0,
    compensated: 0,
    cancelled: 0,
    activityRetries: 0,
    compensations: 0,
    activeTimers: 0,
    queuedActivities: 0,
  };
}

/**
 * A minimal {@link WorkflowIntrospect} double: a synchronous `stats()` snapshot
 * for the gauges and a `probe()` whose availability the test controls.
 */
function makeIntrospect(
  probeResult: StoreProbe,
  stats: WorkflowStats = zeroStats(),
): WorkflowIntrospect {
  return {
    stats: () => stats,
    probe: async () => probeResult,
  };
}

// ── Metrics registration (Req 21.3) ───────────────────────────────────────────────

test("registers every workflow metric when a metrics registry is supplied", () => {
  const metrics = new MetricsRegistry();

  registerWorkflowObservability({ metrics });

  for (const name of ALL_METRIC_NAMES) {
    assert.equal(metrics.has(name), true, `expected metric ${name} to be registered`);
  }
});

test("metrics telemetry hooks are wired and drive without throwing", () => {
  const metrics = new MetricsRegistry();
  const { telemetry } = registerWorkflowObservability({ metrics });

  // With a registry present the sink is live: every hook is a function.
  assert.equal(typeof telemetry.onCompleted, "function");
  assert.equal(typeof telemetry.onFailed, "function");
  assert.equal(typeof telemetry.onRetries, "function");
  assert.equal(typeof telemetry.onCompensations, "function");

  // Driving them records against the real metrics and never throws.
  assert.doesNotThrow(() => {
    telemetry.onCompleted?.(1.5);
    telemetry.onFailed?.(2.5);
    telemetry.onRetries?.(3);
    telemetry.onCompensations?.(2);
  });
});

// ── Idempotent registration against a shared registry (Req 21.6) ───────────────────

test("registering twice against the same registry does not throw and reuses metrics", () => {
  const metrics = new MetricsRegistry();

  // First registration creates the metrics.
  assert.doesNotThrow(() => registerWorkflowObservability({ metrics }));

  // Capture the metric instances created by the first registration.
  const before = ALL_METRIC_NAMES.map((name) => metrics.get(name));

  // A second registration against the SAME registry must not throw
  // (a naive `reg.counter(name, ...)` would raise a MetricConflictError).
  assert.doesNotThrow(() => registerWorkflowObservability({ metrics }));

  // ...and must reuse the exact same metric instances, not replace them.
  for (let i = 0; i < ALL_METRIC_NAMES.length; i++) {
    const name = ALL_METRIC_NAMES[i]!;
    assert.equal(metrics.has(name), true);
    assert.equal(
      metrics.get(name),
      before[i],
      `expected metric ${name} to be reused, not re-created`,
    );
  }
});

// ── No metrics registry → nothing registered, inert telemetry (Req 21.4) ───────────

test("skips metric registration entirely when no metrics registry is supplied", () => {
  // A registry we do NOT pass in must stay empty — nothing is registered when
  // observability is created without a metrics registry.
  const untouched = new MetricsRegistry();
  registerWorkflowObservability();
  assert.deepEqual(untouched.names(), []);
});

test("telemetry is inert and the handle is safe to drive without a metrics registry", () => {
  const handle = registerWorkflowObservability();

  // No metrics registry ⇒ the sink is a complete no-op: no hooks present.
  assert.equal(handle.telemetry.onCompleted, undefined);
  assert.equal(handle.telemetry.onFailed, undefined);
  assert.equal(handle.telemetry.onRetries, undefined);
  assert.equal(handle.telemetry.onCompensations, undefined);

  // refresh() before attach, attach(), a second refresh(), and close() must all
  // be safe no-ops that never throw.
  assert.doesNotThrow(() => {
    handle.refresh();
    handle.attach(makeIntrospect({ available: true }));
    handle.refresh();
    handle.close();
  });
});

// ── Store health check maps probe → CheckResult (Req 21.5) ─────────────────────────

test("attaching with a health registry registers the store check and maps available → up", async () => {
  const health = new HealthCheckRegistry();
  const handle = registerWorkflowObservability({ health });

  handle.attach(makeIntrospect({ available: true, detail: "memory" }));

  const response = await health.runReadiness();
  const check = response.checks[WORKFLOW_STORE_HEALTH_CHECK_NAME];

  assert.ok(check, `expected a "${WORKFLOW_STORE_HEALTH_CHECK_NAME}" check to be registered`);
  assert.equal(check.status, "up");
});

test("the store health check maps an unavailable probe → down", async () => {
  const health = new HealthCheckRegistry();
  const handle = registerWorkflowObservability({ health });

  handle.attach(makeIntrospect({ available: false, detail: "unreachable" }));

  const response = await health.runReadiness();
  const check = response.checks[WORKFLOW_STORE_HEALTH_CHECK_NAME];

  assert.ok(check, `expected a "${WORKFLOW_STORE_HEALTH_CHECK_NAME}" check to be registered`);
  assert.equal(check.status, "down");
});

test("no health check is registered when no health registry is supplied", async () => {
  const health = new HealthCheckRegistry();

  // Observability created WITHOUT the health registry: attaching registers no
  // check against `health`, so a readiness run over it is empty.
  const handle = registerWorkflowObservability();
  handle.attach(makeIntrospect({ available: true }));

  const response = await health.runReadiness();
  assert.equal(response.checks[WORKFLOW_STORE_HEALTH_CHECK_NAME], undefined);
});

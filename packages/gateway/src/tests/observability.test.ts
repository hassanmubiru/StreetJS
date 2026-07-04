// Unit tests for the @streetjs/gateway observability wiring built by
// `registerGatewayObservability`.
//
// These tests exercise the metrics + upstream health-check registration against
// the *real* core `MetricsRegistry` / `HealthCheckRegistry` primitives (no
// doubles for the registries), asserting the observable contract:
//
//   - All required gateway metrics are registered when a `MetricsRegistry` is
//     supplied — `reg.has(name)` is true for every exported metric-name constant.
//   - Registration is idempotent against a shared registry: registering twice
//     with the SAME registry does not throw and reuses the same metric instance
//     rather than conflicting (the `reg.has ? reg.get : reg.counter` contract).
//   - With no `MetricsRegistry`, no metric is registered and the telemetry sink
//     is inert — its hooks are absent and driving the handle never throws.
//   - When a `HealthCheckRegistry` is supplied, `attach` registers the upstream
//     health check under `GATEWAY_HEALTH_CHECK_NAME` and running it maps
//     `stats().healthyUpstreams`: `> 0` maps to `up`, `0` maps to `down`.
//
// Everything runs against a small `GatewayIntrospect` double exposing `stats()`,
// so the tests need no running gateway and no external services.

import test from "node:test";
import assert from "node:assert/strict";

import { MetricsRegistry, HealthCheckRegistry } from "streetjs";

import {
  registerGatewayObservability,
  GATEWAY_HEALTH_CHECK_NAME,
  GATEWAY_REQUESTS_TOTAL,
  GATEWAY_ERRORS_TOTAL,
  GATEWAY_LATENCY,
  GATEWAY_ACTIVE_CONNECTIONS,
  GATEWAY_BACKEND_HEALTHY,
} from "../observability.js";
import type { GatewayIntrospect, GatewayStats } from "../observability.js";

// ── Test harness ─────────────────────────────────────────────────────────────────

/** Every gateway metric-name constant that must be registered. */
const ALL_METRIC_NAMES = [
  GATEWAY_REQUESTS_TOTAL,
  GATEWAY_ERRORS_TOTAL,
  GATEWAY_LATENCY,
  GATEWAY_ACTIVE_CONNECTIONS,
  GATEWAY_BACKEND_HEALTHY,
] as const;

/** A neutral, zeroed stats snapshot for the gauges. */
function zeroStats(): GatewayStats {
  return {
    activeConnections: 0,
    requestsTotal: 0,
    errorsTotal: 0,
    healthyUpstreams: 0,
    unhealthyUpstreams: 0,
  };
}

/**
 * A minimal {@link GatewayIntrospect} double: a synchronous `stats()` snapshot
 * the test controls, used for the gauges and the upstream health check.
 */
function makeIntrospect(stats: GatewayStats = zeroStats()): GatewayIntrospect {
  return {
    stats: () => stats,
  };
}

// ── Metrics registration ───────────────────────────────────────────────────────────

test("registers every gateway metric when a metrics registry is supplied", () => {
  const metrics = new MetricsRegistry();

  registerGatewayObservability({ metrics });

  for (const name of ALL_METRIC_NAMES) {
    assert.equal(metrics.has(name), true, `expected metric ${name} to be registered`);
  }
});

test("metrics telemetry hooks are wired and drive without throwing", () => {
  const metrics = new MetricsRegistry();
  const { telemetry } = registerGatewayObservability({ metrics });

  // With a registry present the sink is live: every hook is a function.
  assert.equal(typeof telemetry.onRequest, "function");
  assert.equal(typeof telemetry.onConnectionOpen, "function");
  assert.equal(typeof telemetry.onConnectionClose, "function");

  // Driving them records against the real metrics and never throws.
  assert.doesNotThrow(() => {
    telemetry.onRequest?.(12.5, false);
    telemetry.onRequest?.(30.0, true);
    telemetry.onConnectionOpen?.();
    telemetry.onConnectionOpen?.();
    telemetry.onConnectionClose?.();
    telemetry.onConnectionClose?.();
    // Extra close must not underflow.
    telemetry.onConnectionClose?.();
  });
});

// ── Idempotent registration against a shared registry ────────────────────────────────

test("registering twice against the same registry does not throw and reuses metrics", () => {
  const metrics = new MetricsRegistry();

  // First registration creates the metrics.
  assert.doesNotThrow(() => registerGatewayObservability({ metrics }));

  // Capture the metric instances created by the first registration.
  const before = ALL_METRIC_NAMES.map((name) => metrics.get(name));

  // A second registration against the SAME registry must not throw
  // (a naive `reg.counter(name, ...)` would raise a MetricConflictError).
  assert.doesNotThrow(() => registerGatewayObservability({ metrics }));

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

// ── No metrics registry → nothing registered, inert telemetry ──────────────────────

test("skips metric registration entirely when no metrics registry is supplied", () => {
  // A registry we do NOT pass in must stay empty — nothing is registered when
  // observability is created without a metrics registry.
  const untouched = new MetricsRegistry();
  registerGatewayObservability();
  assert.deepEqual(untouched.names(), []);
});

test("telemetry is inert and the handle is safe to drive without a metrics registry", () => {
  const handle = registerGatewayObservability();

  // No metrics registry ⇒ the sink is a complete no-op: no hooks present.
  assert.equal(handle.telemetry.onRequest, undefined);
  assert.equal(handle.telemetry.onConnectionOpen, undefined);
  assert.equal(handle.telemetry.onConnectionClose, undefined);

  // refresh() before attach, attach(), a second refresh(), and close() must all
  // be safe no-ops that never throw.
  assert.doesNotThrow(() => {
    handle.refresh();
    handle.attach(makeIntrospect());
    handle.refresh();
    handle.close();
  });
});

// ── Upstream health check maps stats → CheckResult ───────────────────────────────────

test("attaching with a health registry registers the upstream check and maps healthy > 0 → up", async () => {
  const health = new HealthCheckRegistry();
  const handle = registerGatewayObservability({ health });

  handle.attach(
    makeIntrospect({ ...zeroStats(), healthyUpstreams: 2, unhealthyUpstreams: 1 }),
  );

  const response = await health.runReadiness();
  const check = response.checks[GATEWAY_HEALTH_CHECK_NAME];

  assert.ok(check, `expected a "${GATEWAY_HEALTH_CHECK_NAME}" check to be registered`);
  assert.equal(check.status, "up");
});

test("the upstream health check maps zero healthy upstreams → down", async () => {
  const health = new HealthCheckRegistry();
  const handle = registerGatewayObservability({ health });

  handle.attach(
    makeIntrospect({ ...zeroStats(), healthyUpstreams: 0, unhealthyUpstreams: 3 }),
  );

  const response = await health.runReadiness();
  const check = response.checks[GATEWAY_HEALTH_CHECK_NAME];

  assert.ok(check, `expected a "${GATEWAY_HEALTH_CHECK_NAME}" check to be registered`);
  assert.equal(check.status, "down");
});

test("no health check is registered when no health registry is supplied", async () => {
  const health = new HealthCheckRegistry();

  // Observability created WITHOUT the health registry: attaching registers no
  // check against `health`, so a readiness run over it is empty.
  const handle = registerGatewayObservability();
  handle.attach(makeIntrospect({ ...zeroStats(), healthyUpstreams: 1 }));

  const response = await health.runReadiness();
  assert.equal(response.checks[GATEWAY_HEALTH_CHECK_NAME], undefined);
});

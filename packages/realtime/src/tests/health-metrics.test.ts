// src/tests/health-metrics.test.ts
// Task 12.2 — integration tests for the realtime health/metrics wiring (Req
// 17.1, 17.2, 17.4). These exercise the real core observability subsystems
// (`HealthCheckRegistry`, `MetricsRegistry`) two ways:
//
//   1. Through the facade: `createRealtime({ server, health, metrics })` wires
//      observability internally (the same path `RealtimePlugin.onLoad` takes),
//      so the realtime health check is registered and reported through the
//      registry's run API, and the connection/member-count gauges are exported
//      through the MetricsRegistry (Req 17.1, 17.2). A down cluster adapter
//      passed to the facade surfaces `down` through the realtime health check,
//      and the default `MemoryAdapter` surfaces `up` (Req 17.4).
//
//   2. Directly via `registerRealtimeObservability(deps)`: this is the public
//      wiring primitive whose returned handle exposes `refresh()`, letting the
//      tests drive live state (rooms/connections via a `ChannelHub` + the same
//      `FakeConnection` the facade delegates to, and a controllable
//      connection-count source) and then assert the exported gauges reflect it
//      deterministically without waiting on the background refresh interval.
//
//   - Req 17.1: THE Realtime_Framework registers a realtime health check with
//     the Health_Registry reported through the `/health/*` routes. Verified via
//     `HealthCheckRegistry.runLiveness()` — the `realtime` check appears with a
//     status (`registerHealthRoutes` serves exactly that run result on
//     `/health/*`).
//   - Req 17.2: connection-count and per-Room member-count metrics are exported
//     through the Metrics_Registry. Verified by reading the rendered exposition
//     of `REALTIME_CONNECTIONS_METRIC` and `REALTIME_ROOM_MEMBERS_METRIC` after
//     an explicit `refresh()` reflecting driven state.
//   - Req 17.4: WHERE a cluster adapter reports its connectivity, that status
//     surfaces in the realtime health check — `down` for a disconnected adapter
//     (a fake down `ClusterAdapter` and a `RedisAdapter` over a fake broker that
//     loses its connection) and `up` for a healthy `MemoryAdapter`.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  StreetWebSocketServer,
  MetricsRegistry,
  HealthCheckRegistry,
  ChannelHub,
} from 'streetjs';
import type { StreetWebSocketServer as StreetWebSocketServerType } from 'streetjs';
import {
  createRealtime,
  registerRealtimeObservability,
  MemoryAdapter,
  FakeConnection,
  REALTIME_HEALTH_CHECK_NAME,
  REALTIME_CONNECTIONS_METRIC,
  REALTIME_ROOM_MEMBERS_METRIC,
} from '../index.js';
import type {
  Member,
  ClusterAdapter,
  ClusterSink,
  RealtimeMessage,
  BroadcastOptions,
} from '../index.js';
import { RedisAdapter } from '../cluster/redis.js';
import type { RedisPubSubClient } from '../cluster/redis.js';

/** Build a facade over a no-op WebSocket server (no port bound). */
function makeServer(): StreetWebSocketServer {
  return new StreetWebSocketServer();
}

const member = (id: string): Member => ({ id });

// ── Req 17.1 — realtime health check registered + reported via the run API ─────

test('createRealtime registers the realtime health check reported through /health/* (Req 17.1)', async () => {
  const health = new HealthCheckRegistry();
  const realtime = createRealtime({ server: makeServer(), health });
  try {
    // `registerHealthRoutes` serves exactly `runLiveness()` on GET /health/live,
    // so the presence of the `realtime` check here is what `/health/*` reports.
    const response = await health.runLiveness();
    const check = response.checks[REALTIME_HEALTH_CHECK_NAME];
    assert.ok(check, `expected a "${REALTIME_HEALTH_CHECK_NAME}" check to be registered`);
    // Default MemoryAdapter is always healthy.
    assert.equal(check.status, 'up');
    // The adapter connectivity is surfaced in the details, plus the live
    // connection count for operator visibility.
    assert.equal(check.details?.['adapter'], 'up');
    assert.equal(check.details?.['connections'], 0);
    // Overall run is healthy when the only check is up.
    assert.equal(response.status, 'ok');
  } finally {
    await realtime.close();
  }
});

// ── Req 17.2 — connection/member-count gauges registered + exported ────────────

test('createRealtime exports connection-count and per-room member-count gauges through the MetricsRegistry (Req 17.2)', async () => {
  const metrics = new MetricsRegistry();
  const realtime = createRealtime({ server: makeServer(), metrics });
  try {
    // Both gauges are registered on the shared registry…
    assert.ok(
      metrics.has(REALTIME_CONNECTIONS_METRIC),
      `expected ${REALTIME_CONNECTIONS_METRIC} to be registered`,
    );
    assert.ok(
      metrics.has(REALTIME_ROOM_MEMBERS_METRIC),
      `expected ${REALTIME_ROOM_MEMBERS_METRIC} to be registered`,
    );

    // …and both appear in the rendered Prometheus exposition served at /metrics.
    const rendered = metrics.collect();
    assert.match(rendered, new RegExp(`# TYPE ${REALTIME_CONNECTIONS_METRIC} gauge`));
    assert.match(rendered, new RegExp(`# TYPE ${REALTIME_ROOM_MEMBERS_METRIC} gauge`));

    // Driving rooms via the facade + FakeConnection keeps the wiring honest: the
    // facade delegates to the same ChannelHub the gauges read from.
    const room = realtime.room('lobby');
    await room.join(member('alice'), new FakeConnection({ id: 'a' }));
    await room.join(member('bob'), new FakeConnection({ id: 'b' }));
    assert.equal(await room.memberCount(), 2);
  } finally {
    await realtime.close();
  }
});

// ── Req 17.2 — gauges reflect live state after an explicit refresh ─────────────

test('per-room member-count gauge reflects live room state after refresh (Req 17.2)', async () => {
  const metrics = new MetricsRegistry();
  const hub = new ChannelHub({ typingTtlMs: 0 });
  // registerRealtimeObservability is the wiring primitive createRealtime uses;
  // driving `hub` with FakeConnections mirrors exactly how the facade's rooms
  // delegate join/leave to the hub the observability layer reads.
  const handle = registerRealtimeObservability({
    hub,
    adapter: new MemoryAdapter(),
    server: makeServer(),
    metrics,
  });
  try {
    const a = new FakeConnection({ id: 'a' });
    const b = new FakeConnection({ id: 'b' });
    const c = new FakeConnection({ id: 'c' });
    hub.bind(a);
    hub.bind(b);
    hub.bind(c);

    // lobby: alice + bob (2 members). games: alice (1 member).
    hub.join('lobby', 'alice', a);
    hub.join('lobby', 'bob', b);
    hub.join('games', 'alice', c);

    handle.refresh();
    let rendered = metrics.get(REALTIME_ROOM_MEMBERS_METRIC)!.render();
    assert.match(rendered, /realtime_room_members\{room="lobby"\} 2/);
    assert.match(rendered, /realtime_room_members\{room="games"\} 1/);

    // Emptying a room zeroes its gauge on the next refresh rather than leaving a
    // stale non-zero value.
    hub.leave('lobby', 'alice', a);
    hub.leave('lobby', 'bob', b);
    handle.refresh();
    rendered = metrics.get(REALTIME_ROOM_MEMBERS_METRIC)!.render();
    assert.match(rendered, /realtime_room_members\{room="lobby"\} 0/);
    assert.match(rendered, /realtime_room_members\{room="games"\} 1/);
  } finally {
    handle.close();
  }
});

test('connection-count gauge reflects the server connection count after refresh (Req 17.2)', async () => {
  const metrics = new MetricsRegistry();
  const hub = new ChannelHub({ typingTtlMs: 0 });

  // A controllable connection-count source standing in for the WebSocket server,
  // so the gauge can be asserted to track live connection state deterministically
  // (real sockets are not opened in the harness, Req 16.3).
  let connections = 0;
  const server = {
    get connectionCount(): number {
      return connections;
    },
  } as unknown as StreetWebSocketServerType;

  const handle = registerRealtimeObservability({
    hub,
    adapter: new MemoryAdapter(),
    server,
    metrics,
  });
  try {
    // Primed at registration to the current count (0).
    assert.match(
      metrics.get(REALTIME_CONNECTIONS_METRIC)!.render(),
      new RegExp(`^${REALTIME_CONNECTIONS_METRIC}\\s+0$`, 'm'),
    );

    connections = 3;
    handle.refresh();
    assert.match(
      metrics.get(REALTIME_CONNECTIONS_METRIC)!.render(),
      new RegExp(`^${REALTIME_CONNECTIONS_METRIC}\\s+3$`, 'm'),
    );

    connections = 1;
    handle.refresh();
    assert.match(
      metrics.get(REALTIME_CONNECTIONS_METRIC)!.render(),
      new RegExp(`^${REALTIME_CONNECTIONS_METRIC}\\s+1$`, 'm'),
    );
  } finally {
    handle.close();
  }
});

// ── Req 17.4 — adapter connectivity surfaces in the realtime health check ──────

/** A cluster adapter reporting a fixed `down` status, standing in for a lost backend. */
class DownAdapter implements ClusterAdapter {
  async init(_sink: ClusterSink): Promise<void> {
    // Init succeeds — the connectivity loss is modeled by `health()` alone, so
    // the facade wires observability normally (no Req 12.5 init failure here).
  }
  async publish(_c: string, _m: RealtimeMessage, _o: BroadcastOptions): Promise<void> {}
  async publishPresence(_c: string, _m: string, _s: 'join' | 'leave'): Promise<void> {}
  async remotePresence(_c: string): Promise<string[]> {
    return [];
  }
  health(): { status: 'up' | 'down'; details?: Record<string, unknown> } {
    return { status: 'down', details: { reason: 'backend-disconnected' } };
  }
  async close(): Promise<void> {}
}

test('a down cluster adapter surfaces as a down realtime health check through the facade (Req 17.4)', async () => {
  const health = new HealthCheckRegistry();
  const realtime = createRealtime({ server: makeServer(), adapter: new DownAdapter(), health });
  try {
    const response = await health.runLiveness();
    const check = response.checks[REALTIME_HEALTH_CHECK_NAME];
    assert.ok(check, 'realtime check must be registered');
    assert.equal(check.status, 'down', 'a down adapter must surface as a down realtime check');
    assert.equal(check.details?.['adapter'], 'down');
    // The adapter's own details are propagated for operator diagnosis.
    assert.deepEqual(check.details?.['adapterDetails'], { reason: 'backend-disconnected' });
    // A down check degrades the overall liveness run.
    assert.equal(response.status, 'degraded');
  } finally {
    await realtime.close();
  }
});

test('a healthy MemoryAdapter surfaces as an up realtime health check (Req 17.4)', async () => {
  const health = new HealthCheckRegistry();
  const realtime = createRealtime({ server: makeServer(), adapter: new MemoryAdapter(), health });
  try {
    const response = await health.runLiveness();
    const check = response.checks[REALTIME_HEALTH_CHECK_NAME];
    assert.ok(check, 'realtime check must be registered');
    assert.equal(check.status, 'up');
    assert.equal(response.status, 'ok');
  } finally {
    await realtime.close();
  }
});

// ── Req 17.4 — RedisAdapter connectivity surfaces in the realtime health check ──

/**
 * A minimal in-memory fake of the `RedisPubSubClient` surface the `RedisAdapter`
 * uses. `subscribe` resolves so `init` succeeds (adapter reports `up`); flipping
 * `failing = true` makes `publish`/`command` reject, driving the adapter's
 * best-effort degradation path so `health()` flips to `down` on the next
 * operation — modeling a lost broker connection without a real Redis.
 */
class FakeRedisClient implements RedisPubSubClient {
  failing = false;
  async command(_args: unknown[]): Promise<unknown> {
    if (this.failing) throw new Error('redis connection lost');
    return [];
  }
  async publish(_channel: string, _message: string): Promise<void> {
    if (this.failing) throw new Error('redis connection lost');
  }
  async subscribe(_channel: string, _handler: (message: string) => void): Promise<() => void> {
    if (this.failing) throw new Error('redis connection lost');
    return () => {};
  }
}

test('RedisAdapter connectivity status (up then down) surfaces in the realtime health check (Req 17.4)', async () => {
  const health = new HealthCheckRegistry();
  const client = new FakeRedisClient();
  const adapter = new RedisAdapter({ client, keyPrefix: 'streetjs:rt:test:', instanceId: 'A' });

  // Initialize the adapter (subscribe resolves) so it reports connected/up.
  await adapter.init({
    deliverLocal: () => {},
    applyRemotePresence: () => {},
  });

  const hub = new ChannelHub({ typingTtlMs: 0 });
  const handle = registerRealtimeObservability({ hub, adapter, server: makeServer(), health });
  try {
    // Healthy while the fake broker is connected.
    let response = await health.runLiveness();
    let check = response.checks[REALTIME_HEALTH_CHECK_NAME];
    assert.ok(check, 'realtime check must be registered');
    assert.equal(check.status, 'up', 'RedisAdapter should report up while connected');

    // Simulate a broker connection loss: the next publish fails and the adapter
    // degrades, flipping its health to down (Req 13.3 / 17.4).
    client.failing = true;
    await adapter.publish('chat', { type: 'message', payload: { text: 'x' } }, {});

    // The realtime health check re-reads adapter.health() on each run and now
    // reports down — surfacing the Redis connectivity loss (Req 17.4).
    response = await health.runLiveness();
    check = response.checks[REALTIME_HEALTH_CHECK_NAME];
    assert.equal(check?.status, 'down', 'a lost Redis connection must surface as down');
    assert.equal(check?.details?.['adapter'], 'down');
    assert.equal(response.status, 'degraded');
  } finally {
    handle.close();
    await adapter.close();
  }
});

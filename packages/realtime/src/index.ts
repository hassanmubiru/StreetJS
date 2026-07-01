// src/index.ts
// @streetjs/realtime — public typed surface (Req 1.2, 1.4, 1.5).
//
// Every exported symbol carries explicit TypeScript type declarations. The
// Redis adapter (`RedisAdapter` / `RedisAdapterOptions`) is intentionally NOT
// re-exported here — it is available only via the `@streetjs/realtime/redis`
// submodule so Memory_Adapter users pull in no extra runtime deps (Req 13.5).

// ── Facade + Room ─────────────────────────────────────────────────────────────
export { createRealtime } from './facade.js';
export type {
  Member,
  RealtimeMessage,
  RealtimeOptions,
  Realtime,
  Room,
  BroadcastOptions,
} from './facade.js';

// ── Cluster adapters ──────────────────────────────────────────────────────────
export { MemoryAdapter } from './cluster/memory.js';
export type { ClusterAdapter, ClusterSink } from './cluster/adapter.js';

// ── Channel authorization ─────────────────────────────────────────────────────
export type { ChannelAuthorizer } from './auth.js';

// ── Rate limiting ─────────────────────────────────────────────────────────────
export type { RateLimitConfig, RateLimitQuota } from './ratelimit.js';

// ── Plugin registration ───────────────────────────────────────────────────────
export { RealtimePlugin } from './plugin.js';

// ── Health + metrics observability (Req 17) ───────────────────────────────────
export {
  registerRealtimeObservability,
  REALTIME_HEALTH_CHECK_NAME,
  REALTIME_CONNECTIONS_METRIC,
  REALTIME_ROOM_MEMBERS_METRIC,
} from './health.js';
export type {
  RealtimeObservabilityDeps,
  RealtimeObservabilityHandle,
} from './health.js';

// ── Testing utilities (Req 16) ────────────────────────────────────────────────
export { FakeConnection, ManualClock, createHarness, simulateClose } from './testing.js';
export type {
  FakeConnectionOptions,
  HarnessOptions,
  HarnessConnectOptions,
  Harness,
  ClosableConnection,
} from './testing.js';

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

// ── Testing utilities (Req 16) ────────────────────────────────────────────────
export { FakeConnection } from './testing.js';
export type { FakeConnectionOptions } from './testing.js';

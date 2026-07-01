// src/cluster/adapter.ts
// Cross-instance broadcast + presence propagation contracts.
//
// This module declares the `ClusterAdapter` and `ClusterSink` interfaces that
// separate local delivery (always via `ChannelHub`) from cross-instance
// propagation. Concrete adapters implement these contracts: `MemoryAdapter`
// (default, inert — this module + `memory.ts`, task 9.1) and `RedisAdapter`
// (opt-in, `@streetjs/realtime/redis`, task 10.1). These contracts are the
// authoritative, finalized typed surface both adapters conform to.

import type { RealtimeMessage, BroadcastOptions } from '../facade.js';

/**
 * Callback surface the facade hands the adapter so remote events can be
 * re-injected into the local hub. `deliverLocal` MUST deliver to each local
 * connection at most once (Req 7.6).
 */
export interface ClusterSink {
  /** Re-inject a remote broadcast into the local hub exactly once per connection. */
  deliverLocal(channel: string, message: RealtimeMessage, options: BroadcastOptions): void;
  /** Apply a remote presence delta into the local per-instance mirror. */
  applyRemotePresence(channel: string, memberId: string, state: 'join' | 'leave'): void;
}

/** Cross-instance broadcast + presence propagation (Req 12.1). */
export interface ClusterAdapter {
  /** Called once at facade init; MUST reject if it cannot initialize (Req 12.5). */
  init(sink: ClusterSink): Promise<void>;

  /** Fan a broadcast out to peer instances (Req 7.6, 13.1). */
  publish(channel: string, message: RealtimeMessage, options: BroadcastOptions): Promise<void>;

  /** Propagate a local presence delta to peers (Req 5.4, 13.2). */
  publishPresence(channel: string, memberId: string, state: 'join' | 'leave'): Promise<void>;

  /** Members present on OTHER instances for `channel` (local excluded) (Req 5.4). */
  remotePresence(channel: string): Promise<string[]>;

  /** Adapter connectivity for the health check (Req 13.3, 17.4). */
  health(): { status: 'up' | 'down'; details?: Record<string, unknown> };

  /** Release adapter resources. */
  close(): Promise<void>;
}

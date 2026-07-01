// src/cluster/memory.ts
// The zero-dependency, single-instance, in-process default cluster adapter.
//
// All cross-instance methods are inert: local delivery already happened through
// `ChannelHub`, so `publish`/`publishPresence` are no-ops, `remotePresence`
// returns `[]`, and `health()` is always `up`. It contacts no external service
// (Req 12.2, 12.3).
//
// This is a minimal working implementation sufficient for the facade to default
// to it and call `init` (task 3.1). Its full behavior/tests are finalized in
// task 9.1.

import type { ClusterAdapter, ClusterSink } from './adapter.js';
import type { RealtimeMessage, BroadcastOptions } from '../facade.js';

/** The default, zero-dependency, single-instance cluster adapter (Req 12.2). */
export class MemoryAdapter implements ClusterAdapter {
  /**
   * Resolve immediately — the Memory_Adapter contacts no external service, so
   * there is nothing to connect (Req 12.3). The sink is unused because remote
   * re-injection never occurs on a single instance.
   */
  async init(_sink: ClusterSink): Promise<void> {
    // no-op: single-instance adapter has nothing to initialize.
  }

  /**
   * No-op fan-out: the local `ChannelHub.publish` already delivered to every
   * local connection, and there are no peer instances to reach (Req 12.3).
   */
  async publish(
    _channel: string,
    _message: RealtimeMessage,
    _options: BroadcastOptions,
  ): Promise<void> {
    // no-op: nothing to fan out on a single instance.
  }

  /** No-op: presence deltas need no cross-instance propagation (Req 12.3). */
  async publishPresence(
    _channel: string,
    _memberId: string,
    _state: 'join' | 'leave',
  ): Promise<void> {
    // no-op.
  }

  /** No peers exist, so the distributed union equals local presence (Req 5.4). */
  async remotePresence(_channel: string): Promise<string[]> {
    return [];
  }

  /** Always healthy: no external dependency can fail (Req 13.3 inverse). */
  health(): { status: 'up' | 'down'; details?: Record<string, unknown> } {
    return { status: 'up' };
  }

  /** Nothing to release. */
  async close(): Promise<void> {
    // no-op.
  }
}

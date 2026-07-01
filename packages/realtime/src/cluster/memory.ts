// src/cluster/memory.ts
// The zero-dependency, single-instance, in-process default cluster adapter.
//
// All cross-instance methods are inert: local delivery already happened through
// `ChannelHub`, so `publish`/`publishPresence` are no-ops, `remotePresence`
// returns `[]`, and `health()` is always `up`. It contacts no external service
// (Req 12.2, 12.3). The concrete behavior is finalized in task 9.1; this
// scaffold establishes the exported typed surface.

import type { ClusterAdapter, ClusterSink } from './adapter.js';
import type { RealtimeMessage, BroadcastOptions } from '../facade.js';

/** The default, zero-dependency, single-instance cluster adapter (Req 12.2). */
export class MemoryAdapter implements ClusterAdapter {
  async init(_sink: ClusterSink): Promise<void> {
    throw new Error('MemoryAdapter is not implemented yet (see task 9.1)');
  }

  async publish(
    _channel: string,
    _message: RealtimeMessage,
    _options: BroadcastOptions,
  ): Promise<void> {
    throw new Error('MemoryAdapter is not implemented yet (see task 9.1)');
  }

  async publishPresence(
    _channel: string,
    _memberId: string,
    _state: 'join' | 'leave',
  ): Promise<void> {
    throw new Error('MemoryAdapter is not implemented yet (see task 9.1)');
  }

  async remotePresence(_channel: string): Promise<string[]> {
    throw new Error('MemoryAdapter is not implemented yet (see task 9.1)');
  }

  health(): { status: 'up' | 'down'; details?: Record<string, unknown> } {
    throw new Error('MemoryAdapter is not implemented yet (see task 9.1)');
  }

  async close(): Promise<void> {
    throw new Error('MemoryAdapter is not implemented yet (see task 9.1)');
  }
}

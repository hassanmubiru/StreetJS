// src/cluster/redis.ts
// Opt-in Redis-backed cluster adapter, exported ONLY via the
// `@streetjs/realtime/redis` submodule so Memory_Adapter users pull in no extra
// runtime deps (Req 13.5). Concrete pub/sub fan-out + presence union logic lands
// in task 10.1; this scaffold establishes the exported typed surface (Req 13).

import type { RedisLike } from 'streetjs';
import type { ClusterAdapter, ClusterSink } from './adapter.js';
import type { RealtimeMessage, BroadcastOptions } from '../facade.js';

/** A RedisLike client that additionally supports pub/sub. */
export type RedisPubSubClient = RedisLike & {
  publish(channel: string, message: string): Promise<void>;
  subscribe(channel: string, handler: (message: string) => void): Promise<() => void>;
};

/** Options for the {@link RedisAdapter}. */
export interface RedisAdapterOptions {
  /** A connected core `RedisClient`, or any RedisLike + pub/sub capable client. */
  client: RedisPubSubClient;
  /** Key/topic prefix. Defaults to "streetjs:rt:". */
  keyPrefix?: string;
  /** Unique id for THIS instance; defaults to a random uuid. Used to dedupe. */
  instanceId?: string;
  /** Presence key TTL (ms) so a crashed instance's presence self-heals. */
  presenceTtlMs?: number;
}

/** A Redis pub/sub-backed cluster adapter for multi-instance consistency (Req 13). */
export class RedisAdapter implements ClusterAdapter {
  protected readonly options: RedisAdapterOptions;

  constructor(options: RedisAdapterOptions) {
    this.options = options;
  }

  async init(_sink: ClusterSink): Promise<void> {
    throw new Error('RedisAdapter is not implemented yet (see task 10.1)');
  }

  async publish(
    _channel: string,
    _message: RealtimeMessage,
    _options: BroadcastOptions,
  ): Promise<void> {
    throw new Error('RedisAdapter is not implemented yet (see task 10.1)');
  }

  async publishPresence(
    _channel: string,
    _memberId: string,
    _state: 'join' | 'leave',
  ): Promise<void> {
    throw new Error('RedisAdapter is not implemented yet (see task 10.1)');
  }

  async remotePresence(_channel: string): Promise<string[]> {
    throw new Error('RedisAdapter is not implemented yet (see task 10.1)');
  }

  health(): { status: 'up' | 'down'; details?: Record<string, unknown> } {
    throw new Error('RedisAdapter is not implemented yet (see task 10.1)');
  }

  async close(): Promise<void> {
    throw new Error('RedisAdapter is not implemented yet (see task 10.1)');
  }
}

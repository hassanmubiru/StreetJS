// src/cluster/redis.ts
// Opt-in Redis-backed cluster adapter, exported ONLY via the
// `@streetjs/realtime/redis` submodule so Memory_Adapter users pull in no extra
// runtime deps (Req 13.5).
//
// This is the concrete multi-instance cluster adapter (task 10.1). It wraps the
// core `RedisClient`/`RedisLike` pub/sub surface to fan broadcasts and presence
// deltas out to peer instances and to compute a distributed presence union:
//
//   - Broadcast + presence deltas are JSON-encoded as a {@link ClusterEnvelope}
//     stamped with this instance's `instanceId` and PUBLISHed onto a single
//     pub/sub topic (`{keyPrefix}events`). Every instance — including the
//     publisher — receives the envelope on its subscription; the publisher
//     discards its own echoed envelope (`origin === instanceId`) because it
//     already delivered locally, and each peer re-injects a *foreign* broadcast
//     into its local hub exactly once via `sink.deliverLocal` (Req 7.6, 13.1).
//   - Presence membership is mirrored into a per-channel-per-instance Redis set
//     (`{keyPrefix}presence:{channel}:{instanceId}`) via `SADD`/`SREM` with an
//     optional `PEXPIRE presenceTtlMs` so a crashed instance's presence
//     self-heals; `remotePresence` reads every peer's set and returns their
//     union (Req 5.4, 5.6, 13.2).
//   - A `connected` flag tracks transport health: on connection loss `health()`
//     flips to `down` (surfaced through the realtime health check, Req 13.3,
//     17.4) and `publish`/`publishPresence` degrade to best-effort no-ops while
//     local single-instance broadcasts keep working; on the next successful
//     operation the subscription is re-established and cross-instance
//     propagation resumes (Req 13.4). The adapter NEVER throws into the facade's
//     hot path.

import { randomUUID } from 'node:crypto';
import type { RedisLike } from 'streetjs';
import type { ClusterAdapter, ClusterSink } from './adapter.js';
import type { RealtimeMessage, BroadcastOptions } from '../facade.js';

/** A RedisLike client that additionally supports pub/sub. */
export type RedisPubSubClient = RedisLike & {
  /** PUBLISH `message` onto `channel`. */
  publish(channel: string, message: string): Promise<void>;
  /** SUBSCRIBE to `channel`, invoking `handler` per message; resolves to an unsubscribe fn. */
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

/**
 * The cross-instance propagation envelope carried over the Redis pub/sub topic.
 * A `broadcast` envelope carries the message + delivery-scope `options`; a
 * `presence` envelope carries the `memberId` + `state` delta. `origin` is the
 * publisher's `instanceId`, used by every receiver to discard its own echo.
 */
interface ClusterEnvelope {
  /** Discriminates a broadcast fan-out from a presence delta. */
  kind: 'broadcast' | 'presence';
  /** `instanceId` of the publisher (receivers discard their own echo). */
  origin: string;
  /** The channel the envelope pertains to. */
  channel: string;
  /** broadcast: the typed message to re-inject locally. */
  message?: RealtimeMessage;
  /** broadcast: the delivery-scope exclusions to honor identically on peers. */
  options?: BroadcastOptions;
  /** presence: the member whose presence changed. */
  memberId?: string;
  /** presence: whether the member became present or absent. */
  state?: 'join' | 'leave';
}

/** Default key/topic prefix applied to every Redis key and the pub/sub topic. */
const DEFAULT_KEY_PREFIX = 'streetjs:rt:';

/**
 * A Redis pub/sub-backed {@link ClusterAdapter} for multi-instance consistency
 * (Req 13). Conforms to the `ClusterAdapter` contract so the facade can use it
 * interchangeably with the default `MemoryAdapter`.
 */
export class RedisAdapter implements ClusterAdapter {
  private readonly client: RedisPubSubClient;
  /** Key/topic prefix (defaults to {@link DEFAULT_KEY_PREFIX}). */
  private readonly keyPrefix: string;
  /** This instance's unique id, used to discard our own echoed envelopes. */
  private readonly instanceId: string;
  /** Optional presence-set TTL in ms so a dead instance's presence expires. */
  private readonly presenceTtlMs: number | undefined;
  /** The single pub/sub topic all envelopes flow over. */
  private readonly topic: string;

  /** The facade sink used to re-inject foreign envelopes into the local hub. */
  private sink: ClusterSink | null = null;
  /** Handle to tear down the active subscription. */
  private unsubscribe: (() => void) | null = null;
  /** Whether a live subscription is currently established. */
  private subscribed = false;
  /** Transport connectivity: drives `health()` and best-effort degradation. */
  private connected = false;
  /** The most recent transport error, surfaced in the health details. */
  private lastError: unknown = null;

  constructor(options: RedisAdapterOptions) {
    this.client = options.client;
    this.keyPrefix = options.keyPrefix ?? DEFAULT_KEY_PREFIX;
    this.instanceId = options.instanceId ?? randomUUID();
    this.presenceTtlMs =
      options.presenceTtlMs !== undefined && options.presenceTtlMs > 0
        ? options.presenceTtlMs
        : undefined;
    this.topic = `${this.keyPrefix}events`;
  }

  /**
   * Establish the pub/sub subscription and mark the adapter connected. Per the
   * `ClusterAdapter` contract, an explicitly configured adapter whose `init`
   * fails rejects so `createRealtime` surfaces a descriptive error without
   * falling back to the `MemoryAdapter` (Req 12.5). Runtime connection losses
   * *after* init degrade gracefully instead (Req 13.3).
   */
  async init(sink: ClusterSink): Promise<void> {
    this.sink = sink;
    await this.subscribeEvents();
    this.connected = true;
  }

  /**
   * Fan a broadcast out to peer instances (Req 7.6, 13.1). Serializes a
   * `broadcast` envelope stamped with this `instanceId` and PUBLISHes it; every
   * peer re-injects it locally exactly once while the publisher discards its own
   * echo. Best-effort: a transport error is swallowed (degrades to
   * single-instance) and never thrown into the facade's hot path.
   */
  async publish(
    channel: string,
    message: RealtimeMessage,
    options: BroadcastOptions,
  ): Promise<void> {
    await this.safePublishEnvelope({
      kind: 'broadcast',
      origin: this.instanceId,
      channel,
      message,
      options,
    });
  }

  /**
   * Propagate a local presence delta to peers (Req 5.4, 13.2). Updates this
   * instance's per-channel presence set (`SADD`/`SREM`, refreshing
   * `PEXPIRE presenceTtlMs`) and PUBLISHes a `presence` envelope so peers can
   * mirror the change. Best-effort: transport errors are swallowed and never
   * thrown into the facade's hot path.
   */
  async publishPresence(
    channel: string,
    memberId: string,
    state: 'join' | 'leave',
  ): Promise<void> {
    try {
      await this.ensureSubscribed();
      const key = this.presenceKey(channel, this.instanceId);
      if (state === 'join') {
        await this.client.command(['SADD', key, memberId]);
      } else {
        await this.client.command(['SREM', key, memberId]);
      }
      if (this.presenceTtlMs !== undefined) {
        await this.client.command(['PEXPIRE', key, Math.floor(this.presenceTtlMs)]);
      }
      await this.client.publish(
        this.topic,
        JSON.stringify({
          kind: 'presence',
          origin: this.instanceId,
          channel,
          memberId,
          state,
        } satisfies ClusterEnvelope),
      );
      this.markUp();
    } catch (err) {
      this.markDown(err);
    }
  }

  /**
   * Members present on OTHER instances for `channel` (this instance's own set is
   * excluded, since the facade unions this with local hub presence) (Req 5.4,
   * 5.6). Discovers every peer's presence set via `KEYS` and unions their
   * `SMEMBERS`. Best-effort: on transport failure returns `[]` so the union
   * degrades to local presence rather than throwing.
   */
  async remotePresence(channel: string): Promise<string[]> {
    try {
      await this.ensureSubscribed();
      const pattern = `${this.keyPrefix}presence:${channel}:*`;
      const keysReply = await this.client.command(['KEYS', pattern]);
      const keys = this.asStringArray(keysReply);
      const ownKey = this.presenceKey(channel, this.instanceId);
      const members = new Set<string>();
      for (const key of keys) {
        if (key === ownKey) continue;
        const membersReply = await this.client.command(['SMEMBERS', key]);
        for (const member of this.asStringArray(membersReply)) {
          members.add(member);
        }
      }
      this.markUp();
      return [...members];
    } catch (err) {
      this.markDown(err);
      return [];
    }
  }

  /**
   * Adapter connectivity for the realtime health check (Req 13.3, 17.4).
   * Reports `up` while the transport is healthy and `down` after a connection
   * loss, with diagnostic details.
   */
  health(): { status: 'up' | 'down'; details?: Record<string, unknown> } {
    const details: Record<string, unknown> = {
      instanceId: this.instanceId,
      keyPrefix: this.keyPrefix,
      subscribed: this.subscribed,
    };
    if (!this.connected && this.lastError !== null) {
      details['lastError'] = describeError(this.lastError);
    }
    return { status: this.connected ? 'up' : 'down', details };
  }

  /** Release the subscription and reset transport state. */
  async close(): Promise<void> {
    this.teardownSubscription();
    this.connected = false;
    this.sink = null;
  }

  // ── internals ───────────────────────────────────────────────────────────

  /**
   * PUBLISH an envelope best-effort, ensuring a live subscription first so a
   * reconnect resumes fan-out (Req 13.4). A transport error degrades to a no-op
   * and flips health to `down` (Req 13.3) — it is never thrown into the facade.
   */
  private async safePublishEnvelope(envelope: ClusterEnvelope): Promise<void> {
    try {
      await this.ensureSubscribed();
      await this.client.publish(this.topic, JSON.stringify(envelope));
      this.markUp();
    } catch (err) {
      this.markDown(err);
    }
  }

  /**
   * Establish the pub/sub subscription if one is not already live. Throws on
   * failure so `init` can reject (Req 12.5); callers on the hot path wrap this
   * in a try/catch to degrade gracefully instead.
   */
  private async ensureSubscribed(): Promise<void> {
    if (this.subscribed) return;
    await this.subscribeEvents();
  }

  /** Open the single events subscription and record its teardown handle. */
  private async subscribeEvents(): Promise<void> {
    const unsubscribe = await this.client.subscribe(this.topic, (raw) => this.onMessage(raw));
    this.unsubscribe = unsubscribe;
    this.subscribed = true;
  }

  /**
   * Handle an inbound envelope. Discards our own echo (`origin === instanceId`)
   * and re-injects foreign broadcasts (`sink.deliverLocal`, exactly once per
   * connection) / presence deltas (`sink.applyRemotePresence`) into the facade.
   * Never throws — a malformed payload or a sink error is swallowed.
   */
  private onMessage(raw: string): void {
    let envelope: ClusterEnvelope;
    try {
      envelope = JSON.parse(raw) as ClusterEnvelope;
    } catch {
      return;
    }
    if (!envelope || typeof envelope !== 'object') return;
    // Discard our own echoed envelope: the publisher already delivered locally.
    if (envelope.origin === this.instanceId) return;
    const sink = this.sink;
    if (!sink) return;
    try {
      if (envelope.kind === 'broadcast' && envelope.message) {
        sink.deliverLocal(envelope.channel, envelope.message, envelope.options ?? {});
      } else if (
        envelope.kind === 'presence' &&
        typeof envelope.memberId === 'string' &&
        (envelope.state === 'join' || envelope.state === 'leave')
      ) {
        sink.applyRemotePresence(envelope.channel, envelope.memberId, envelope.state);
      }
    } catch {
      // Never propagate a sink error back onto the subscription callback.
    }
  }

  /** Mark the transport healthy after a successful operation. */
  private markUp(): void {
    this.connected = true;
    this.lastError = null;
  }

  /**
   * Mark the transport unhealthy after a failed operation (Req 13.3). Tears down
   * the (likely dead) subscription so the next operation re-subscribes and
   * resumes fan-out on reconnect (Req 13.4).
   */
  private markDown(err: unknown): void {
    this.connected = false;
    this.lastError = err;
    this.teardownSubscription();
  }

  /** Best-effort teardown of the active subscription. */
  private teardownSubscription(): void {
    if (this.unsubscribe) {
      try {
        this.unsubscribe();
      } catch {
        // ignore — the connection is already gone.
      }
    }
    this.unsubscribe = null;
    this.subscribed = false;
  }

  /** The per-channel-per-instance presence set key. */
  private presenceKey(channel: string, instanceId: string): string {
    return `${this.keyPrefix}presence:${channel}:${instanceId}`;
  }

  /** Coerce a RESP reply into a string array, dropping non-string elements. */
  private asStringArray(reply: unknown): string[] {
    if (!Array.isArray(reply)) return [];
    return reply.filter((el): el is string => typeof el === 'string');
  }
}

/** Human-readable description of a caught transport error for health details. */
function describeError(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  return String(cause);
}

// src/facade.ts
// Public typed surface for the Realtime_Facade and Room handles.
//
// This module declares the developer-facing types (`Member`,
// `RealtimeMessage`, `RealtimeOptions`, `Realtime`, `Room`, `BroadcastOptions`)
// and the `createRealtime` factory. The concrete facade/room behavior is
// implemented in later tasks (3.1, 3.2); this scaffold establishes the
// strongly-typed surface required by Requirements 1.2 and 1.5.

import type { IncomingMessage } from 'node:http';
import { ChannelHub } from 'streetjs';
import type {
  RealtimeConnection,
  StreetWebSocketServer,
  HealthCheckRegistry,
  MetricsRegistry,
  PublishOptions,
} from 'streetjs';
import type { ClusterAdapter, ClusterSink } from './cluster/adapter.js';
import { MemoryAdapter } from './cluster/memory.js';
import { createRealtimeUpgradeAuth } from './auth.js';
import type { ChannelAuthorizer, RealtimeUpgradeAuth } from './auth.js';
import { RateLimiter } from './ratelimit.js';
import type { RateLimitConfig } from './ratelimit.js';

/**
 * A logical authenticated user. Presence is reference-counted by connection,
 * so a Member may hold several concurrent Connections (multi-device / reconnect).
 */
export interface Member {
  /** Stable, unique identifier for the member. */
  readonly id: string;
  /** Optional roles carried alongside the member identity. */
  readonly roles?: readonly string[];
  /** Additional arbitrary member attributes. */
  readonly [key: string]: unknown;
}

/** A typed broadcast envelope delivered to the connections in a Room. */
export interface RealtimeMessage<T = unknown> {
  /** The event type identifier delivered over the wire. */
  readonly type: string;
  /** The typed payload carried by the event. */
  readonly payload: T;
}

/** Delivery-scope options for {@link Room.broadcast}. Maps onto the hub's `PublishOptions`. */
export interface BroadcastOptions {
  /** Exclude a single connection id, e.g. the sender (Req 7.2). */
  exceptConnId?: string;
  /** Exclude every connection of a member id (Req 7.3). */
  exceptMemberId?: string;
}

/** Options accepted by {@link createRealtime}. */
export interface RealtimeOptions {
  /** Existing WebSocket server the facade attaches over (Req 3.1). */
  server: StreetWebSocketServer;
  /** Cross-instance backend. Defaults to a `MemoryAdapter` (Req 12.2). */
  adapter?: ClusterAdapter;
  /** Typing indicator TTL forwarded to `ChannelHub` (Req 6.3). 0 disables. */
  typingTtlMs?: number;
  /** Rate-limit configuration; enabled by default (Req 11.5). */
  rateLimit?: RateLimitConfig;
  /** Resolves a Member from an authenticated upgrade request (Req 9). */
  authenticate?: (req: IncomingMessage) => Promise<Member | null>;
  /** Health registry for the realtime health check (Req 17.1). */
  health?: HealthCheckRegistry;
  /** Metrics registry for connection/member-count metrics (Req 17.2). */
  metrics?: MetricsRegistry;
}

/** A named channel handle over the underlying `ChannelHub` channel. */
export interface Room {
  /** The channel name this handle is bound to. */
  readonly name: string;

  /** Add the member's connection; resolves after membership is recorded (Req 2.3, 4.1). */
  join(member: Member, conn: RealtimeConnection): Promise<void>;
  /** Remove the member's connection (Req 2.6, 4.2, 4.3). */
  leave(member: Member, conn: RealtimeConnection): Promise<void>;

  /** Deliver a typed message to eligible connections room-wide (Req 2.4, 7). */
  broadcast<T>(message: RealtimeMessage<T>, options?: BroadcastOptions): Promise<void>;

  /** Ids present in this room; distributed union under Redis (Req 5.3-5.6). */
  presence(): Promise<string[]>;
  /** Count of present members (Req 4.4). */
  memberCount(): Promise<number>;

  /** Set typing state for a member (Req 6). */
  setTyping(member: Member, typing: boolean, conn?: RealtimeConnection): void;
}

/** The public entry object exposing room factory methods and the active adapter. */
export interface Realtime {
  /**
   * Return a Room handle bound to `name` (Req 2.1, 2.2). Rejects an empty or
   * non-string name (Req 2.5).
   */
  room(name: string): Room;
  /** Mark a channel as secured with a join/broadcast authorization rule (Req 10). */
  secure(name: string, rule: ChannelAuthorizer): Room;
  /** The active cluster adapter (`MemoryAdapter` by default). */
  readonly adapter: ClusterAdapter;
  /** Associate a resolved Member with an established connection (Req 9.3). */
  bind(conn: RealtimeConnection, member: Member | null): void;
  /** Graceful teardown: closes the adapter and clears state. */
  close(): Promise<void>;
}

/**
 * Shared facade context handed to every {@link Room} handle so the handles stay
 * stateless — they carry only their channel `name` and delegate all behavior to
 * the single owned `ChannelHub` and `ClusterAdapter`.
 */
interface FacadeContext {
  /** The single `ChannelHub` owned by the facade (Req 2.2 — same name → same channel). */
  readonly hub: ChannelHub;
  /** The single active cluster adapter (`MemoryAdapter` by default, Req 12.2). */
  readonly adapter: ClusterAdapter;
  /**
   * Resolves once the adapter has initialized. Rejects with a descriptive error
   * if an explicitly configured adapter fails to initialize, so facade
   * operations surface the failure and never silently fall back (Req 12.5).
   */
  readonly ready: Promise<void>;
  /**
   * Registered per-channel authorization rules. A channel present in this map is
   * a Secured_Channel: {@link RoomHandle.join} and {@link RoomHandle.broadcast}
   * evaluate its {@link ChannelAuthorizer} before admitting the action (Req 10).
   */
  readonly authorizers: Map<string, ChannelAuthorizer>;
  /**
   * Internal, non-public member resolution by connection id. Used to identify
   * the sender of a secured-channel broadcast (which carries no explicit sender
   * argument) from `BroadcastOptions.exceptConnId`. Returns the {@link Member}
   * bound to that connection via {@link Realtime.bind}, or `null` when the
   * connection is unbound/unauthenticated. NOT part of the public surface.
   */
  readonly memberByConnId: (connId: string) => Member | null;
  /**
   * Internal, non-public connection resolution by connection id. Used to
   * resolve the offending connection object so a rate-limit error event can be
   * emitted to it (Req 11.4). Returns the connection registered when it joined
   * a room (or was bound via {@link Realtime.bind}), or `null` when unknown.
   * NOT part of the public surface.
   */
  readonly connById: (connId: string) => RealtimeConnection | null;
  /**
   * Record a connection against its id so it can later be resolved by
   * {@link FacadeContext.connById}. Called by {@link RoomHandle.join} (the
   * broadcaster is always a room member) and by {@link Realtime.bind}. NOT part
   * of the public surface.
   */
  readonly registerConn: (conn: RealtimeConnection) => void;
  /**
   * The per-connection / per-channel rate limiter applied to every broadcast
   * (Req 11). Enabled by default with documented defaults; shared across all
   * {@link RoomHandle}s so quotas are enforced consistently per connection and
   * per channel.
   */
  readonly rateLimiter: RateLimiter;
  /**
   * Records a single rate-limit rejection on the observability
   * {@link MetricsRegistry} (Req 17.3). Called by {@link RoomHandle.broadcast}
   * each time the rate limiter rejects a broadcast, alongside the rate-limit
   * error event emitted to the offending connection (Req 11.4). A no-op when no
   * `metrics` registry was configured on the facade, so metrics stay entirely
   * opt-in. NOT part of the public surface.
   */
  readonly onRateLimitRejected: () => void;
}

/** Map the facade's {@link BroadcastOptions} onto the hub's `PublishOptions`. */
function toPublishOptions(options: BroadcastOptions | undefined): PublishOptions {
  if (!options) return {};
  const out: PublishOptions = {};
  if (options.exceptConnId !== undefined) out.exceptConnId = options.exceptConnId;
  if (options.exceptMemberId !== undefined) out.exceptMemberId = options.exceptMemberId;
  return out;
}

/** Union `a` and `b` preserving first-seen order and removing duplicates. */
function union(a: readonly string[], b: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of a) if (!seen.has(id)) { seen.add(id); out.push(id); }
  for (const id of b) if (!seen.has(id)) { seen.add(id); out.push(id); }
  return out;
}

/**
 * A stateless {@link Room} handle bound to a channel `name`. All membership,
 * presence, typing, and broadcast behavior delegates to the shared
 * `ChannelHub`; cross-instance fan-out flows through the `ClusterAdapter`. Two
 * handles created for the same `name` operate over the *same* underlying hub
 * channel (Req 2.2), because the handle carries only its `name` plus the shared
 * facade context.
 *
 * Membership (`join`/`leave`), broadcast delivery scope (`broadcast`), presence
 * queries (`presence`/`memberCount`), and typing (`setTyping`) are finalized
 * here (task 3.2), and presence deltas are propagated to the cluster adapter
 * (task 4.1): `join`/`leave` observe the hub's `newlyPresent`/`nowAbsent`
 * results and call `adapter.publishPresence` accordingly (inert for the default
 * `MemoryAdapter`). Secured-channel authorization is now enforced (task 7.1,
 * Req 10): when this channel was registered via `Realtime.secure`, `join`
 * evaluates the `ChannelAuthorizer` for `action: 'join'` before admitting the
 * member (Req 10.1, 10.2) and `broadcast` evaluates it for `action: 'broadcast'`,
 * denying delivery to every connection when the sender is unauthenticated or
 * unauthorized (Req 10.3). One behavior remains intentionally deferred so as to
 * keep this handle's hooks coherent without pre-empting its spec:
 *   - Consumption of remote presence into a distributed mirror
 *     (`applyRemotePresence` + `remotePresence` union recording, task 10.2,
 *     Req 5.4/5.6). Today `presence()` already unions in `adapter.remotePresence`,
 *     which is `[]` for the default `MemoryAdapter`, so single-instance results
 *     are correct.
 */
class RoomHandle implements Room {
  constructor(
    readonly name: string,
    private readonly ctx: FacadeContext,
  ) {}

  /**
   * Add `member`'s `conn` to this channel and resolve strictly *after*
   * membership has been recorded (Req 2.3, 4.1). Delegation to `ChannelHub.join`
   * is synchronous — it records the connection, ref-counts the member, and
   * fires `presence:join` to the other connections when the member becomes newly
   * present — so awaiting this promise guarantees the membership is durable
   * before the caller proceeds. Joins are idempotent per connection (Req 4.6).
   */
  async join(member: Member, conn: RealtimeConnection): Promise<void> {
    await this.ctx.ready;
    // Register the connection so it can be resolved by id later (e.g. to emit a
    // rate-limit error event to it, Req 11.4). A broadcaster is always a room member.
    this.ctx.registerConn(conn);
    // Secured-channel gate (Req 10.1): if this channel is a Secured_Channel,
    // evaluate its authorizer for `action: 'join'` *before* touching the hub.
    // On denial do not add the member, return an authorization error to the
    // requesting connection, and reject the promise (Req 10.2). A non-secured
    // channel skips this check entirely (Req 10.4).
    const authorizer = this.ctx.authorizers.get(this.name);
    if (authorizer) {
      const allowed = await authorizer({ channel: this.name, member, action: 'join' });
      if (!allowed) {
        conn.emit('error', { channel: this.name, reason: 'unauthorized', action: 'join' });
        throw new Error(
          `Authorization denied: member ${describeMemberId(member)} may not join secured channel "${this.name}"`,
        );
      }
    }
    const { newlyPresent } = this.ctx.hub.join(this.name, member.id, conn);
    // Observe the hub's presence delta: when this connection makes the member
    // newly present, propagate a `join` to peer instances (Req 5.4). The hub
    // has already emitted `presence:join` to the other local connections
    // unchanged (Req 5.1). For the default `MemoryAdapter` this is inert.
    if (newlyPresent) {
      await this.ctx.adapter.publishPresence(this.name, member.id, 'join');
    }
  }

  /**
   * Remove `member`'s `conn` from this channel (Req 2.6, 4.2, 4.3). The member
   * stays present while any other connection remains and becomes absent only
   * when the last one leaves, at which point the hub fires `presence:leave`.
   * Resolves after the removal has been recorded.
   */
  async leave(member: Member, conn: RealtimeConnection): Promise<void> {
    await this.ctx.ready;
    const { nowAbsent } = this.ctx.hub.leave(this.name, member.id, conn);
    // Observe the hub's presence delta: when this was the member's last
    // connection they become absent, the hub fires `presence:leave` to the
    // remaining local connections (Req 5.2) and clears any typing state
    // (Req 6.4); propagate the `leave` to peer instances (Req 5.4). Inert for
    // the default `MemoryAdapter`.
    if (nowAbsent) {
      await this.ctx.adapter.publishPresence(this.name, member.id, 'leave');
    }
  }

  /**
   * Deliver a typed `message` to the eligible connections of this room (Req 2.4,
   * 7.1). Local delivery always flows through `ChannelHub.publish`, then the
   * cross-instance fan-out flows through the adapter (inert for the default
   * `MemoryAdapter`). {@link BroadcastOptions} map directly onto the hub's
   * `PublishOptions`, and the *same* options are handed to `adapter.publish`, so
   * `exceptConnId` (Req 7.2) and `exceptMemberId` (Req 7.3) are honored
   * identically on the local and remote paths. Publishing to a room with no
   * connections completes without delivering anything and without raising
   * (Req 7.5): the hub short-circuits an unknown channel and the default adapter
   * is a no-op.
   */
  async broadcast<T>(message: RealtimeMessage<T>, options?: BroadcastOptions): Promise<void> {
    await this.ctx.ready;
    // Secured-channel gate (Req 10.3): if this channel is a Secured_Channel, the
    // broadcast must originate from an authenticated, authorized member.
    //
    // Broadcast-sender resolution rule: `Room.broadcast` carries no explicit
    // sender argument, so the sender is identified by `BroadcastOptions.exceptConnId`
    // — by convention a sender excludes its own connection from delivery. The
    // facade resolves that connId to a `Member` via `ctx.memberByConnId`. If no
    // `exceptConnId` is supplied, or it does not resolve to an authenticated
    // Member, the broadcast is treated as unauthenticated and denied. On denial
    // (unauthenticated or unauthorized) NOTHING is delivered: neither the local
    // hub publish nor the cross-instance adapter publish runs (Req 10.3). A
    // non-secured channel skips this check entirely (Req 10.4).
    const authorizer = this.ctx.authorizers.get(this.name);
    if (authorizer) {
      const senderConnId = options?.exceptConnId;
      const sender = senderConnId ? this.ctx.memberByConnId(senderConnId) : null;
      // No resolvable authenticated member ⇒ deny without evaluating the rule.
      const allowed = sender
        ? await authorizer({ channel: this.name, member: sender, action: 'broadcast' })
        : false;
      if (!allowed) {
        // Deliver nothing: skip both hub.publish and adapter.publish (Req 10.3).
        return;
      }
    }
    // Rate limiting (Req 11.1–11.4). The sending connection is identified by
    // `BroadcastOptions.exceptConnId` (a sender excludes its own connection from
    // delivery) — the same convention used for secured-channel sender
    // resolution above. Apply the per-connection quota keyed by that connId when
    // present, and the per-channel quota keyed by this channel name. If either
    // quota is exceeded, deliver NOTHING (skip both hub.publish and
    // adapter.publish) and emit a rate-limit error event naming the exceeded
    // quota to the offending connection (Req 11.2, 11.3, 11.4). At/below quota
    // the message is delivered normally (Req 11.1).
    const senderConnId = options?.exceptConnId;
    const decision = await this.ctx.rateLimiter.consume(senderConnId, this.name);
    if (!decision.allowed) {
      if (senderConnId !== undefined) {
        const offender = this.ctx.connById(senderConnId);
        offender?.emit('error', {
          channel: this.name,
          reason: 'rate_limited',
          quota: decision.exceeded,
        });
      }
      return;
    }
    const publishOptions = toPublishOptions(options);
    // Local delivery always flows through the hub (a no-op for an empty room).
    this.ctx.hub.publish(this.name, message.type, message.payload, publishOptions);
    // Cross-instance fan-out honoring the same exclusions (inert for MemoryAdapter).
    await this.ctx.adapter.publish(this.name, message, publishOptions);
  }

  /**
   * Ids of the members currently present in this room (Req 5.3), as the union
   * of local hub presence and the members present on peer instances
   * (`adapter.remotePresence`, Req 5.4). For an empty room the union is empty
   * (Req 5.5). Under the default `MemoryAdapter`, `remotePresence` is `[]`, so
   * the result is exactly local hub presence.
   */
  async presence(): Promise<string[]> {
    await this.ctx.ready;
    const local = this.ctx.hub.presence(this.name);
    const remote = await this.ctx.adapter.remotePresence(this.name);
    return union(local, remote);
  }

  /**
   * Count of distinct members present in this room (Req 4.4) — the size of the
   * distributed presence union, so a member present both locally and on a peer
   * is counted once.
   */
  async memberCount(): Promise<number> {
    return (await this.presence()).length;
  }

  /**
   * Set `member`'s typing state in this room (Req 6.1, 6.2), delegating to
   * `ChannelHub.setTyping`. Typing is purely local hub state — it needs no
   * adapter round-trip — so this stays synchronous. When a positive typing TTL
   * was configured on the facade it is applied by the hub and auto-clears the
   * indicator (Req 6.3); `conn` excludes the setter's own connection from the
   * emitted `typing` event.
   */
  setTyping(member: Member, typing: boolean, conn?: RealtimeConnection): void {
    this.ctx.hub.setTyping(this.name, member.id, typing, conn);
  }
}

/**
 * Concrete {@link Realtime} facade. Owns exactly one `ChannelHub` and one
 * `ClusterAdapter`; every `Room` returned is a lightweight, stateless handle
 * keyed by channel name over the same hub (Req 2.1, 2.2).
 */
class RealtimeFacade implements Realtime {
  readonly adapter: ClusterAdapter;

  private readonly ctx: FacadeContext;
  /** Member identity associated with each bound connection (Req 9.3). */
  private readonly members = new WeakMap<RealtimeConnection, Member>();
  /**
   * Member identity keyed by connection id. Mirrors {@link members} but is
   * keyed by the string `connId` (not the connection object), so a
   * secured-channel broadcast can resolve its sender's {@link Member} from
   * `BroadcastOptions.exceptConnId` (Req 10.3). Maintained alongside `members`
   * in {@link bind} and torn down in {@link handleClose}.
   */
  private readonly membersByConnId = new Map<string, Member>();
  /**
   * Live connection objects keyed by connection id, so a broadcast can resolve
   * the offending connection to emit a rate-limit error event to it (Req 11.4).
   * Populated when a connection joins a room (or is bound via {@link bind}) and
   * torn down in {@link handleClose}.
   */
  private readonly connById = new Map<string, RealtimeConnection>();
  /** Connection ids already bound to the hub lifecycle, to avoid double-binding. */
  private readonly bound = new Set<string>();

  constructor(hub: ChannelHub, adapter: ClusterAdapter, rateLimiter: RateLimiter) {
    this.adapter = adapter;
    const authorizers = new Map<string, ChannelAuthorizer>();

    // Sink the adapter uses to re-inject remote events into the local hub. The
    // full presence-mirror wiring lands in task 10.2; for a single instance the
    // MemoryAdapter never invokes these callbacks.
    const sink: ClusterSink = {
      deliverLocal: (channel, message, options) => {
        hub.publish(channel, message.type, message.payload, toPublishOptions(options));
      },
      applyRemotePresence: () => {
        // Remote presence mirror is wired in task 10.2.
      },
    };

    // Initialize the adapter exactly once. An explicitly configured adapter that
    // fails to initialize surfaces a descriptive error through `ready` and is
    // never replaced by a MemoryAdapter fallback (Req 12.5).
    const ready = Promise.resolve()
      .then(() => adapter.init(sink))
      .catch((cause: unknown) => {
        throw new Error(
          `Realtime cluster adapter failed to initialize: ${describeError(cause)}`,
          { cause },
        );
      });
    // Keep a handled branch so a rejection never becomes an unhandled rejection;
    // awaiters of `ready` still observe the original rejection.
    ready.catch(() => {});

    this.ctx = {
      hub,
      adapter,
      ready,
      authorizers,
      // Resolve the Member bound to a connection id (Req 10.3). Reads the
      // `connId → Member` mirror maintained by `bind`/`handleClose`; returns
      // `null` for an unbound/unauthenticated connection. Not public surface.
      memberByConnId: (connId: string) => this.membersByConnId.get(connId) ?? null,
      // Resolve the live connection object by id so a rate-limit rejection can
      // emit an error event to the offending connection (Req 11.4). Not public.
      connById: (connId: string) => this.connById.get(connId) ?? null,
      // Register a connection so it can later be resolved by id. Not public.
      registerConn: (conn: RealtimeConnection) => {
        this.connById.set(conn.id, conn);
      },
      // Shared per-connection / per-channel rate limiter for every broadcast (Req 11).
      rateLimiter,
    };
  }

  room(name: string): Room {
    if (typeof name !== 'string' || name.length === 0) {
      // Reject before constructing a handle, so no channel is ever created (Req 2.5).
      throw new TypeError(
        `realtime.room(name): name must be a non-empty string (received ${describeValue(name)})`,
      );
    }
    return new RoomHandle(name, this.ctx);
  }

  secure(name: string, rule: ChannelAuthorizer): Room {
    const room = this.room(name);
    // Register the rule as a Secured_Channel. From now on RoomHandle.join and
    // RoomHandle.broadcast evaluate this authorizer before admitting the action
    // (Req 10.1-10.3, 10.5).
    this.ctx.authorizers.set(name, rule);
    return room;
  }

  bind(conn: RealtimeConnection, member: Member | null): void {
    // Register the connection so a rate-limit rejection can resolve it by id
    // to emit an error event to it (Req 11.4).
    this.connById.set(conn.id, conn);
    if (member) {
      this.members.set(conn, member);
      // Maintain the connId → Member mirror so a secured-channel broadcast can
      // resolve its sender from `BroadcastOptions.exceptConnId` (Req 10.3).
      this.membersByConnId.set(conn.id, member);
    } else {
      this.members.delete(conn);
      this.membersByConnId.delete(conn.id);
    }
    // Bind the connection's lifecycle so a close (including a heartbeat reap)
    // removes it from every room (Req 3.3, 8.3) and propagates the resulting
    // presence-leave deltas to the cluster adapter (Req 8.4). Only connections
    // that expose `onClose` (StreetSocket / FakeConnection) can be bound; do it
    // once per connection.
    if (!this.bound.has(conn.id) && hasOnClose(conn)) {
      this.bound.add(conn.id);
      conn.onClose(() => this.handleClose(conn));
    }
  }

  /**
   * Close-path continuity for a bound connection (Req 8.3, 8.4). Snapshots the
   * channels in which the connection's member is present, removes the
   * connection from every room via `ChannelHub.disconnect` (the same path a
   * live `StreetSocket` close and a heartbeat reap take — the hub fires
   * `presence:leave` to the remaining connections and clears typing when the
   * member's last connection goes, Req 6.4), then propagates a `leave` delta to
   * the cluster adapter for every channel the member became absent from. A
   * member still holding another connection stays present, so no spurious leave
   * is propagated (Req 8.2). Inert for the default `MemoryAdapter`.
   */
  private handleClose(conn: RealtimeConnection): void {
    const member = this.members.get(conn);
    const hub = this.ctx.hub;
    // Snapshot the channels where the member is present before disconnecting.
    const presentBefore = member
      ? hub.channelNames().filter((channel) => hub.isPresent(channel, member.id))
      : [];
    // Remove the connection from every room exactly as a live close would.
    hub.disconnect(conn);
    // Propagate a leave delta for each channel the member became absent from.
    if (member) {
      for (const channel of presentBefore) {
        if (!hub.isPresent(channel, member.id)) {
          void this.ctx.adapter.publishPresence(channel, member.id, 'leave');
        }
      }
    }
    this.members.delete(conn);
    this.membersByConnId.delete(conn.id);
    this.connById.delete(conn.id);
    this.bound.delete(conn.id);
  }

  async close(): Promise<void> {
    // Swallow an init failure during teardown; we still release adapter resources.
    try {
      await this.ctx.ready;
    } catch {
      // ignore — teardown proceeds regardless of init outcome.
    }
    await this.adapter.close();
    this.bound.clear();
    this.connById.clear();
  }
}

/** A connection that additionally exposes the `onClose` lifecycle hook. */
type ClosableRealtimeConnection = RealtimeConnection & { onClose(cb: () => void): unknown };

/** Narrow a connection to one that can be bound to the hub lifecycle. */
function hasOnClose(conn: RealtimeConnection): conn is ClosableRealtimeConnection {
  return typeof (conn as { onClose?: unknown }).onClose === 'function';
}

/** Human-readable description of a caught error for a descriptive message. */
function describeError(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  return String(cause);
}

/** Human-readable description of a rejected `room(name)` argument. */
function describeValue(value: unknown): string {
  if (typeof value === 'string') return `empty string`;
  return `${typeof value}`;
}

/** Human-readable member id for an authorization-denial message. */
function describeMemberId(member: Member | null): string {
  return member ? member.id : '<anonymous>';
}

/**
 * Servers for which the production unauthenticated-upgrade security warning has
 * already been emitted, so it fires **exactly once per WebSocket_Server**
 * (Req 9.5 — "THE WebSocket_Server SHALL emit a one-time security warning").
 * A `WeakSet` keyed by the server lets the entry be collected with the server
 * and avoids re-warning when several facades are constructed over the same
 * server, while a fresh server (as each test uses) warns exactly once.
 */
const unauthenticatedUpgradeWarned = new WeakSet<StreetWebSocketServer>();

/** The security-finding message emitted for an unauthenticated production upgrade path. */
const UNAUTHENTICATED_UPGRADE_WARNING =
  '[@streetjs/realtime] SECURITY: unauthenticated-upgrade — NODE_ENV is "production" but no ' +
  'authentication hook (RealtimeOptions.authenticate) is configured, so WebSocket upgrades are ' +
  'accepted without authenticating the connection. Configure `authenticate` to identify realtime ' +
  'connections in production.';

/**
 * Emit the one-time production unauthenticated-upgrade security warning
 * (Req 9.5). Fires only WHILE `NODE_ENV === 'production'` AND no authentication
 * hook is configured, and — guarded by {@link unauthenticatedUpgradeWarned} —
 * at most once per WebSocket_Server. Uses `console.warn` (a clearly spy-able
 * sink) and names the `unauthenticated-upgrade` finding. This is purely a
 * diagnostic: it does not change the server's runtime behavior — upgrades are
 * still accepted exactly as before.
 */
function warnUnauthenticatedUpgradeInProduction(
  server: StreetWebSocketServer,
  authenticateConfigured: boolean,
): void {
  if (authenticateConfigured) return;
  if (process.env.NODE_ENV !== 'production') return;
  if (unauthenticatedUpgradeWarned.has(server)) return;
  unauthenticatedUpgradeWarned.add(server);
  console.warn(UNAUTHENTICATED_UPGRADE_WARNING);
}

/** The subset of the WebSocket server the facade reads/writes to install upgrade auth. */
type UpgradeAuthHost = {
  /** The upgrade auth hook the core server reads before accepting a connection. */
  authFn?: (req: IncomingMessage) => boolean | Promise<boolean>;
};

/**
 * Install realtime upgrade authentication onto an existing
 * {@link StreetWebSocketServer} (Req 3.1, 3.2, 3.3, 9.1–9.4). Two pieces from
 * {@link createRealtimeUpgradeAuth} are wired onto the *same* server instance,
 * both keyed on the upgrade `req` the core server hands to each stage:
 *
 *   1. **The upgrade `authFn`** — the core server evaluates its auth hook at
 *      upgrade time, *after* its own origin gate (`isOriginAllowed`) and
 *      *before* the connection is accepted, rejecting a failed credential with
 *      HTTP 401 and establishing no connection (Req 9.1, 9.2). We rely entirely
 *      on that existing origin gate and add no origin restriction (Req 3.5,
 *      3.6). The core exposes no public setter for the hook, so we assign the
 *      field it reads; when the server already carries a hook we compose them so
 *      both must pass, never weakening pre-existing authentication.
 *   2. **The connection `handler`** — composed onto the server's public
 *      `attach` so that for every accepted connection (which the core has
 *      already wrapped as a `StreetSocket`, Req 3.2) the resolved Member is
 *      associated via `Realtime.bind`, which also binds the hub-cleanup
 *      lifecycle so a close removes the connection from every room (Req 3.3,
 *      9.3). An identity that cannot be associated leaves the connection open
 *      without a Member (Req 9.4). The application's own `attach` handler still
 *      runs, so this is purely additive.
 */
function installUpgradeAuth(server: StreetWebSocketServer, auth: RealtimeUpgradeAuth): void {
  // 1) Install the upgrade auth hook the core server reads (composing with any
  //    hook already configured so both credentials must pass).
  const host = server as unknown as UpgradeAuthHost;
  const existing = host.authFn;
  host.authFn = existing
    ? async (req: IncomingMessage) => (await existing(req)) && (await auth.authFn(req))
    : auth.authFn;

  // 2) Compose the identity-binding handler onto the server's public `attach`.
  const attach = server.attach.bind(server);
  server.attach = (httpServer, handler) => {
    attach(httpServer, (socket, req) => {
      // Associate identity first (Req 9.3), then run the app's handler.
      auth.handler(socket, req);
      handler(socket, req);
    });
  };
}

/**
 * Construct a {@link Realtime} facade over an existing WebSocket server.
 *
 * The facade owns a single `ChannelHub` (constructed with the configured
 * `typingTtlMs`, Req 6.3) and a single `ClusterAdapter` — defaulting to a
 * {@link MemoryAdapter} when none is configured (Req 12.2). Cross-instance
 * operations route through the provided adapter (Req 12.4). An explicitly
 * configured adapter whose initialization fails surfaces a descriptive error
 * without falling back to the MemoryAdapter (Req 12.5).
 */
export function createRealtime(options: RealtimeOptions): Realtime {
  if (options === null || typeof options !== 'object') {
    throw new TypeError('createRealtime: options are required');
  }
  const hub = new ChannelHub({ typingTtlMs: options.typingTtlMs ?? 0 });
  const adapter = options.adapter ?? new MemoryAdapter();
  // Build the rate limiter from `options.rateLimit` (or defaults). Enabled by
  // default with documented defaults (per-connection 20/1s, per-channel 200/1s,
  // Req 11.5); it reuses the core RateLimitStore sliding-window semantics.
  const rateLimiter = new RateLimiter(options.rateLimit ?? {});
  const facade = new RealtimeFacade(hub, adapter, rateLimiter);

  // When an authentication hook is configured, wire connection authentication
  // onto the existing server: verify the credential at upgrade (Req 9.1, 9.2)
  // and associate the resolved Member with the established connection (Req 3.2,
  // 3.3, 9.3, 9.4). Relies entirely on the server's existing origin gate
  // (Req 3.5, 3.6). Without an `authenticate` hook the facade adds no auth and
  // the server keeps its current upgrade behavior.
  if (options.authenticate) {
    const auth = createRealtimeUpgradeAuth(
      options.authenticate,
      (conn: RealtimeConnection, member: Member | null) => facade.bind(conn, member),
    );
    installUpgradeAuth(options.server, auth);
  } else {
    // No authentication hook configured: in production this is a security
    // finding (unauthenticated upgrades). Emit a one-time warning naming the
    // finding WITHOUT changing runtime behavior — the server still accepts
    // connections exactly as before (Req 9.5).
    warnUnauthenticatedUpgradeInProduction(options.server, false);
  }

  return facade;
}

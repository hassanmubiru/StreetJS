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
import type { ChannelAuthorizer } from './auth.js';
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
  /** Registered per-channel authorization rules (enforcement wired in task 7.1). */
  readonly authorizers: Map<string, ChannelAuthorizer>;
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
 * `ChannelHub`; cross-instance fan-out flows through the `ClusterAdapter`.
 *
 * The detailed broadcast/presence-union and secured-channel semantics are
 * finalized in tasks 3.2, 7.1, and 10.2; this handle provides coherent wiring
 * over the hub + adapter so the facade builds and behaves correctly on a single
 * instance today.
 */
class RoomHandle implements Room {
  constructor(
    readonly name: string,
    private readonly ctx: FacadeContext,
  ) {}

  async join(member: Member, conn: RealtimeConnection): Promise<void> {
    await this.ctx.ready;
    this.ctx.hub.join(this.name, member.id, conn);
  }

  async leave(member: Member, conn: RealtimeConnection): Promise<void> {
    await this.ctx.ready;
    this.ctx.hub.leave(this.name, member.id, conn);
  }

  async broadcast<T>(message: RealtimeMessage<T>, options?: BroadcastOptions): Promise<void> {
    await this.ctx.ready;
    const publishOptions = toPublishOptions(options);
    // Local delivery always flows through the hub (a no-op for an empty room).
    this.ctx.hub.publish(this.name, message.type, message.payload, publishOptions);
    // Cross-instance fan-out (inert for the MemoryAdapter default).
    await this.ctx.adapter.publish(this.name, message, options ?? {});
  }

  async presence(): Promise<string[]> {
    await this.ctx.ready;
    const local = this.ctx.hub.presence(this.name);
    const remote = await this.ctx.adapter.remotePresence(this.name);
    return union(local, remote);
  }

  async memberCount(): Promise<number> {
    return (await this.presence()).length;
  }

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
  /** Connection ids already bound to the hub lifecycle, to avoid double-binding. */
  private readonly bound = new Set<string>();

  constructor(hub: ChannelHub, adapter: ClusterAdapter) {
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

    this.ctx = { hub, adapter, ready, authorizers };
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
    // Register the rule; join/broadcast enforcement is wired in task 7.1.
    this.ctx.authorizers.set(name, rule);
    return room;
  }

  bind(conn: RealtimeConnection, member: Member | null): void {
    if (member) {
      this.members.set(conn, member);
    } else {
      this.members.delete(conn);
    }
    // Bind the connection's lifecycle to the hub so a close removes it from every
    // room (Req 3.3). Only connections that expose `onClose` (StreetSocket /
    // FakeConnection) can be bound; do it once per connection.
    if (!this.bound.has(conn.id) && hasOnClose(conn)) {
      this.bound.add(conn.id);
      this.ctx.hub.bind(conn);
    }
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
  return new RealtimeFacade(hub, adapter);
}

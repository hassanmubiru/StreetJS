// src/facade.ts
// Public typed surface for the Realtime_Facade and Room handles.
//
// This module declares the developer-facing types (`Member`,
// `RealtimeMessage`, `RealtimeOptions`, `Realtime`, `Room`, `BroadcastOptions`)
// and the `createRealtime` factory. The concrete facade/room behavior is
// implemented in later tasks (3.1, 3.2); this scaffold establishes the
// strongly-typed surface required by Requirements 1.2 and 1.5.

import type { IncomingMessage } from 'node:http';
import type {
  RealtimeConnection,
  StreetWebSocketServer,
  HealthCheckRegistry,
  MetricsRegistry,
} from 'streetjs';
import type { ClusterAdapter } from './cluster/adapter.js';
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
 * Construct a {@link Realtime} facade over an existing WebSocket server.
 *
 * NOTE: The concrete implementation lands in task 3.1. This scaffold defines
 * the typed entry point so the public surface (Req 1.2, 1.5) is complete and
 * type-checkable by consumers.
 */
export function createRealtime(_options: RealtimeOptions): Realtime {
  throw new Error('createRealtime is not implemented yet (see task 3.1)');
}

// src/websocket/channels.ts
// Realtime channel system: named channels (rooms) with membership, presence,
// typing indicators, and scoped event broadcasting — layered on top of the
// transport (StreetSocket) but transport-agnostic for testing.
//
// Design notes:
//   * A "member" is a logical user; a member may hold several "connections"
//     (multi-device, or a reconnect overlapping the old socket). Presence is
//     reference-counted by connection, so a member is "present" while at least
//     one of their connections is in the channel. This makes reconnection
//     handling correct: a new connection joins before the stale one is reaped,
//     and presence never flickers.
//   * The hub depends only on the minimal {@link RealtimeConnection} interface,
//     so it can be unit-tested with fakes and driven by any transport.

/** Minimal connection contract the hub needs. `StreetSocket` satisfies it. */
export interface RealtimeConnection {
  /** Stable, unique id per connection. */
  readonly id: string;
  /** Send an event to this connection. */
  emit(type: string, payload: unknown): void;
  /** Whether the connection is closed (the hub skips closed connections). */
  readonly closed: boolean;
}

/** Built-in event types the hub emits to channel members. */
export const ChannelEvents = {
  /** A member became present in a channel. payload: {@link PresencePayload} */
  PresenceJoin: 'presence:join',
  /** A member is no longer present in a channel. payload: {@link PresencePayload} */
  PresenceLeave: 'presence:leave',
  /** A member's typing state changed. payload: {@link TypingPayload} */
  Typing: 'typing',
} as const;

export interface PresencePayload {
  channel: string;
  memberId: string;
}

export interface TypingPayload {
  channel: string;
  memberId: string;
  typing: boolean;
}

/** Options for {@link ChannelHub.publish}. */
export interface PublishOptions {
  /** Do not deliver to this connection id (e.g. the sender's own socket). */
  exceptConnId?: string;
  /** Do not deliver to any connection of this member id. */
  exceptMemberId?: string;
}

/** Options for {@link ChannelHub}. */
export interface ChannelHubOptions {
  /** Default time-to-live for a typing indicator before it auto-clears (ms). 0 disables. */
  typingTtlMs?: number;
}

interface ChannelState {
  /** memberId -> set of connection ids currently in the channel. */
  members: Map<string, Set<string>>;
  /** connection id -> connection. */
  conns: Map<string, RealtimeConnection>;
  /** memberId -> auto-clear timer for the typing indicator. */
  typing: Map<string, { timer: NodeJS.Timeout | null }>;
}

/**
 * In-process realtime channel hub. For a single instance this is complete; for
 * horizontal scale, place a pub/sub fan-out (e.g. Redis) in front of
 * {@link ChannelHub.publish} / presence events.
 */
export class ChannelHub {
  private readonly channels = new Map<string, ChannelState>();
  /** connection id -> set of channels it belongs to (for fast disconnect). */
  private readonly connChannels = new Map<string, Set<string>>();
  private readonly typingTtlMs: number;

  constructor(options: ChannelHubOptions = {}) {
    this.typingTtlMs = options.typingTtlMs ?? 0;
  }

  /**
   * Join `memberId` to `channel` over `conn`. Idempotent per connection.
   * Returns whether this made the member newly present (their first connection
   * in the channel). When newly present, a {@link ChannelEvents.PresenceJoin}
   * event is broadcast to the channel's other connections.
   */
  join(channel: string, memberId: string, conn: RealtimeConnection): { newlyPresent: boolean } {
    const ch = requireName(channel, 'channel');
    const member = requireName(memberId, 'memberId');
    const state = this.getOrCreate(ch);

    state.conns.set(conn.id, conn);
    let set = state.members.get(member);
    const newlyPresent = !set || set.size === 0;
    if (!set) {
      set = new Set<string>();
      state.members.set(member, set);
    }
    set.add(conn.id);

    let chans = this.connChannels.get(conn.id);
    if (!chans) {
      chans = new Set<string>();
      this.connChannels.set(conn.id, chans);
    }
    chans.add(ch);

    if (newlyPresent) {
      this.broadcast(state, ChannelEvents.PresenceJoin, { channel: ch, memberId: member }, { exceptConnId: conn.id });
    }
    return { newlyPresent };
  }

  /**
   * Remove `conn` from `memberId` in `channel`. Returns whether the member
   * became absent (no remaining connections). When absent, a
   * {@link ChannelEvents.PresenceLeave} event is broadcast.
   */
  leave(channel: string, memberId: string, conn: RealtimeConnection): { nowAbsent: boolean } {
    const state = this.channels.get(channel);
    if (!state) return { nowAbsent: false };
    return this.removeConnFromChannel(state, channel, memberId, conn.id);
  }

  /**
   * Remove a connection from every channel it belongs to (call on socket
   * close). Fires presence-leave for any member that becomes absent.
   */
  disconnect(conn: RealtimeConnection): void {
    const chans = this.connChannels.get(conn.id);
    if (!chans) return;
    for (const ch of [...chans]) {
      const state = this.channels.get(ch);
      if (!state) continue;
      // Find which member(s) this connection backed in this channel.
      for (const [member, conns] of state.members) {
        if (conns.has(conn.id)) {
          this.removeConnFromChannel(state, ch, member, conn.id);
        }
      }
    }
    this.connChannels.delete(conn.id);
  }

  /**
   * Bind a {@link ChannelHub} to a connection's lifecycle so the hub cleans up
   * automatically when the socket closes. `conn` must expose `onClose`.
   */
  bind(conn: RealtimeConnection & { onClose(cb: () => void): unknown }): void {
    conn.onClose(() => this.disconnect(conn));
  }

  /** Broadcast `type`/`payload` to all connections in `channel`. */
  publish(channel: string, type: string, payload: unknown, options: PublishOptions = {}): void {
    const state = this.channels.get(channel);
    if (!state) return;
    this.broadcast(state, type, payload, options);
  }

  /** Member ids currently present in `channel` (insertion order). */
  presence(channel: string): string[] {
    const state = this.channels.get(channel);
    if (!state) return [];
    const out: string[] = [];
    for (const [member, conns] of state.members) if (conns.size > 0) out.push(member);
    return out;
  }

  /** Whether `memberId` is present in `channel`. */
  isPresent(channel: string, memberId: string): boolean {
    return (this.channels.get(channel)?.members.get(memberId)?.size ?? 0) > 0;
  }

  /** Number of members present in `channel`. */
  memberCount(channel: string): number {
    return this.presence(channel).length;
  }

  /** Number of live connections in `channel`. */
  connectionCount(channel: string): number {
    return this.channels.get(channel)?.conns.size ?? 0;
  }

  /**
   * Set `memberId`'s typing state in `channel` and broadcast a
   * {@link ChannelEvents.Typing} event to the other members. When `typing` is
   * true and a positive `typingTtlMs` is configured, the indicator auto-clears
   * (emitting a `typing:false`) after the TTL unless refreshed or cleared.
   */
  setTyping(channel: string, memberId: string, typing: boolean, conn?: RealtimeConnection): void {
    const ch = requireName(channel, 'channel');
    const member = requireName(memberId, 'memberId');
    const state = this.getOrCreate(ch);

    const existing = state.typing.get(member);
    if (existing?.timer) clearTimeout(existing.timer);

    if (typing) {
      let timer: NodeJS.Timeout | null = null;
      if (this.typingTtlMs > 0) {
        timer = setTimeout(() => this.setTyping(ch, member, false), this.typingTtlMs);
        timer.unref?.();
      }
      state.typing.set(member, { timer });
    } else {
      state.typing.delete(member);
    }

    this.broadcast(
      state,
      ChannelEvents.Typing,
      { channel: ch, memberId: member, typing } satisfies TypingPayload,
      conn ? { exceptConnId: conn.id } : {},
    );
  }

  /** Member ids currently flagged as typing in `channel`. */
  typingMembers(channel: string): string[] {
    return [...(this.channels.get(channel)?.typing.keys() ?? [])];
  }

  /** All channel names that currently have at least one connection. */
  channelNames(): string[] {
    return [...this.channels.keys()];
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private getOrCreate(channel: string): ChannelState {
    let state = this.channels.get(channel);
    if (!state) {
      state = { members: new Map(), conns: new Map(), typing: new Map() };
      this.channels.set(channel, state);
    }
    return state;
  }

  private removeConnFromChannel(
    state: ChannelState,
    channel: string,
    memberId: string,
    connId: string,
  ): { nowAbsent: boolean } {
    state.conns.delete(connId);
    this.connChannels.get(connId)?.delete(channel);

    const conns = state.members.get(memberId);
    if (!conns || !conns.delete(connId)) return { nowAbsent: false };

    let nowAbsent = false;
    if (conns.size === 0) {
      state.members.delete(memberId);
      nowAbsent = true;
      // Clear any dangling typing indicator/timer for the departed member.
      const t = state.typing.get(memberId);
      if (t?.timer) clearTimeout(t.timer);
      state.typing.delete(memberId);
      this.broadcast(state, ChannelEvents.PresenceLeave, { channel, memberId }, { exceptConnId: connId });
    }

    // Drop empty channels to avoid unbounded growth.
    if (state.conns.size === 0 && state.members.size === 0) {
      this.channels.delete(channel);
    }
    return { nowAbsent };
  }

  private broadcast(state: ChannelState, type: string, payload: unknown, options: PublishOptions): void {
    const exceptConns = options.exceptMemberId
      ? state.members.get(options.exceptMemberId)
      : undefined;
    for (const [connId, conn] of state.conns) {
      if (options.exceptConnId === connId) continue;
      if (exceptConns?.has(connId)) continue;
      if (conn.closed) continue;
      try {
        conn.emit(type, payload);
      } catch {
        // Isolate per-connection send failures.
      }
    }
  }
}

function requireName(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`ChannelHub: ${field} must be a non-empty string`);
  }
  return value;
}

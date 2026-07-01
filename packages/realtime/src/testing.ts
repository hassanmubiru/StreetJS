// src/testing.ts
// Realtime testing utilities (Req 16): a `FakeConnection` that records emitted
// events, a `createHarness()` in-memory driver, and `simulateClose(conn)`.
//
// Task 2.1 implements `FakeConnection`. Task 2.2 adds `ManualClock`,
// `createHarness()` (an in-memory `ChannelHub` driver with no network socket),
// and `simulateClose(conn)` (which invokes the same close path a live
// `StreetSocket` uses so the connection is removed from every room).

import { randomUUID } from 'node:crypto';
import { ChannelHub } from 'streetjs';
import type {
  RealtimeConnection,
  WsEvent,
  ChannelHubOptions,
  PublishOptions,
  Clock,
} from 'streetjs';

/** Construction options for {@link FakeConnection}. */
export interface FakeConnectionOptions {
  /** Stable connection id. Defaults to a random uuid. */
  readonly id?: string;
  /**
   * When true, {@link FakeConnection.emit} throws on every call so tests can
   * exercise the hub's per-connection send-failure resilience (Req 7.4). The
   * throwing emit still records nothing (the send never completed).
   */
  readonly throwOnEmit?: boolean;
  /**
   * Injectable clock used to stamp the `ts` field of recorded events. Defaults
   * to `Date.now`. Supplying a deterministic clock keeps assertions stable.
   */
  readonly now?: () => number;
}

/**
 * In-memory {@link RealtimeConnection} for tests. It records every emitted
 * {@link WsEvent} (`{ type, payload, ts }`) in emission order so tests can
 * assert exactly which events each connection received (Req 16.1, 16.2), and
 * it mirrors the `id` / `emit` / `closed` / `onClose` / `close` surface of the
 * live `StreetSocket` so it satisfies the same contract used by `ChannelHub`
 * (`bind` / `disconnect`).
 *
 * Construct with `{ throwOnEmit: true }` to make `emit` throw and exercise the
 * hub's send-failure isolation (Req 7.4).
 */
export class FakeConnection implements RealtimeConnection {
  /** Stable, unique id for this connection. */
  readonly id: string;

  private readonly throwOnEmit: boolean;
  private readonly now: () => number;
  private readonly closeHandlers = new Set<() => void>();
  private readonly recorded: WsEvent[] = [];
  private _closed = false;

  constructor(options: FakeConnectionOptions = {}) {
    this.id = options.id ?? randomUUID();
    this.throwOnEmit = options.throwOnEmit ?? false;
    this.now = options.now ?? Date.now;
  }

  /**
   * Record and "send" an event. When constructed with `throwOnEmit`, this
   * throws without recording, simulating a failed send. A closed connection
   * silently drops the event, mirroring `StreetSocket.emit`.
   */
  emit(type: string, payload: unknown): void {
    if (this.throwOnEmit) {
      throw new Error(`FakeConnection ${this.id}: emit failed (throwOnEmit)`);
    }
    if (this._closed) return;
    this.recorded.push({ type, payload, ts: this.now() });
  }

  /** Whether this connection is closed (the hub skips closed connections). */
  get closed(): boolean {
    return this._closed;
  }

  /**
   * Register a callback fired once when this connection closes. If already
   * closed, the callback runs immediately. Mirrors `StreetSocket.onClose`.
   */
  onClose(handler: () => void): this {
    if (this._closed) {
      handler();
    } else {
      this.closeHandlers.add(handler);
    }
    return this;
  }

  /**
   * Close the connection, firing every registered close handler exactly once.
   * Idempotent. Signature mirrors `StreetSocket.close(code?, reason?)`.
   */
  close(_code = 1000, _reason = ''): void {
    if (this._closed) return;
    this._closed = true;
    for (const cb of this.closeHandlers) {
      try {
        cb();
      } catch {
        // Isolate handler errors, matching StreetSocket.
      }
    }
    this.closeHandlers.clear();
  }

  // ── Test assertion helpers ──────────────────────────────────────────────────

  /** All events emitted to this connection, in order. Returns a copy. */
  events(): readonly WsEvent[] {
    return [...this.recorded];
  }

  /** Events of a given `type` emitted to this connection, in order. */
  eventsOfType(type: string): readonly WsEvent[] {
    return this.recorded.filter((e) => e.type === type);
  }

  /** The most recently emitted event, or `undefined` if none. */
  lastEvent(): WsEvent | undefined {
    return this.recorded[this.recorded.length - 1];
  }

  /** Number of events recorded on this connection. */
  get eventCount(): number {
    return this.recorded.length;
  }

  /** Discard all recorded events (does not affect closed state). */
  clear(): void {
    this.recorded.length = 0;
  }
}

// ── Manual clock (deterministic time for TTL + rate-limit windows) ────────────

interface ScheduledTimer {
  /** Absolute virtual time (ms) at which the callback is due. */
  at: number;
  /** The callback to run when the timer fires. */
  cb: () => void;
}

/**
 * A deterministic, manually-advanced clock for tests.
 *
 * It exposes {@link ManualClock.now} — usable directly as the core `Clock`
 * (`() => number`) injected into a `RateLimitStore` so rate-limit windows are
 * deterministic (Req 11) — and an internal timer queue advanced by
 * {@link ManualClock.advance}.
 *
 * Because the reused `ChannelHub` schedules its typing-indicator TTL through the
 * *global* `setTimeout`/`clearTimeout`, {@link ManualClock.installGlobalTimers}
 * can route those global timers through this clock so typing-TTL expiry (Req 6.3)
 * fires deterministically when the clock is advanced. Globals are always
 * restored by {@link ManualClock.restoreGlobalTimers}. Installation is opt-in
 * (harness option `fakeTimers`) so tests that rely on real async timers are
 * never disturbed.
 */
export class ManualClock {
  private current: number;
  private seq = 0;
  private readonly timers = new Map<number, ScheduledTimer>();

  private installed = false;
  private savedSetTimeout?: typeof globalThis.setTimeout;
  private savedClearTimeout?: typeof globalThis.clearTimeout;

  constructor(startMs = 0) {
    this.current = startMs;
  }

  /**
   * Current virtual time in milliseconds. Bound so it can be passed by value as
   * a core `Clock` (`() => number`), e.g. `new InMemoryRateLimitStore({ clock: harness.clock.now })`.
   */
  readonly now: Clock = () => this.current;

  /** Schedule `cb` to run `delayMs` from now. Returns a cancellation handle. */
  schedule(cb: () => void, delayMs: number): number {
    const id = ++this.seq;
    this.timers.set(id, { at: this.current + Math.max(0, delayMs), cb });
    return id;
  }

  /** Cancel a timer scheduled via {@link ManualClock.schedule}. */
  cancel(id: number): void {
    this.timers.delete(id);
  }

  /**
   * Advance virtual time by `ms`, firing every timer that comes due in
   * chronological order (ties break by scheduling order). A timer's callback
   * observes the clock at exactly its due time. `ms` must be non-negative.
   */
  advance(ms: number): void {
    if (ms < 0) throw new Error('ManualClock.advance: ms must be >= 0');
    const target = this.current + ms;
    for (;;) {
      let dueId = -1;
      let dueAt = Number.POSITIVE_INFINITY;
      for (const [id, t] of this.timers) {
        if (t.at <= target && (t.at < dueAt || (t.at === dueAt && id < dueId))) {
          dueAt = t.at;
          dueId = id;
        }
      }
      if (dueId === -1) break;
      const t = this.timers.get(dueId)!;
      this.timers.delete(dueId);
      this.current = t.at;
      t.cb();
    }
    this.current = target;
  }

  /**
   * Route the global `setTimeout`/`clearTimeout` through this clock so
   * timer-based code under test (e.g. the hub's typing TTL) becomes
   * deterministic. Idempotent. Always pair with
   * {@link ManualClock.restoreGlobalTimers}.
   */
  installGlobalTimers(): void {
    if (this.installed) return;
    this.installed = true;
    this.savedSetTimeout = globalThis.setTimeout;
    this.savedClearTimeout = globalThis.clearTimeout;

    const fakeSetTimeout = (handler: (...args: unknown[]) => void, delay?: number): number => {
      // The `.unref?.()` call sites in core tolerate a plain numeric handle.
      return this.schedule(() => handler(), delay ?? 0);
    };
    const fakeClearTimeout = (id?: number | { toString(): string }): void => {
      if (typeof id === 'number') this.cancel(id);
    };

    (globalThis as unknown as { setTimeout: unknown }).setTimeout = fakeSetTimeout;
    (globalThis as unknown as { clearTimeout: unknown }).clearTimeout = fakeClearTimeout;
  }

  /** Restore the real global `setTimeout`/`clearTimeout`. Idempotent. */
  restoreGlobalTimers(): void {
    if (!this.installed) return;
    this.installed = false;
    if (this.savedSetTimeout) {
      (globalThis as unknown as { setTimeout: unknown }).setTimeout = this.savedSetTimeout;
    }
    if (this.savedClearTimeout) {
      (globalThis as unknown as { clearTimeout: unknown }).clearTimeout = this.savedClearTimeout;
    }
    this.savedSetTimeout = undefined;
    this.savedClearTimeout = undefined;
  }
}

// ── In-memory harness (Req 16.3) ──────────────────────────────────────────────

/** Construction options for {@link createHarness}. */
export interface HarnessOptions {
  /** Typing-indicator TTL (ms) forwarded to the underlying `ChannelHub`. 0 disables (Req 6.3). */
  readonly typingTtlMs?: number;
  /**
   * Route the hub's global timers through the harness clock so typing-TTL
   * expiry fires when {@link Harness.advance} is called. Defaults to `false`
   * (opt-in) so real async timers elsewhere are undisturbed. Restored on
   * {@link Harness.close}.
   */
  readonly fakeTimers?: boolean;
  /** Initial virtual time for the harness clock (ms). Defaults to 0. */
  readonly clockStartMs?: number;
}

/** Options for {@link Harness.connect}. */
export interface HarnessConnectOptions {
  /** Stable connection id. Defaults to a random uuid. */
  readonly id?: string;
  /** When true the connection's `emit` throws, exercising send-failure resilience (Req 7.4). */
  readonly throwOnEmit?: boolean;
}

/**
 * An in-memory driver over a real `ChannelHub` with **no network socket**
 * (Req 16.3). It opens {@link FakeConnection}s bound to the hub's lifecycle,
 * drives join/leave/broadcast/typing, exposes presence, and advances an
 * injected clock for TTL / rate-limit windows. This is the substrate for the
 * property and unit tests in later tasks.
 *
 * The facade (`createRealtime`) is intentionally NOT constructed here — it is
 * unimplemented until task 3.1. The harness drives the hub directly so it
 * compiles and runs today; facade wiring is deferred and additive.
 */
export interface Harness {
  /** The underlying in-memory channel hub. */
  readonly hub: ChannelHub;
  /** The deterministic clock backing event timestamps, TTL, and rate-limit windows. */
  readonly clock: ManualClock;

  /** Open a fake connection bound to the hub so a close removes it from every room. */
  connect(options?: HarnessConnectOptions): FakeConnection;
  /** Every connection opened through {@link Harness.connect}, in creation order. */
  connections(): readonly FakeConnection[];

  /** Join `member` to `channel` over `conn` (delegates to `ChannelHub.join`). */
  join(channel: string, member: string, conn: RealtimeConnection): { newlyPresent: boolean };
  /** Remove `conn` for `member` from `channel` (delegates to `ChannelHub.leave`). */
  leave(channel: string, member: string, conn: RealtimeConnection): { nowAbsent: boolean };
  /** Publish `type`/`payload` to `channel` honoring exclusion options (Req 7). */
  broadcast(channel: string, type: string, payload: unknown, options?: PublishOptions): void;
  /** Set `member`'s typing state in `channel` (delegates to `ChannelHub.setTyping`). */
  setTyping(channel: string, member: string, typing: boolean, conn?: RealtimeConnection): void;

  /** Member ids present in `channel`. */
  presence(channel: string): string[];
  /** Count of members present in `channel`. */
  memberCount(channel: string): number;

  /** Advance the harness clock by `ms`, firing any due timers (typing TTL, etc.). */
  advance(ms: number): void;

  /** Close every opened connection and restore any installed global timers. */
  close(): void;
}

/**
 * Build an in-memory {@link Harness} driving a fresh `ChannelHub` with no
 * network socket (Req 16.3). Open connections with {@link Harness.connect},
 * drive membership/broadcast/typing, advance {@link Harness.clock}, and assert
 * on each {@link FakeConnection}'s recorded events (Req 16.1, 16.2).
 */
export function createHarness(options: HarnessOptions = {}): Harness {
  const clock = new ManualClock(options.clockStartMs ?? 0);
  if (options.fakeTimers) clock.installGlobalTimers();

  const hubOptions: ChannelHubOptions = { typingTtlMs: options.typingTtlMs ?? 0 };
  const hub = new ChannelHub(hubOptions);

  const conns: FakeConnection[] = [];
  let closed = false;

  const harness: Harness = {
    hub,
    clock,

    connect(connectOptions: HarnessConnectOptions = {}): FakeConnection {
      const conn = new FakeConnection({
        id: connectOptions.id,
        throwOnEmit: connectOptions.throwOnEmit,
        now: clock.now,
      });
      // Same lifecycle wiring a live socket uses: hub cleanup on close.
      hub.bind(conn);
      conns.push(conn);
      return conn;
    },

    connections(): readonly FakeConnection[] {
      return [...conns];
    },

    join(channel, member, conn) {
      return hub.join(channel, member, conn);
    },

    leave(channel, member, conn) {
      return hub.leave(channel, member, conn);
    },

    broadcast(channel, type, payload, publishOptions = {}) {
      hub.publish(channel, type, payload, publishOptions);
    },

    setTyping(channel, member, typing, conn) {
      hub.setTyping(channel, member, typing, conn);
    },

    presence(channel) {
      return hub.presence(channel);
    },

    memberCount(channel) {
      return hub.memberCount(channel);
    },

    advance(ms) {
      clock.advance(ms);
    },

    close() {
      if (closed) return;
      closed = true;
      for (const conn of conns) conn.close();
      clock.restoreGlobalTimers();
    },
  };

  return harness;
}

// ── simulateClose (Req 16.4) ──────────────────────────────────────────────────

/** The subset of a connection that can be closed, mirroring `StreetSocket.close`. */
export interface ClosableConnection {
  close(code?: number, reason?: string): void;
}

/**
 * Simulate a connection close through the **same close path a live
 * `StreetSocket` uses** (Req 16.4): invoking `close` fires the connection's
 * registered `onClose` handlers, and because the harness binds each connection
 * to the hub (`ChannelHub.bind` → `disconnect`), the connection is removed from
 * every room exactly as a real socket close would remove it. Idempotent for
 * connections whose `close` is idempotent (both `FakeConnection` and
 * `StreetSocket` are).
 */
export function simulateClose(conn: ClosableConnection): void {
  conn.close(1000, 'simulated close');
}

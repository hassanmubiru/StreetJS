// src/ratelimit.ts
// Per-connection and per-channel rate limiting (Req 11).
// Exports: RateLimiter, RateLimitConfig, RateLimitQuota.
//
// Reuses the core `RateLimitStore` sliding-window abstraction (`hit`/`count`
// with explicit `nowMs`/`windowMs` and an injectable clock) and `parseWindow`
// for human-readable windows, so per-connection and per-channel limits behave
// identically to HTTP rate limiting and can be made deterministic in tests. The
// limiter is enabled by default with documented defaults (per-connection
// `20/1s`, per-channel `200/1s`, Req 11.5).

import type { RateLimitStore } from 'streetjs';
import { InMemoryRateLimitStore, parseWindow } from 'streetjs';

/** A single quota rule: N requests per window. */
export interface RateLimitQuota {
  /** Maximum number of requests allowed within the window. */
  requests: number;
  /** Window length as a human-readable string (e.g. "1s") or milliseconds. */
  window: string | number;
}

/** Per-connection and per-channel quotas (Req 11). Enabled by default. */
export interface RateLimitConfig {
  /** Whether rate limiting is enabled. Defaults to `true` (Req 11.5). */
  enabled?: boolean;
  /** Per-connection quota. Defaults to `{ requests: 20, window: "1s" }`. */
  perConnection?: RateLimitQuota;
  /** Per-channel quota. Defaults to `{ requests: 200, window: "1s" }`. */
  perChannel?: RateLimitQuota;
  /** Backing store; defaults to the core in-memory rate-limit store (Req 11). */
  store?: RateLimitStore;
}

/** Documented default per-connection quota (Req 11.5). */
export const DEFAULT_PER_CONNECTION: RateLimitQuota = { requests: 20, window: '1s' };
/** Documented default per-channel quota (Req 11.5). */
export const DEFAULT_PER_CHANNEL: RateLimitQuota = { requests: 200, window: '1s' };

/** Which quota a rejection is attributed to (named in the error event, Req 11.4). */
export type ExceededQuota = 'perConnection' | 'perChannel';

/** Outcome of a rate-limit check: whether the action is allowed, and if not, which quota was exceeded. */
export interface RateLimitDecision {
  /** True when the action is within quota and may proceed. */
  allowed: boolean;
  /** The quota that was exceeded when `allowed` is false. */
  exceeded?: ExceededQuota;
}

/** A quota resolved to an integer request cap and a millisecond window. */
interface ResolvedQuota {
  requests: number;
  windowMs: number;
}

/** Namespace prefixes so per-connection and per-channel buckets never collide in the shared store. */
const CONN_KEY_PREFIX = 'rt:conn:';
const CHAN_KEY_PREFIX = 'rt:chan:';

/**
 * Enforces per-connection and per-channel message quotas over a sliding window,
 * reusing the core {@link RateLimitStore} semantics (Req 11.1-11.3). Enabled by
 * default with documented defaults (per-connection `20/1s`, per-channel
 * `200/1s`, Req 11.5). Window timing is driven by an injectable `now` clock, so
 * `ManualClock`-based tests are fully deterministic.
 *
 * A single check evaluates both quotas without recording on rejection (peek via
 * `count`, then record via `hit` only on acceptance), mirroring the core HTTP
 * limiter so a rejected message does not extend the window and cannot itself
 * push a quota over the edge.
 */
export class RateLimiter {
  /** Whether enforcement is active. When false, every check is allowed (Req 11.5 opt-out). */
  readonly enabled: boolean;

  private readonly perConnection: ResolvedQuota;
  private readonly perChannel: ResolvedQuota;
  private readonly store: RateLimitStore;
  private readonly now: () => number;

  /**
   * @param config Rate-limit configuration; defaults applied per Req 11.5.
   * @param now Injectable clock (ms). Defaults to `Date.now`; supply a
   *   deterministic clock (e.g. `ManualClock.now`) in tests.
   */
  constructor(config: RateLimitConfig = {}, now: () => number = Date.now) {
    this.enabled = config.enabled ?? true;
    this.perConnection = resolveQuota(config.perConnection ?? DEFAULT_PER_CONNECTION);
    this.perChannel = resolveQuota(config.perChannel ?? DEFAULT_PER_CHANNEL);
    this.store = config.store ?? new InMemoryRateLimitStore();
    this.now = now;
  }

  /**
   * Evaluate a broadcast against both quotas and record it when allowed.
   *
   * The per-connection quota is applied only when a `connId` is present (the
   * sending connection is identified by `BroadcastOptions.exceptConnId`; see
   * `RoomHandle.broadcast`). The per-channel quota is always applied, keyed by
   * `channel`. When either quota is already at/over its cap the action is
   * rejected - nothing is recorded - and the exceeded quota is reported so the
   * caller can name it in the rate-limit error event (Req 11.4). When both are
   * within quota, a hit is recorded against each applicable bucket (Req 11.1).
   */
  async consume(connId: string | undefined, channel: string): Promise<RateLimitDecision> {
    if (!this.enabled) return { allowed: true };
    const now = this.now();

    // Per-connection quota (only when the sending connection is known). Peek first.
    if (connId !== undefined) {
      const current = await this.store.count(connKey(connId), now, this.perConnection.windowMs);
      if (current >= this.perConnection.requests) {
        return { allowed: false, exceeded: 'perConnection' };
      }
    }

    // Per-channel quota. Peek first so a rejection records nothing.
    const channelCurrent = await this.store.count(chanKey(channel), now, this.perChannel.windowMs);
    if (channelCurrent >= this.perChannel.requests) {
      return { allowed: false, exceeded: 'perChannel' };
    }

    // Within both quotas: record a hit against each applicable bucket.
    if (connId !== undefined) {
      await this.store.hit(connKey(connId), now, this.perConnection.windowMs);
    }
    await this.store.hit(chanKey(channel), now, this.perChannel.windowMs);
    return { allowed: true };
  }
}

/** Resolve a {@link RateLimitQuota} to an integer cap and a millisecond window. */
function resolveQuota(quota: RateLimitQuota): ResolvedQuota {
  return { requests: quota.requests, windowMs: parseWindow(quota.window) };
}

/** Store key for a connection's per-connection bucket. */
function connKey(connId: string): string {
  return `${CONN_KEY_PREFIX}${connId}`;
}

/** Store key for a channel's per-channel bucket. */
function chanKey(channel: string): string {
  return `${CHAN_KEY_PREFIX}${channel}`;
}

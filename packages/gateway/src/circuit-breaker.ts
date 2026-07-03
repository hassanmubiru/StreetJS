/**
 * @streetjs/gateway — deterministic circuit breaker.
 *
 * A per-key (per target/service) implementation of the classic three-state
 * circuit breaker — CLOSED → OPEN → HALF_OPEN → CLOSED. All time-based
 * transitions are driven by an injected {@link Clock} so behavior is fully
 * deterministic under test; nothing here reads the wall clock directly.
 *
 * The breaker itself never throws: callers inspect {@link CircuitBreaker.canRequest}
 * (or {@link CircuitBreaker.state}) and raise {@link CircuitOpenError} when a
 * request must be shed. Success/failure outcomes are fed back via
 * {@link CircuitBreaker.onSuccess} / {@link CircuitBreaker.onFailure}.
 */

import { systemClock, type Clock } from "streetjs";

import type { CircuitBreakerPolicy } from "./types.js";

/** The externally observable circuit state for a key. */
export type CircuitState = "closed" | "open" | "half-open";

/** Mutable per-key bookkeeping for the state machine. */
interface CircuitEntry {
  state: CircuitState;
  /** Consecutive failures observed while CLOSED. */
  failures: number;
  /** Consecutive successful probes observed while HALF_OPEN. */
  successes: number;
  /** Clock timestamp (ms) at which the circuit last entered OPEN. */
  openedAt: number;
}

/** Options accepted by {@link CircuitBreaker}. */
export interface CircuitBreakerOptions {
  /** The circuit policy (thresholds and timing). */
  readonly policy: CircuitBreakerPolicy;
  /** Injected now-provider; defaults to {@link systemClock}. */
  readonly clock?: Clock;
}

/**
 * A deterministic, per-key circuit breaker.
 *
 * Keying is arbitrary: callers typically key by service name or target id so a
 * single instance can guard many upstreams independently.
 */
export class CircuitBreaker {
  private readonly failureThreshold: number;
  private readonly openMs: number;
  private readonly halfOpenSuccesses: number;
  private readonly clock: Clock;
  private readonly entries = new Map<string, CircuitEntry>();

  constructor(options: CircuitBreakerOptions) {
    const { policy, clock } = options;
    // Guard against nonsensical thresholds; a circuit must open on at least one
    // failure and require at least one probe success to close.
    this.failureThreshold = Math.max(1, Math.trunc(policy.failureThreshold));
    this.openMs = Math.max(0, policy.openMs);
    this.halfOpenSuccesses = Math.max(1, Math.trunc(policy.halfOpenSuccesses ?? 1));
    this.clock = clock ?? systemClock;
  }

  /**
   * The current state for `key`, computing the OPEN → HALF_OPEN transition
   * lazily against the clock. Unknown keys are CLOSED.
   */
  state(key: string): CircuitState {
    return this.resolve(key).state;
  }

  /**
   * Whether a request for `key` may proceed right now. CLOSED and HALF_OPEN
   * allow requests (the latter as a probe); OPEN sheds them.
   */
  canRequest(key: string): boolean {
    return this.resolve(key).state !== "open";
  }

  /** Record a successful outcome for `key`. */
  onSuccess(key: string): void {
    const entry = this.resolve(key);
    if (entry.state === "half-open") {
      entry.successes += 1;
      if (entry.successes >= this.halfOpenSuccesses) {
        this.close(entry);
      }
      return;
    }
    if (entry.state === "closed") {
      // A success clears any accumulated consecutive-failure streak.
      entry.failures = 0;
    }
    // OPEN successes are ignored: no request should have been permitted.
  }

  /** Record a failed outcome for `key`. */
  onFailure(key: string): void {
    const entry = this.resolve(key);
    if (entry.state === "half-open") {
      // A single probe failure re-opens the circuit and resets the timer.
      this.open(entry);
      return;
    }
    if (entry.state === "closed") {
      entry.failures += 1;
      if (entry.failures >= this.failureThreshold) {
        this.open(entry);
      }
    }
    // OPEN failures are ignored: the circuit is already shedding.
  }

  /**
   * Fetch (or lazily create) the entry for `key`, applying the time-based
   * OPEN → HALF_OPEN transition before returning it.
   */
  private resolve(key: string): CircuitEntry {
    let entry = this.entries.get(key);
    if (entry === undefined) {
      entry = { state: "closed", failures: 0, successes: 0, openedAt: 0 };
      this.entries.set(key, entry);
    }
    if (entry.state === "open" && this.clock() - entry.openedAt >= this.openMs) {
      entry.state = "half-open";
      entry.successes = 0;
    }
    return entry;
  }

  /** Transition an entry into OPEN, (re)starting the open timer. */
  private open(entry: CircuitEntry): void {
    entry.state = "open";
    entry.openedAt = this.clock();
    entry.failures = 0;
    entry.successes = 0;
  }

  /** Transition an entry into CLOSED, clearing all counters. */
  private close(entry: CircuitEntry): void {
    entry.state = "closed";
    entry.failures = 0;
    entry.successes = 0;
    entry.openedAt = 0;
  }
}

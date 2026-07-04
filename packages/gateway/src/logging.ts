/**
 * @streetjs/gateway — correlation ids and structured access logging.
 *
 * Two small, dependency-light primitives used at request ingress/egress:
 *
 *  - {@link newRequestId} mints a compact, unique-ish correlation id from a
 *    base36 timestamp plus a base36 random suffix. The randomness source is
 *    injectable so tests can assert a deterministic value.
 *  - {@link RequestLogger} measures request latency against an injected
 *    {@link Clock} and emits one fully-formed {@link AccessLogRecord} to its
 *    {@link AccessLogSink} per finished request. It holds no mutable per-request
 *    state, so it is safe to share and fully deterministic under a fake clock.
 */

import type { Clock } from "streetjs";
import { systemClock } from "streetjs";

import type { AccessLogRecord, AccessLogSink } from "./types.js";

/**
 * Mint a compact, unique-ish correlation id.
 *
 * The id is `<base36 timestamp>-<base36 random>`, e.g. `"lz4f9k-3f8a1b"`. It is
 * intended for log correlation, not cryptographic uniqueness. `rng` defaults to
 * `Math.random`; inject a fixed generator to obtain a deterministic id in tests.
 */
export function newRequestId(rng: () => number = Math.random): string {
  const time = Date.now().toString(36);
  // Drop the leading "0." from the base36 fraction; pad so the suffix is stable
  // in length even when the random fraction is short.
  const random = rng().toString(36).slice(2).padEnd(8, "0").slice(0, 8);
  return `${time}-${random}`;
}

/** Construction options for {@link RequestLogger}. */
export interface RequestLoggerOptions {
  /** Structured access-log sink; default a no-op. */
  readonly sink?: AccessLogSink;
  /** Timestamp source for latency measurement; default `systemClock`. */
  readonly clock?: Clock;
}

/** A no-op {@link AccessLogSink} used when no sink is provided. */
const noopSink: AccessLogSink = () => {};

/**
 * Measures request latency and emits one {@link AccessLogRecord} per request.
 *
 * A typical pairing is `const started = logger.start()` at ingress and
 * `logger.finish(record, started)` once the response status is known. The
 * logger carries no per-request state between those calls — the caller threads
 * the `startedAt` value — so a single instance is safe to share concurrently and
 * behaves deterministically under an injected clock.
 */
export class RequestLogger {
  readonly #sink: AccessLogSink;
  readonly #clock: Clock;

  constructor(options: RequestLoggerOptions = {}) {
    this.#sink = options.sink ?? noopSink;
    this.#clock = options.clock ?? systemClock;
  }

  /** Return a start timestamp from the injected clock. */
  start(): number {
    return this.#clock();
  }

  /**
   * Complete a request: compute `latencyMs = clock() - startedAt`, emit the
   * full {@link AccessLogRecord} to the sink exactly once, and return it.
   */
  finish(record: Omit<AccessLogRecord, "latencyMs">, startedAt: number): AccessLogRecord {
    const latencyMs = this.#clock() - startedAt;
    const full: AccessLogRecord = { ...record, latencyMs };
    this.#sink(full);
    return full;
  }
}

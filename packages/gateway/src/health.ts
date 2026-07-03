/**
 * @streetjs/gateway — upstream health tracking and probing.
 *
 * The {@link HealthRegistry} keeps one {@link HealthRecord} per target id and
 * filters an upstream pool down to the targets that are eligible to receive
 * traffic. Probing is fully injectable: the {@link Clock} supplies the
 * `checkedAt` timestamps and an optional `delay` drives the probe timeout, so a
 * probe run is deterministic under test without touching the wall clock or real
 * timers.
 *
 * Two batteries-included {@link HealthChecker} factories are provided
 * ({@link tcpChecker}, {@link httpChecker}) plus an identity helper
 * ({@link customChecker}) for user-supplied probes.
 */

import { connect } from "node:net";
import { get as httpGet } from "node:http";
import { get as httpsGet } from "node:https";

import type { Clock } from "streetjs";
import { systemClock } from "streetjs";

import type { HealthChecker, HealthRecord, HealthState, UpstreamTarget } from "./types.js";

/**
 * A cancellable delay. Resolves after `ms` unless `signal` aborts first, in
 * which case it rejects. Injectable so tests can drive probe timeouts
 * deterministically instead of waiting on real timers.
 */
export type Delay = (ms: number, signal?: AbortSignal) => Promise<void>;

/** Construction options for {@link HealthRegistry}. */
export interface HealthRegistryOptions {
  /** Timestamp source for {@link HealthRecord.checkedAt}; default `systemClock`. */
  readonly clock?: Clock;
  /**
   * Timeout driver used by {@link HealthRegistry.probe}; default a real
   * `setTimeout`-based delay. Inject a fake to keep probe timeouts deterministic.
   */
  readonly delay?: Delay;
}

/** Default {@link Delay}: a real, abort-cancellable `setTimeout`. */
function realDelay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("delay aborted"));
      return;
    }
    const id = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(id);
        reject(new Error("delay aborted"));
      },
      { once: true },
    );
  });
}

/**
 * Tracks the last-known {@link HealthRecord} for each upstream target and
 * filters a pool down to the targets eligible to receive traffic.
 */
export class HealthRegistry {
  readonly #clock: Clock;
  readonly #delay: Delay;
  readonly #records = new Map<string, HealthRecord>();

  constructor(options: HealthRegistryOptions = {}) {
    this.#clock = options.clock ?? systemClock;
    this.#delay = options.delay ?? realDelay;
  }

  /**
   * Record `state` for `targetId`, stamping `checkedAt` from the injected clock.
   * An optional `detail` string annotates the record (e.g. a failure reason).
   */
  setState(targetId: string, state: HealthState, detail?: string): HealthRecord {
    const record: HealthRecord =
      detail === undefined
        ? { targetId, state, checkedAt: this.#clock() }
        : { targetId, state, checkedAt: this.#clock(), detail };
    this.#records.set(targetId, record);
    return record;
  }

  /** Return the current {@link HealthRecord} for `targetId`, if any. */
  get(targetId: string): HealthRecord | undefined {
    return this.#records.get(targetId);
  }

  /**
   * Filter `targets` down to those eligible to receive traffic.
   *
   * Eligibility rule: a target passes unless its recorded state is explicitly
   * `"unhealthy"`. Both `"healthy"` and `"unknown"` pass, and a target with no
   * record at all is treated as `"unknown"`. This means a pool that has never
   * been probed still receives traffic (fail-open), and only a target proven
   * unhealthy by a completed probe is excluded.
   */
  filterHealthy(targets: readonly UpstreamTarget[]): UpstreamTarget[] {
    return targets.filter((target) => this.#records.get(target.id)?.state !== "unhealthy");
  }

  /**
   * Probe each target with `checker` under a per-target {@link AbortSignal} and
   * `timeoutMs` budget, updating its state to `"healthy"` or `"unhealthy"`.
   *
   * A checker that resolves `true` marks the target healthy; `false`, a thrown
   * error, or exceeding `timeoutMs` marks it unhealthy (the signal is aborted on
   * timeout so a cooperative checker can bail out). All targets are probed
   * concurrently; the returned promise settles once every state has been updated.
   */
  async probe(
    targets: readonly UpstreamTarget[],
    checker: HealthChecker,
    timeoutMs: number,
  ): Promise<void> {
    await Promise.all(targets.map((target) => this.#probeOne(target, checker, timeoutMs)));
  }

  #probeOne(target: UpstreamTarget, checker: HealthChecker, timeoutMs: number): Promise<void> {
    const controller = new AbortController();
    const timerController = new AbortController();
    const TIMEOUT = Symbol("timeout");

    const run = async (): Promise<void> => {
      const timeoutBranch = (async (): Promise<typeof TIMEOUT> => {
        try {
          await this.#delay(timeoutMs, timerController.signal);
        } catch {
          // Delay was cancelled because the checker already settled.
          return TIMEOUT;
        }
        controller.abort();
        return TIMEOUT;
      })();

      const checkBranch = (async (): Promise<boolean> => checker(target, controller.signal))();

      const outcome = await Promise.race<boolean | typeof TIMEOUT>([checkBranch, timeoutBranch]);

      if (outcome === TIMEOUT) {
        this.setState(target.id, "unhealthy", `probe exceeded ${timeoutMs}ms timeout`);
      } else if (outcome) {
        this.setState(target.id, "healthy");
      } else {
        this.setState(target.id, "unhealthy", "checker reported unhealthy");
      }
    };

    return run()
      .catch((err: unknown) => {
        this.setState(
          target.id,
          "unhealthy",
          err instanceof Error ? err.message : String(err),
        );
      })
      .finally(() => {
        // Cancel any still-pending timeout so we never leak a timer.
        timerController.abort();
      });
  }
}

// ── Built-in checker factories ──────────────────────────────────────────────────

/** Options for {@link tcpChecker}. */
export interface TcpCheckerOptions {
  /** Abandon the connect attempt (unhealthy) after this many ms, when set. */
  readonly connectTimeoutMs?: number;
}

/** Resolve `host`/`port` from an {@link UpstreamTarget.url}. */
function hostPort(url: string): { host: string; port: number } {
  const parsed = new URL(url);
  const host = parsed.hostname;
  const port = parsed.port
    ? Number(parsed.port)
    : parsed.protocol === "https:"
      ? 443
      : 80;
  return { host, port };
}

/**
 * A {@link HealthChecker} that opens a raw TCP connection to the target's
 * `host:port` and resolves `true` once connected. Any connection error, an
 * optional `connectTimeoutMs`, or an aborted signal resolves `false`. The socket
 * is always destroyed before resolving.
 */
export function tcpChecker(options: TcpCheckerOptions = {}): HealthChecker {
  return (target: UpstreamTarget, signal: AbortSignal): Promise<boolean> =>
    new Promise<boolean>((resolve) => {
      const { host, port } = hostPort(target.url);
      const socket = connect({ host, port });
      let timer: ReturnType<typeof setTimeout> | undefined;

      const settle = (ok: boolean): void => {
        if (timer !== undefined) clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
        socket.removeAllListeners();
        socket.destroy();
        resolve(ok);
      };
      const onAbort = (): void => settle(false);

      if (signal.aborted) {
        socket.destroy();
        resolve(false);
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });

      if (options.connectTimeoutMs !== undefined) {
        timer = setTimeout(() => settle(false), options.connectTimeoutMs);
      }
      socket.once("connect", () => settle(true));
      socket.once("error", () => settle(false));
    });
}

/**
 * A {@link HealthChecker} that issues an HTTP(S) `GET` to `path` on the target
 * and resolves `true` when the response status equals `expectStatus`. Transport
 * errors and aborted signals resolve `false`. Uses `node:https` when the target
 * URL is `https:`, otherwise `node:http`.
 */
export function httpChecker(path = "/health", expectStatus = 200): HealthChecker {
  return (target: UpstreamTarget, signal: AbortSignal): Promise<boolean> =>
    new Promise<boolean>((resolve) => {
      if (signal.aborted) {
        resolve(false);
        return;
      }
      const base = new URL(target.url);
      const url = new URL(path, base);
      const getFn = url.protocol === "https:" ? httpsGet : httpGet;
      const req = getFn(url, { signal }, (res) => {
        const ok = res.statusCode === expectStatus;
        res.resume(); // Drain so the socket can be freed.
        resolve(ok);
      });
      req.once("error", () => resolve(false));
    });
}

/**
 * Identity helper for user-supplied probes. A custom checker is simply any
 * function matching {@link HealthChecker}; this wrapper only aids readability and
 * type inference at call sites.
 */
export function customChecker(fn: HealthChecker): HealthChecker {
  return fn;
}
